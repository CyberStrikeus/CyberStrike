// Single-server GLOBAL adapter.
//
// Upstream opencode ships a multi-server data layer (context/global.tsx +
// server-sdk/server-sync engines + the global-sync/* subtree). CyberStrike is a
// single-server fork whose data lives in the always-mounted `context/global-sdk`
// + `context/global-sync` singletons. This adapter re-presents that singleton
// under the small `useGlobal()`/`ServerCtx` surface the ported v2 tab/titlebar
// tree reads — it does NOT reintroduce upstream's multi-server engines.
//
// Surface consumed by the ported tree:
//   useGlobal().servers.list()                          -> ServerConnection.Any[]
//   useGlobal().ensureServerCtx(conn)                   -> ServerCtx
//   ServerCtx.sdk.api.session.get({ sessionID })        -> Promise<Session>
//   ServerCtx.sdk.api.session.rename({ sessionID, title })
//   ServerCtx.sdk.scope                                 -> ServerScope
//   ServerCtx.sync.data.path                            -> { home?, ... }
//   ServerCtx.sync.session.peek/remember/resolve
//   ServerCtx.sync.ensureDirSyncContext(dir).session.sync(id)
//   ServerCtx.projects.list()                           -> LocalProject[]
import { createSimpleContext } from "@cyberstrike-io/ui/context"
import { createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import { QueryClient } from "@tanstack/solid-query"
import type { Session } from "@cyberstrike-io/sdk/v2/client"
import { ServerConnection, useServer } from "./server"
import { useGlobalSDK } from "./global-sdk"
import { useGlobalSync } from "./global-sync"
import { ServerScope } from "@/utils/server-scope"
import type { ServerHealth } from "@/utils/server-health"
import type { LocalProject } from "./layout"

function isLocalHost(url: string) {
  const host = url.replace(/^https?:\/\//, "").split(":")[0]
  return host === "localhost" || host === "127.0.0.1"
}

export const { use: useGlobal, provider: GlobalProvider } = createSimpleContext({
  name: "Global",
  init: () => {
    const server = useServer()
    const sdk = useGlobalSDK()
    const sync = useGlobalSync()

    // Single connection, so the ServerCtx cache holds at most one entry.
    const cache = new Map<ServerConnection.Key, ServerCtx>()

    const ensureServerCtx = (conn: ServerConnection.Any): ServerCtx => {
      const key = ServerConnection.key(conn)
      const existing = cache.get(key)
      if (existing) return existing
      const ctx = createServerCtx(conn, sdk, sync, server)
      cache.set(key, ctx)
      return ctx
    }

    return {
      servers: {
        list: () => (server.current ? [server.current] : []),
        // Single-server health map keyed by the active connection. The home tree
        // reads `health[key]?.healthy` to disable actions on an unreachable
        // server; our fork tracks one connection's health in `useServer()`.
        get health(): Record<ServerConnection.Key, ServerHealth> {
          const conn = server.current
          if (!conn) return {}
          return { [ServerConnection.key(conn)]: { healthy: server.healthy() !== false } }
        },
      },
      ensureServerCtx(conn: ServerConnection.Any) {
        return ensureServerCtx(conn)
      },
    }
  },
})

function createServerCtx(
  conn: ServerConnection.Any,
  sdk: ReturnType<typeof useGlobalSDK>,
  sync: ReturnType<typeof useGlobalSync>,
  server: ReturnType<typeof useServer>,
) {
  const storedProjects = server.projects.list
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        refetchOnReconnect: false,
        refetchOnMount: false,
        refetchOnWindowFocus: false,
      },
    },
  })

  // Session-info memory backing tab titles. Seeded/updated by remember(); read
  // by peek(); resolve() falls back to a live fetch and caches the result.
  const [known, setKnown] = createStore<Record<string, Session>>({})

  const sessionApi = {
    get(input: { sessionID: string }): Promise<Session> {
      return sdk.client.session.get({ sessionID: input.sessionID }).then((r) => r.data as Session)
    },
    // Our SDK has no session.rename; the title update maps onto session.update.
    rename(input: { sessionID: string; title: string }): Promise<unknown> {
      return sdk.client.session.update({ sessionID: input.sessionID, title: input.title }).then((r) => r.data)
    },
  }

  const session = {
    peek(sessionID: string): Session | undefined {
      return known[sessionID]
    },
    remember(value: Session) {
      setKnown(value.id, value)
    },
    async resolve(sessionID: string): Promise<Session | undefined> {
      const cached = known[sessionID]
      if (cached) return cached
      const value = await sessionApi.get({ sessionID })
      if (value) setKnown(value.id, value)
      return value
    },
  }

  // Upstream warms per-directory session content via its dir-sync engine, which
  // this fork deliberately does not have. Best-effort map onto our single-server
  // global-sync directory session loader; failures are swallowed by callers.
  const ensureDirSyncContext = (directory: string) => ({
    session: {
      async sync(_sessionID: string) {
        await Promise.resolve(sync.project.loadSessions(directory)).catch(() => {})
      },
    },
  })

  const projects = {
    list: (): LocalProject[] => {
      const stored = new Map(storedProjects().map((project) => [project.worktree, project.expanded]))
      return sync.data.project.map((project) => ({
        ...project,
        expanded: stored.get(project.worktree) ?? false,
      }))
    },
    // Home fallbacks/actions mapped onto the single-server project store.
    // `recentlyClosed` degrades to empty: this fork does not persist a
    // closed-project history the way upstream's multi-server layer does.
    recentlyClosed: (): LocalProject[] => [],
    last: () => server.projects.last(),
    open: (directory: string) => {
      server.projects.open(directory)
      void Promise.resolve(sync.project.loadSessions(directory)).catch(() => {})
    },
    close: (directory: string) => server.projects.close(directory),
    touch: (directory: string) => server.projects.touch(directory),
    move: (worktree: string, index: number) => server.projects.move(worktree, index),
  }

  return {
    queryClient,
    isLocal: isLocalHost(conn.http.url),
    scope: ServerScope.local,
    sdk: {
      scope: ServerScope.local,
      api: {
        session: sessionApi,
      },
    },
    sync: {
      get data() {
        return sync.data
      },
      session,
      ensureDirSyncContext,
    },
    projects,
  }
}

export type ServerCtx = ReturnType<typeof createServerCtx>
