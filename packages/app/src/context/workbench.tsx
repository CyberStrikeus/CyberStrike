import { createSimpleContext } from "@cyberstrike-io/ui/context"
import { useParams } from "@solidjs/router"
import { createEffect, createMemo, onCleanup, untrack } from "solid-js"
import { createStore, produce, reconcile } from "solid-js/store"
import { useSDK } from "@/context/sdk"
import {
  activityChannels,
  activityRefreshChannels,
  isActivity,
  mergeActivity,
  type Activity,
  type ActivitySource,
  type WorkbenchChannel,
} from "@/pages/session/activity"

const blank = () => ({
  activity: 0,
  mission: 0,
  topology: 0,
  memory: 0,
  mcp: 0,
  bolt: 0,
  terminal: 0,
  vulns: 0,
  web: 0,
})

export const { use: useWorkbench, provider: WorkbenchProvider } = createSimpleContext({
  name: "Workbench",
  init: () => {
    const params = useParams()
    const sdk = useSDK()
    const [events, setEvents] = createStore<Activity[]>([])
    const [state, setState] = createStore({
      connected: false,
      error: "",
      changes: blank(),
      revision: blank(),
      last: blank(),
    })

    const bump = (channel: WorkbenchChannel, time = Date.now(), changed = true) => {
      if (changed) setState("changes", channel, (value) => value + 1)
      setState("revision", channel, (value) => value + 1)
      setState("last", channel, time)
    }

    const marked = new Set<string>()
    const mark = (event: Activity) => {
      if (marked.has(event.id)) return
      marked.delete(event.id)
      marked.add(event.id)
      while (marked.size > 2_000) marked.delete(marked.values().next().value!)
      for (const channel of activityChannels(event)) bump(channel, event.time)
      for (const channel of activityRefreshChannels(event)) bump(channel, event.time, false)
    }

    const add = (event: Activity) => {
      const index = events.findIndex((item) => item.id === event.id)
      if (index !== -1) {
        setEvents(index, reconcile(event))
        mark(event)
        return
      }
      setEvents(
        produce((draft) => {
          draft.push(event)
          if (draft.length > 2_000) draft.splice(0, draft.length - 2_000)
        }),
      )
      mark(event)
    }

    createEffect(() => {
      const sessionID = params.id
      sdk.directory
      marked.clear()
      setEvents(reconcile([]))
      setState({
        connected: false,
        error: "",
        changes: blank(),
        revision: blank(),
        last: blank(),
      })
      if (!sessionID) return

      const abort = new AbortController()
      const client = sdk.createClient({
        directory: sdk.directory,
        throwOnError: true,
        signal: abort.signal,
      })
      let connected = false
      let hydrated = false
      let requested = 0
      let completed = 0
      let syncing: Promise<void> | undefined
      let streamError = ""
      let historyError = ""
      const render = () => setState({ connected, error: historyError || streamError })
      const snapshot = async () => {
        const known = new Set(untrack(() => events.map((event) => event.id)))
        const pages: Activity[] = []
        let before: number | undefined
        let beforeID: string | undefined
        while (pages.length < 2_000) {
          const limit = Math.min(500, 2_000 - pages.length)
          const response = await client.eventLog.list({ sessionID, before, beforeID, limit })
          const page = (response.data ?? []).filter(isActivity)
          if (page.length === 0) break
          pages.unshift(...page)
          if (hydrated && page.some((event) => known.has(event.id))) break
          if (page.length < limit) break
          const next = page[0]!.time
          const nextID = page[0]!.id
          if (before === next && beforeID === nextID) break
          before = next
          beforeID = nextID
        }
        return { known, incoming: mergeActivity(pages, [], 2_000) }
      }
      const sync = () => {
        if (syncing) return syncing
        syncing = (async () => {
          while (!abort.signal.aborted) {
            const version = requested
            try {
              const history = await snapshot()
              if (abort.signal.aborted) return
              const changed = hydrated
              setEvents(reconcile(mergeActivity(history.incoming, [...events])))
              if (changed) history.incoming.filter((event) => !history.known.has(event.id)).forEach(mark)
              hydrated = true
              completed = version
              historyError = ""
              render()
              if (requested <= completed) return
            } catch (cause) {
              if (abort.signal.aborted) return
              historyError = cause instanceof Error ? cause.message : String(cause)
              render()
              await new Promise((resolve) => setTimeout(resolve, 500))
            }
          }
        })().finally(() => {
          syncing = undefined
        })
        return syncing
      }
      const requestSync = () => {
        requested++
        return sync()
      }
      const unsubs = [
        sdk.event.on("memory.updated", (event) => {
          if (!event.properties.sessionID) bump("memory")
        }),
        sdk.event.on("mcp.tools.changed", () => bump("mcp")),
        sdk.event.on("pty.created", () => bump("terminal")),
        sdk.event.on("pty.updated", () => bump("terminal")),
        sdk.event.on("pty.exited", () => bump("terminal")),
        sdk.event.on("pty.deleted", () => bump("terminal")),
      ]

      void requestSync()
      let timer: ReturnType<typeof setTimeout> | undefined
      void (async () => {
        while (!abort.signal.aborted) {
          try {
            const response = await client.eventLog.stream(
              { sessionID },
              {
                onSseError: (cause) => {
                  if (abort.signal.aborted) return
                  connected = false
                  streamError = cause instanceof Error ? cause.message : String(cause)
                  render()
                },
                onSseEvent: () => {
                  if (timer) clearTimeout(timer)
                  timer = undefined
                  const recovered = !connected
                  connected = true
                  streamError = ""
                  render()
                  if (recovered) void requestSync()
                },
              },
            )
            timer = setTimeout(() => {
              if (abort.signal.aborted) return
              streamError = "Live activity stream did not connect"
              render()
            }, 5_000)
            let next = await response.stream.next()
            while (!next.done && !abort.signal.aborted) {
              if (isActivity(next.value)) add(next.value)
              next = await response.stream.next()
            }
            if (abort.signal.aborted) return
            connected = false
            streamError = "Live activity stream disconnected"
            render()
          } catch (cause) {
            if (abort.signal.aborted) return
            connected = false
            streamError = cause instanceof Error ? cause.message : String(cause)
            render()
          } finally {
            if (timer) clearTimeout(timer)
          }
          await new Promise((resolve) => setTimeout(resolve, 500))
        }
      })()

      onCleanup(() => {
        if (timer) clearTimeout(timer)
        abort.abort()
        unsubs.forEach((unsub) => unsub())
      })
    })

    const latest = createMemo(() => events.at(-1))

    return {
      get events() {
        return events
      },
      get connected() {
        return state.connected
      },
      get error() {
        return state.error
      },
      latest,
      count(source: ActivitySource) {
        return events.filter((event) => event.source === source).length
      },
      changes(channel: WorkbenchChannel) {
        return state.changes[channel]
      },
      revision(channel: WorkbenchChannel) {
        return state.revision[channel]
      },
      last(channel: WorkbenchChannel) {
        return state.last[channel]
      },
      ack(channel: WorkbenchChannel) {
        setState("changes", channel, 0)
      },
    }
  },
})
