import { Component, createMemo, createSignal, For, Show } from "solid-js"
import { useParams } from "@solidjs/router"
import { useSync } from "@/context/sync"
import { Dialog } from "@cyberstrike-io/ui/dialog"

type SectionID = "endpoints" | "roles" | "credentials" | "objects" | "functions" | "signals"

const SECTIONS: { id: SectionID; label: string }[] = [
  { id: "endpoints", label: "Endpoints" },
  { id: "roles", label: "Roles" },
  { id: "credentials", label: "Credentials" },
  { id: "objects", label: "Objects" },
  { id: "functions", label: "Functions" },
  { id: "signals", label: "Signals" },
]

const SEV_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 }

const sevColor = (severity: string) => {
  if (severity === "critical") return "text-red-500"
  if (severity === "high") return "text-orange-500"
  if (severity === "medium") return "text-yellow-500"
  if (severity === "low") return "text-blue-400"
  return "text-text-weaker"
}

const statusColor = (status: string) => {
  if (status === "processed") return "text-green-500"
  if (status === "processing") return "text-yellow-500"
  return "text-text-weaker"
}

const actionColor = (action: string) => {
  if (action === "create") return "text-green-500"
  if (action === "read") return "text-blue-400"
  if (action === "update") return "text-yellow-500"
  if (action === "delete") return "text-red-500"
  return "text-text-base"
}

function DetailRow(props: { label: string; value: string | number | undefined }) {
  if (props.value === undefined || props.value === "") return null
  return (
    <div class="flex gap-2">
      <span class="text-12-regular text-text-weaker shrink-0">{props.label}:</span>
      <span class="text-12-regular text-text-base break-all">{String(props.value)}</span>
    </div>
  )
}

