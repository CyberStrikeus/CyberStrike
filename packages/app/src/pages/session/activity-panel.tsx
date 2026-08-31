import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { createStore, produce, reconcile } from "solid-js/store"
import { useParams } from "@solidjs/router"
import { Icon } from "@cyberstrike-io/ui/icon"
import { useSDK } from "@/context/sdk"
import { isActivity, mergeActivity, type Activity, type ActivitySource } from "./activity"

const sources: Array<{ id: ActivitySource; label: string }> = [
  { id: "agent", label: "Agent" },
  { id: "tool", label: "Tool" },
  { id: "mcp", label: "MCP" },
  { id: "bolt", label: "Bolt" },
  { id: "browser", label: "Browser" },
  { id: "pty", label: "PTY" },
  { id: "finding", label: "Finding" },
  { id: "system", label: "System" },
]

const badge = (source: ActivitySource) => {
  if (source === "tool") return "bg-surface-accent-base text-text-accent-base"
  if (source === "mcp" || source === "bolt") return "bg-surface-info-base text-text-info-base"
  if (source === "finding") return "bg-surface-warning-base text-text-warning-base"
  if (source === "browser") return "bg-surface-success-base text-text-success-base"
  return "bg-surface-base text-text-weak"
}

const value = (data: Record<string, unknown>, key: string) =>
  typeof data[key] === "string" || typeof data[key] === "number" ? String(data[key]) : ""

const summary = (event: Activity) => {
  const title = value(event.data, "title")
  const tool = value(event.data, "tool")
  const status = value(event.data, "status")
  const name = value(event.data, "name")
  const count = value(event.data, "count")
  return [tool || name || event.type, status, title, count ? `${count} items` : ""].filter(Boolean).join(" · ")
}

function ActivityRow(props: { event: Activity }) {
  return (
    <details class="group border-b border-border-weak-base last:border-b-0">
      <summary class="list-none flex items-start gap-2 px-2 py-1.5 cursor-pointer hover:bg-surface-raised-base">
        <span class="text-10-mono text-text-weaker tabular-nums shrink-0 pt-0.5">
          {new Date(props.event.time).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          })}
        </span>
        <span class={`text-10-medium px-1.5 py-0.5 rounded shrink-0 ${badge(props.event.source)}`}>
          {props.event.source.toUpperCase()}
        </span>
        <span class="text-11-mono text-text-base break-all">{summary(props.event)}</span>
      </summary>
      <pre class="m-0 px-3 py-2 bg-surface-inset-base text-10-mono text-text-weak whitespace-pre-wrap break-all select-text">
        {JSON.stringify(
          {
            type: props.event.type,
            correlationID: props.event.correlationID,
            parentID: props.event.parentID,
            ...props.event.data,
          },
          null,
          2,
        )}
      </pre>
    </details>
  )
}

