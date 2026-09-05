import { For, Show, createEffect, createSignal, on, onCleanup } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { useParams } from "@solidjs/router"
import type { MemoryListResponse } from "@cyberstrike-io/sdk/v2/client"
import { Icon } from "@cyberstrike-io/ui/icon"
import { useSDK } from "@/context/sdk"
import { useWorkbench } from "@/context/workbench"

type Kind = MemoryListResponse[number]["kind"]

const kinds: Array<{ id: Kind; label: string }> = [
  { id: "working", label: "Working" },
  { id: "episodic", label: "Episodic" },
  { id: "semantic", label: "Semantic" },
  { id: "procedural", label: "Procedural" },
]

const trust = (value: MemoryListResponse[number]["trust"]) => {
  if (value === "human") return "bg-surface-success-base text-text-success-base"
  if (value === "tool") return "bg-surface-info-base text-text-info-base"
  if (value === "untrusted") return "bg-surface-critical-base text-text-critical-base"
  return "bg-surface-base text-text-weak"
}

export function MemoryPanel() {
  const params = useParams()
  const sdk = useSDK()
  const workbench = useWorkbench()
  const [items, setItems] = createStore<MemoryListResponse>([])
  const [query, setQuery] = createSignal("")
  const [kind, setKind] = createSignal<Kind | "all">("all")
  const [error, setError] = createSignal("")
  const [form, setForm] = createStore({
    open: false,
    project: false,
    kind: "episodic" as Kind,
    title: "",
    content: "",
    saving: false,
  })

  const load = async () => {
    const sessionID = params.id
    const filter = kind()
    try {
      const response = query().trim()
        ? await sdk.client.memory.search({
            query: query().trim(),
            sessionID,
            kind: filter === "all" ? undefined : filter,
            limit: 100,
          })
        : await sdk.client.memory.list({
            sessionID,
            kind: filter === "all" ? undefined : filter,
            limit: 200,
          })
      setItems(reconcile(response.data ?? []))
      setError("")
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  createEffect(() => {
    params.id
    kind()
    const search = query()
    const timer = setTimeout(load, search ? 250 : 0)
    onCleanup(() => clearTimeout(timer))
  })

  createEffect(on(() => workbench.revision("memory"), () => void load(), { defer: true }))

  const add = async () => {
    const title = form.title.trim()
    const content = form.content.trim()
    if (!title || !content || form.saving) return
    setForm("saving", true)
    try {
      const response = await sdk.client.memory.create({
        sessionID: form.project ? undefined : params.id,
        kind: form.kind,
        title,
        content,
        confidence: 1,
        tags: ["human-confirmed"],
      })
      if (response.data) setItems((current) => [response.data!, ...current])
      setForm({
        open: false,
        project: false,
        kind: "episodic",
        title: "",
        content: "",
        saving: false,
      })
      setError("")
    } catch (cause) {
      setForm("saving", false)
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const invalidate = async (id: string) => {
    try {
      await sdk.client.memory.invalidate({ entryID: id })
      setItems(reconcile(items.filter((item) => item.id !== id)))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  return (
    <div class="flex flex-col gap-2 pb-4">
      <div class="flex items-center justify-between px-2">
        <span class="text-11-medium text-text-weaker uppercase tracking-wider">Persistent memory</span>
        <div class="flex items-center gap-2">
          <Show when={workbench.last("memory") > 0}>
            <span class="text-10-mono text-text-weaker">
              Live · {new Date(workbench.last("memory")).toLocaleTimeString()}
            </span>
          </Show>
          <button
            type="button"
            class="text-10-medium text-text-accent hover:underline"
            onClick={() => setForm("open", (value) => !value)}
          >
            {form.open ? "Cancel" : "Add memory"}
          </button>
        </div>
      </div>
      <div class="flex items-center gap-1 px-2">
        <button
          type="button"
          class="px-2 py-0.5 rounded text-10-medium"
          classList={{
            "bg-surface-base text-text-strong": kind() === "all",
            "text-text-weak": kind() !== "all",
          }}
          onClick={() => setKind("all")}
        >
          All
        </button>
        <For each={kinds}>
          {(item) => (
            <button
              type="button"
              class="px-2 py-0.5 rounded text-10-medium"
              classList={{
                "bg-surface-base text-text-strong": kind() === item.id,
                "text-text-weak": kind() !== item.id,
              }}
              onClick={() => setKind(item.id)}
            >
              {item.label}
            </button>
          )}
        </For>
      </div>
      <div class="px-2">
        <input
          type="search"
          value={query()}
          placeholder="Search exact IDs, hosts, CVEs, paths, or concepts"
          class="w-full px-2 py-1.5 rounded bg-surface-inset-base border border-border-weak-base text-11-regular text-text-base outline-none focus:border-border-strong placeholder:text-text-weaker"
          onInput={(event) => setQuery(event.currentTarget.value)}
        />
      </div>
      <Show when={form.open}>
        <div class="mx-2 p-2 flex flex-col gap-2 rounded bg-surface-base border border-border-weak-base">
          <div class="flex items-center gap-2">
            <select
              value={form.kind}
              class="flex-1 px-2 py-1 rounded bg-surface-inset-base text-11-regular text-text-base"
              onChange={(event) => setForm("kind", event.currentTarget.value as Kind)}
            >
              <For each={kinds}>{(item) => <option value={item.id}>{item.label}</option>}</For>
            </select>
            <label class="flex items-center gap-1 text-10-regular text-text-weak">
              <input
                type="checkbox"
                checked={form.project}
                onChange={(event) => setForm("project", event.currentTarget.checked)}
              />
              Project-wide
            </label>
          </div>
          <input
            value={form.title}
            placeholder="Memory title"
            class="px-2 py-1.5 rounded bg-surface-inset-base text-11-regular text-text-base outline-none"
            onInput={(event) => setForm("title", event.currentTarget.value)}
          />
          <textarea
            value={form.content}
            rows={4}
            placeholder="Verified fact, decision, outcome, or reusable procedure"
            class="resize-y px-2 py-1.5 rounded bg-surface-inset-base text-11-regular text-text-base outline-none"
            onInput={(event) => setForm("content", event.currentTarget.value)}
          />
          <div class="flex items-center justify-between">
            <span class="text-10-regular text-text-weaker">Stored as human-trusted; secret patterns are redacted</span>
            <button
              type="button"
              class="px-2 py-1 rounded bg-surface-accent-base text-11-medium text-text-accent-base disabled:opacity-50"
              disabled={!form.title.trim() || !form.content.trim() || form.saving}
              onClick={add}
            >
              {form.saving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      </Show>
      <Show when={error()}>
        <div class="mx-2 px-2 py-1.5 rounded bg-surface-critical-base text-11-regular text-text-critical-base">
          {error()}
        </div>
      </Show>
      <Show
        when={items.length > 0}
        fallback={<div class="px-2 py-3 text-center text-12-regular text-text-weak">No matching memory</div>}
      >
        <div class="flex flex-col gap-1 px-2">
          <For each={items}>
            {(item) => (
              <div class="group p-2 rounded bg-surface-base border border-border-weak-base">
                <div class="flex items-start gap-2">
                  <div class="min-w-0 flex-1">
                    <div class="text-11-medium text-text-strong">{item.title}</div>
                    <div class="mt-0.5 text-11-regular text-text-base whitespace-pre-wrap break-words select-text">
                      {item.content}
                    </div>
                  </div>
                  <button
                    type="button"
                    class="opacity-0 group-hover:opacity-100 text-text-weaker hover:text-text-critical-base"
                    title="Invalidate memory"
                    onClick={() => invalidate(item.id)}
                  >
                    <Icon name="circle-ban-sign" size="small" />
                  </button>
                </div>
                <div class="mt-2 flex items-center gap-1 flex-wrap">
                  <span class={`px-1.5 py-0.5 rounded text-10-medium ${trust(item.trust)}`}>{item.trust}</span>
                  <span class="px-1.5 py-0.5 rounded bg-surface-inset-base text-10-medium text-text-weak">
                    {item.kind}
                  </span>
                  <span class="text-10-mono text-text-weaker">{Math.round(item.confidence * 100)}%</span>
                  <Show when={item.redacted}>
                    <span class="text-10-medium text-text-warning-base">redacted</span>
                  </Show>
                  <span class="text-10-regular text-text-weaker truncate">{item.source}</span>
                </div>
                <Show when={item.relatedIDs.length > 0}>
                  <div class="mt-1 text-10-mono text-text-weaker truncate">Links: {item.relatedIDs.join(", ")}</div>
                </Show>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  )
}
