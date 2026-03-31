import { createSimpleContext } from "@cyberstrike-io/ui/context"
import { type Accessor, batch, createEffect, createMemo, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { Persist, persisted } from "@/utils/persist"
import { useCheckServerHealth } from "@/utils/server-health"

type StoredProject = { worktree: string; expanded: boolean }
type StoredServer = string | ServerConnection.HttpBase | ServerConnection.Http
const HEALTH_POLL_INTERVAL_MS = 10_000

export function normalizeServerUrl(input: string) {
  const trimmed = input.trim()
  if (!trimmed) return
  const withProtocol = /^https?:\/\//.test(trimmed) ? trimmed : `http://${trimmed}`
  return withProtocol.replace(/\/+$/, "")
}

export function serverName(conn?: ServerConnection.Any, ignoreDisplayName = false) {
  if (!conn) return ""
  if (conn.displayName && !ignoreDisplayName) return conn.displayName
  return conn.http.url.replace(/^https?:\/\//, "").replace(/\/+$/, "")
}

/** @deprecated use serverName(conn) instead */
export function serverDisplayName(url: string) {
  if (!url) return ""
  return url.replace(/^https?:\/\//, "").replace(/\/+$/, "")
}

function projectsKey(key: ServerConnection.Key) {
  if (!key) return ""
  if (isLocalHost(key)) return "local"
  return key
}

function isLocalHost(url: string) {
  const host = url.replace(/^https?:\/\//, "").split(":")[0]
  if (host === "localhost" || host === "127.0.0.1") return "local"
}

export namespace ServerConnection {
  type Base = { displayName?: string }

  export type HttpBase = {
    url: string
    username?: string
    password?: string
  }

  export type Http = {
    type: "http"
    http: HttpBase
  } & Base

  export type Any = Http

  export const key = (conn: Any): Key => {
    return Key.make(conn.http.url)
  }

  export type Key = string & { _brand: "Key" }
  export const Key = { make: (v: string) => v as Key }
}

const url = (x: StoredServer) => (typeof x === "string" ? x : "type" in x ? x.http.url : x.url)

export const { use: useServer, provider: ServerProvider } = createSimpleContext({
  name: "Server",
  init: (props: { defaultUrl: string; isSidecar?: boolean }) => {
    const checkServerHealth = useCheckServerHealth()

    const [store, setStore, _, ready] = persisted(
      Persist.global("server", ["server.v3"]),
      createStore({
        list: [] as StoredServer[],
        currentSidecarUrl: "",
        projects: {} as Record<string, StoredProject[]>,
        lastProject: {} as Record<string, string>,
      }),
    )

    const allServers = createMemo((): Array<ServerConnection.Any> => {
      const servers = store.list.map((value) =>
        typeof value === "string"
          ? { type: "http" as const, http: { url: value } }
          : "type" in value
            ? value
            : { type: "http" as const, http: value },
      )

      const deduped = new Map(servers.map((conn) => [ServerConnection.key(conn), conn]))

      return [...deduped.values()]
    })

    const [state, setState] = createStore({
      active: "" as ServerConnection.Key | "",
      healthy: undefined as boolean | undefined,
      needsAuth: false,
    })

    const healthy = () => state.healthy
    const needsAuth = () => state.needsAuth

    const defaultKey = () => {
      const normalized = normalizeServerUrl(props.defaultUrl)
      return normalized ? ServerConnection.Key.make(normalized) : ("" as ServerConnection.Key)
    }

    function reconcileStartup() {
      const fallback = defaultKey()
      if (!fallback) return

      const previousSidecarUrl = normalizeServerUrl(store.currentSidecarUrl)
      const list = previousSidecarUrl ? store.list.filter((x) => url(x) !== previousSidecarUrl) : store.list
      if (!props.isSidecar) {
        const exists = list.some((x) => url(x) === fallback)
        const nextList = exists
          ? list
          : [...list, { type: "http" as const, http: { url: fallback } } satisfies ServerConnection.Http]
        batch(() => {
          setStore("list", nextList)
          if (store.currentSidecarUrl) setStore("currentSidecarUrl", "")
          setState("active", fallback)
        })
        return
      }

      const exists = list.some((x) => url(x) === fallback)
      const nextList = exists
        ? list
        : [...list, { type: "http" as const, http: { url: fallback } } satisfies ServerConnection.Http]
      batch(() => {
        setStore("list", nextList)
        setStore("currentSidecarUrl", fallback)
        setState("active", fallback)
      })
    }

    function startHealthPolling(conn: ServerConnection.Any) {
      let alive = true
      let busy = false

      const run = () => {
        if (busy) return
        busy = true
        void check(conn)
          .then((result) => {
            if (!alive) return
            setState("healthy", result.healthy)
            setState("needsAuth", result.needsAuth === true)
          })
          .finally(() => {
            busy = false
          })
      }

      run()
      const interval = setInterval(run, HEALTH_POLL_INTERVAL_MS)
      return () => {
        alive = false
        clearInterval(interval)
      }
    }

    function setActive(input: ServerConnection.Key | string) {
      const key = input as ServerConnection.Key
      if (state.active !== key) setState("active", key)
    }

    function add(input: ServerConnection.Http) {
      const normalized = normalizeServerUrl(input.http.url)
      if (!normalized) return
      const conn = { ...input, http: { ...input.http, url: normalized } }
      return batch(() => {
        const existing = store.list.findIndex((x) => url(x) === normalized)
        if (existing !== -1) {
          setStore("list", existing, conn)
        } else {
          setStore("list", store.list.length, conn)
        }
        setState("active", ServerConnection.key(conn))
        return conn
      })
    }

    function remove(key: ServerConnection.Key | string) {
      const list = store.list.filter((x) => url(x) !== key)
      batch(() => {
        setStore("list", list)
        if (state.active === key) {
          const next = list[0]
          setState("active", next ? ServerConnection.Key.make(url(next)) : defaultKey())
        }
      })
    }

    createEffect(() => {
      if (!ready()) return
      if (state.active) return
      reconcileStartup()
    })

    const isReady = createMemo(() => ready() && !!state.active)

    const check = (conn: ServerConnection.Any) => checkServerHealth(conn.http)

    const current: Accessor<ServerConnection.Any | undefined> = createMemo(
      () => allServers().find((s) => ServerConnection.key(s) === state.active) ?? allServers()[0],
    )

    createEffect(() => {
      const c = current()
      if (!c) return

      setState("healthy", undefined)
      onCleanup(startHealthPolling(c))
    })

    const origin = createMemo(() => projectsKey(state.active as ServerConnection.Key))
    const projectsList = createMemo(() => store.projects[origin()] ?? [])
    const isLocal = createMemo(() => {
      const c = current()
      return c ? !!isLocalHost(c.http.url) : false
    })

    function updateCredentials(username: string, password: string) {
      const c = current()
      if (!c) return
      const updated: ServerConnection.Http = {
        type: "http",
        http: { ...c.http, username, password },
        displayName: c.displayName,
      }
      add(updated)
    }

    return {
      ready: isReady,
      healthy,
      needsAuth,
      isLocal,
      get key() {
        return state.active as ServerConnection.Key
      },
      get url() {
        return current()?.http.url ?? ""
      },
      get name() {
        return serverName(current())
      },
      get list() {
        return allServers()
      },
      get current() {
        return current()
      },
      setActive,
      add,
      remove,
      updateCredentials,
      projects: {
        list: projectsList,
        open(directory: string) {
          const k = origin()
          if (!k) return
          const cur = store.projects[k] ?? []
          if (cur.find((x) => x.worktree === directory)) return
          setStore("projects", k, [{ worktree: directory, expanded: true }, ...cur])
        },
        close(directory: string) {
          const k = origin()
          if (!k) return
          const cur = store.projects[k] ?? []
          setStore(
            "projects",
            k,
            cur.filter((x) => x.worktree !== directory),
          )
        },
        expand(directory: string) {
          const k = origin()
          if (!k) return
          const cur = store.projects[k] ?? []
          const index = cur.findIndex((x) => x.worktree === directory)
          if (index !== -1) setStore("projects", k, index, "expanded", true)
        },
        collapse(directory: string) {
          const k = origin()
          if (!k) return
          const cur = store.projects[k] ?? []
          const index = cur.findIndex((x) => x.worktree === directory)
          if (index !== -1) setStore("projects", k, index, "expanded", false)
        },
        move(directory: string, toIndex: number) {
          const k = origin()
          if (!k) return
          const cur = store.projects[k] ?? []
          const fromIndex = cur.findIndex((x) => x.worktree === directory)
          if (fromIndex === -1 || fromIndex === toIndex) return
          const result = [...cur]
          const [item] = result.splice(fromIndex, 1)
          result.splice(toIndex, 0, item)
          setStore("projects", k, result)
        },
        last() {
          const k = origin()
          if (!k) return
          return store.lastProject[k]
        },
        touch(directory: string) {
          const k = origin()
          if (!k) return
          setStore("lastProject", k, directory)
        },
      },
    }
  },
})