export function ActivityPanel() {
  const params = useParams()
  const sdk = useSDK()
  const [events, setEvents] = createStore<Activity[]>([])
  const [source, setSource] = createSignal<ActivitySource | "all">("all")
  const [search, setSearch] = createSignal("")
  const [mode, setMode] = createSignal<"timeline" | "lanes">("timeline")
  const [follow, setFollow] = createSignal(true)
  const [error, setError] = createSignal("")
  let scroll!: HTMLDivElement

  const add = (event: Activity) => {
    const index = events.findIndex((item) => item.id === event.id)
    if (index !== -1) {
      setEvents(index, reconcile(event))
      return
    }
    setEvents(
      produce((draft) => {
        draft.push(event)
        if (draft.length > 2_000) draft.splice(0, draft.length - 2_000)
      }),
    )
  }

  const merge = (incoming: Activity[]) => {
    setEvents(reconcile(mergeActivity(incoming, [...events])))
  }

  createEffect(() => {
    const sessionID = params.id
    if (!sessionID) {
      setEvents(reconcile([]))
      return
    }

    const abort = new AbortController()
    const client = sdk.createClient({
      directory: sdk.directory,
      throwOnError: true,
      signal: abort.signal,
    })
    setError("")
    void client.eventLog
      .list({ sessionID, limit: 500 })
      .then((response) => merge(response.data ?? []))
      .catch((cause) => {
        if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause))
      })
    void (async () => {
      try {
        const response = await client.eventLog.stream(
          { sessionID },
          {
            onSseError: (cause) => {
              if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause))
            },
          },
        )
        for await (const event of response.stream) {
          if (isActivity(event)) add(event)
        }
      } catch (cause) {
        if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause))
      }
    })()
    onCleanup(() => abort.abort())
  })

  const filtered = createMemo(() => {
    const query = search().trim().toLowerCase()
    return events.filter((event) => {
      if (source() !== "all" && event.source !== source()) return false
      if (!query) return true
      return `${event.type} ${summary(event)} ${event.correlationID ?? ""}`.toLowerCase().includes(query)
    })
  })

  createEffect(() => {
    filtered().length
    if (!follow() || !scroll) return
    requestAnimationFrame(() => scroll.scrollTo({ top: scroll.scrollHeight }))
  })

  const download = () => {
    const body = filtered().map((event) => JSON.stringify(event)).join("\n")
    const url = URL.createObjectURL(new Blob([body], { type: "application/x-ndjson" }))
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = `cyberstrike-activity-${params.id ?? "session"}.jsonl`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div class="h-full min-h-0 flex flex-col bg-background-stronger">
      <div class="h-9 shrink-0 flex items-center gap-1 px-2 border-b border-border-weak-base overflow-x-auto">
        <button
          type="button"
          class="h-6 px-2 rounded text-11-medium"
          classList={{
            "bg-surface-base text-text-strong": source() === "all",
            "text-text-weak hover:text-text-base": source() !== "all",
          }}
          onClick={() => setSource("all")}
        >
          All {events.length}
        </button>
        <For each={sources}>
          {(item) => (
            <button
              type="button"
              class="h-6 px-2 rounded text-11-medium"
              classList={{
                "bg-surface-base text-text-strong": source() === item.id,
                "text-text-weak hover:text-text-base": source() !== item.id,
              }}
              onClick={() => setSource(item.id)}
            >
              {item.label}
            </button>
          )}
        </For>
        <div class="flex-1 min-w-2" />
        <input
          type="search"
          value={search()}
          placeholder="Filter activity"
          class="h-6 w-40 px-2 rounded bg-surface-inset-base text-11-regular text-text-base outline-none placeholder:text-text-weaker"
          onInput={(event) => setSearch(event.currentTarget.value)}
        />
        <button
          type="button"
          class="h-6 px-2 rounded text-11-medium text-text-weak hover:text-text-base"
          onClick={() => setMode((current) => (current === "timeline" ? "lanes" : "timeline"))}
        >
          {mode() === "timeline" ? "Lanes" : "Timeline"}
        </button>
        <button
          type="button"
          class="h-6 px-2 rounded text-11-medium"
          classList={{
            "text-text-accent": follow(),
            "text-text-weak hover:text-text-base": !follow(),
          }}
          onClick={() => setFollow((current) => !current)}
        >
          {follow() ? "Following" : "Paused"}
        </button>
        <button
          type="button"
          class="h-6 px-2 rounded text-text-weak hover:text-text-base"
          title="Export redacted activity"
          onClick={download}
        >
          <Icon name="download" size="small" />
        </button>
      </div>
      <Show when={error()}>
        <div class="shrink-0 px-3 py-1.5 bg-surface-critical-base text-11-regular text-text-critical-base">{error()}</div>
      </Show>
      <div ref={scroll} class="flex-1 min-h-0 overflow-auto">
        <Show
          when={filtered().length > 0}
          fallback={<div class="h-full flex items-center justify-center text-12-regular text-text-weaker">No activity yet</div>}
        >
          <Show
            when={mode() === "lanes"}
            fallback={
              <div class="min-w-[680px]">
                <For each={filtered()}>{(event) => <ActivityRow event={event} />}</For>
              </div>
            }
          >
            <div class="h-full flex items-stretch min-w-max">
              <For each={sources.filter((item) => source() === "all" || source() === item.id)}>
                {(item) => {
                  const lane = createMemo(() => filtered().filter((event) => event.source === item.id))
                  return (
                    <section class="w-80 shrink-0 border-r border-border-weak-base last:border-r-0">
                      <div class="sticky top-0 z-10 h-8 px-2 flex items-center justify-between bg-background-stronger border-b border-border-weak-base">
                        <span class="text-11-medium text-text-strong">{item.label}</span>
                        <span class="text-10-mono text-text-weaker">{lane().length}</span>
                      </div>
                      <For each={lane()}>{(event) => <ActivityRow event={event} />}</For>
                    </section>
                  )
                }}
              </For>
            </div>
          </Show>
        </Show>
      </div>
    </div>
  )
}