export const DialogWebContext: Component<{ sessionID: string }> = (props) => {
  const sync = useSync()
  const [section, setSection] = createSignal<SectionID>("endpoints")
  const [selected, setSelected] = createSignal<number>(-1)
  const [dismissed, setDismissed] = createSignal(false)

  const items = createMemo(() => {
    const s = sync()?.data
    if (!s) return []
    const current = section()
    if (current === "endpoints") return (s as any).vortex_captures?.[props.sessionID]?.requests ?? []
    if (current === "roles") return (s as any).web_role?.[props.sessionID] ?? []
    if (current === "credentials") return (s as any).web_credential?.[props.sessionID] ?? []
    if (current === "objects") return (s as any).web_object?.[props.sessionID] ?? []
    if (current === "functions") return (s as any).web_function?.[props.sessionID] ?? []
    if (current === "signals") {
      const all = ((s as any).vortex_signals?.[props.sessionID]?.signals ?? []) as Array<Record<string, unknown>>
      return all
        .filter((sig) => dismissed() || (sig.triage ?? "new") !== "dismissed")
        .slice()
        .sort(
          (a, b) =>
            String(a.category ?? "").localeCompare(String(b.category ?? "")) ||
            (SEV_RANK[String(a.severity)] ?? 4) - (SEV_RANK[String(b.severity)] ?? 4),
        )
    }
    return []
  })

  const detail = createMemo(() => {
    const i = selected()
    if (i < 0) return undefined
    return items()[i]
  })

  return (
    <Dialog title={`Web Context — ${SECTIONS.find((s) => s.id === section())?.label} (${items().length})`} size="x-large">
      <div class="flex flex-col gap-3 min-h-0" style={{ "max-height": "calc(100% - 16px)" }}>
        <div class="flex gap-1 flex-wrap">
          <For each={SECTIONS}>
            {(s) => (
              <button
                class="px-2 py-0.5 rounded text-12-medium cursor-pointer transition-colors"
                classList={{
                  "bg-accent-base text-white": s.id === section(),
                  "text-text-weaker hover:text-text-base": s.id !== section(),
                }}
                onClick={() => {
                  setSection(s.id)
                  setSelected(-1)
                }}
              >
                {s.label}
              </button>
            )}
          </For>
          <Show when={section() === "signals"}>
            <button
              class="px-2 py-0.5 rounded text-11-medium text-text-weaker hover:text-text-base cursor-pointer ml-2"
              onClick={() => setDismissed((v) => !v)}
            >
              {dismissed() ? "Hide dismissed" : "Show dismissed"}
            </button>
          </Show>
        </div>

        <div class="flex gap-0 min-h-0 flex-1" style={{ "max-height": "60vh" }}>
          <div
            class="overflow-y-auto min-w-0 shrink-0"
            classList={{ "w-full": !detail(), "w-[340px] border-r border-border-base": !!detail() }}
          >
            <Show
              when={items().length > 0}
              fallback={<div class="text-13-regular text-text-weaker p-4">No {section()} found for this session.</div>}
            >
              <For each={items()}>
                {(item, i) => {
                  const active = () => i() === selected()
                  const row = item as Record<string, unknown>
                  return (
                    <button
                      class="w-full text-left px-3 py-1.5 flex items-start gap-2 cursor-pointer hover:bg-surface-raised-base transition-colors"
                      classList={{ "bg-surface-selected-base": active() }}
                      onClick={() => setSelected(active() ? -1 : i())}
                    >
                      <Show when={section() === "endpoints"}>
                        <span class={`shrink-0 ${statusColor(String(row.status ?? ""))}`}>·</span>
                        <span class="text-12-medium text-accent-base shrink-0">{String(row.method ?? "")}</span>
                        <span class="text-12-regular text-text-base truncate">{String(row.normalized_path ?? "")}</span>
                      </Show>
                      <Show when={section() === "roles"}>
                        <span class="text-12-regular text-text-base">
                          {String(row.name ?? "")}
                          <Show when={row.level != null}>
                            <span class="text-text-weaker ml-1">L{String(row.level)}</span>
                          </Show>
                        </span>
                      </Show>
                      <Show when={section() === "credentials"}>
                        <span class="text-12-medium text-accent-base shrink-0">{String(row.type ?? "")}</span>
                        <span class="text-12-regular text-text-base truncate">{String(row.label ?? "")}</span>
                      </Show>
                      <Show when={section() === "objects"}>
                        <span class="text-12-regular text-text-base">{String(row.name ?? "")}</span>
                      </Show>
                      <Show when={section() === "functions"}>
                        <span class={`text-12-medium shrink-0 ${actionColor(String(row.action_type ?? ""))}`}>
                          {String(row.action_type ?? "").toUpperCase().charAt(0)}
                        </span>
                        <span class="text-12-regular text-text-base truncate">{String(row.name ?? "")}</span>
                      </Show>
                      <Show when={section() === "signals"}>
                        <span class={`shrink-0 ${sevColor(String(row.severity ?? ""))}`}>·</span>
                        <span class="text-11-medium text-text-weaker shrink-0">[{String(row.triage ?? "new")}]</span>
                        <span class="text-11-regular text-text-weaker shrink-0">{String(row.category ?? "")}</span>
                        <span class="text-12-regular text-text-base truncate">{String(row.title ?? "")}</span>
                      </Show>
                    </button>
                  )
                }}
              </For>
            </Show>
          </div>

          <Show when={detail()}>
            {(item) => {
              const d = () => item() as Record<string, unknown>
              return (
                <div class="flex-1 min-w-0 overflow-y-auto px-4 py-2 flex flex-col gap-3">
                  <Show when={section() === "endpoints"}>
                    <div class="flex items-center gap-2">
                      <span class={statusColor(String(d().status ?? ""))}>{String(d().method ?? "")}</span>
                      <span class="text-13-medium text-text-base break-all">{String(d().normalized_path ?? "")}</span>
                    </div>
                    <DetailRow label="Status" value={String(d().status ?? "")} />
                    <DetailRow label="Host" value={String(d().host ?? "")} />
                    <DetailRow label="ID" value={String(d().id ?? "")} />
                    <DetailRow label="Key hash" value={d().key_hash as string} />
                    <DetailRow label="Identity" value={d().identity as string} />
                    <DetailRow label="Operation" value={d().operation as string} />
                  </Show>
                  <Show when={section() === "roles"}>
                    <span class="text-14-medium text-text-base">
                      {String(d().name ?? "")}
                      <Show when={d().level != null}>
                        <span class="text-text-weaker ml-1">(Level {String(d().level)})</span>
                      </Show>
                    </span>
                    <DetailRow label="ID" value={d().id as string} />
                  </Show>
                  <Show when={section() === "credentials"}>
                    <span class="text-14-medium text-text-base">{String(d().label ?? "")}</span>
                    <DetailRow label="ID" value={d().id as string} />
                    <DetailRow label="Type" value={d().type as string} />
                  </Show>
                  <Show when={section() === "objects"}>
                    <span class="text-14-medium text-text-base">{String(d().name ?? "")}</span>
                    <DetailRow label="ID" value={d().id as string} />
                  </Show>
                  <Show when={section() === "functions"}>
                    <div class="flex items-center gap-2">
                      <span class={actionColor(String(d().action_type ?? ""))}>{String(d().action_type ?? "").toUpperCase()}</span>
                      <span class="text-14-medium text-text-base">{String(d().name ?? "")}</span>
                    </div>
                    <DetailRow label="ID" value={d().id as string} />
                  </Show>
                  <Show when={section() === "signals"}>
                    <span class="text-14-medium text-text-base break-words">{String(d().title ?? "")}</span>
                    <div class="flex items-center gap-3 text-12-regular text-text-weaker flex-wrap">
                      <span>severity: <span class={sevColor(String(d().severity ?? ""))}>{String(d().severity ?? "")}</span></span>
                      <span>triage: {String(d().triage ?? "new")}</span>
                      <span>category: {String(d().category ?? "")}</span>
                    </div>
                    <Show when={d().endpoint}>
                      <span class="text-12-regular text-text-weaker break-all">
                        {d().method ? `${d().method} ` : ""}{String(d().endpoint)}
                      </span>
                    </Show>
                    <DetailRow label="Rule" value={d().ruleId as string} />
                    <Show when={d().routed}>
                      <span class="text-12-regular text-text-weaker">
                        → {String(d().owner ?? d().category)}{d().status ? ` · ${d().status}` : ""}
                      </span>
                    </Show>
                  </Show>
                </div>
              )
            }}
          </Show>
        </div>
      </div>
    </Dialog>
  )
}
