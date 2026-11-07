import { Component, createMemo, createResource, createSignal, For, Show } from "solid-js"
import { useSDK } from "@/context/sdk"
import { Dialog } from "@cyberstrike-io/ui/dialog"

type SectionID = "phases" | "violations" | "intel" | "coverage" | "chains"

const SECTIONS: { id: SectionID; label: string }[] = [
  { id: "phases", label: "Phases" },
  { id: "violations", label: "Violations" },
  { id: "intel", label: "Intel" },
  { id: "coverage", label: "Coverage" },
  { id: "chains", label: "Chains" },
]

const asRows = (x: unknown): Record<string, unknown>[] => (Array.isArray(x) ? (x as Record<string, unknown>[]) : [])
const field = (row: Record<string, unknown>, ...keys: string[]) => {
  for (const k of keys) {
    const v = row[k]
    if (v !== undefined && v !== null && v !== "") return String(v)
  }
  return ""
}

const sevColor = (s: string) => {
  if (s === "critical") return "text-red-500"
  if (s === "high") return "text-orange-500"
  if (s === "medium") return "text-yellow-500"
  if (s === "low") return "text-blue-400"
  return "text-text-weaker"
}
const statusColor = (s: string) => {
  if (s === "complete" || s === "completed" || s === "done") return "text-green-500"
  if (s === "in_progress" || s === "active" || s === "current") return "text-yellow-500"
  return "text-text-weaker"
}

function DetailRow(props: { label: string; value: string | undefined }) {
  if (!props.value) return null
  return (
    <div class="flex gap-2">
      <span class="text-12-regular text-text-weaker shrink-0">{props.label}:</span>
      <span class="text-12-regular text-text-base break-all">{props.value}</span>
    </div>
  )
}

export const DialogMethodology: Component<{ sessionID: string }> = (props) => {
  const sdk = useSDK()
  const [section, setSection] = createSignal<SectionID>("phases")
  const [selected, setSelected] = createSignal<number>(-1)

  const [data] = createResource(
    () => props.sessionID,
    async (sessionID) => {
      const s = sdk()
      if (!s) return undefined
      const [state, intel, coverage, chains] = await Promise.all([
        s.client.methodology.state({ sessionID }).then((r) => r.data).catch(() => undefined),
        s.client.methodology.intel({ sessionID }).then((r) => r.data).catch(() => undefined),
        s.client.methodology.coverage({ sessionID }).then((r) => r.data).catch(() => undefined),
        s.client.methodology.chains({ sessionID }).then((r) => r.data).catch(() => undefined),
      ])
      const st = (state ?? {}) as Record<string, unknown>
      return {
        phases: asRows(st.phases),
        violations: asRows(st.violations),
        completedCount: Number(st.completedCount ?? 0),
        totalCount: Number(st.totalCount ?? 0),
        currentPhase: st.currentPhase ? String(st.currentPhase) : "",
        intel: asRows(intel),
        coverage: asRows(coverage),
        chains: asRows(chains),
      }
    },
  )

  const items = createMemo(() => {
    const d = data()
    if (!d) return []
    return d[section()] as Record<string, unknown>[]
  })

  const detail = createMemo(() => {
    const i = selected()
    if (i < 0) return undefined
    return items()[i]
  })

  const title = createMemo(() => {
    const d = data()
    const label = SECTIONS.find((s) => s.id === section())?.label ?? ""
    const prog = d ? ` · ${d.completedCount}/${d.totalCount}` : ""
    return `Methodology — ${label} (${items().length})${prog}`
  })

  return (
    <Dialog title={title()} size="x-large">
      <div class="flex flex-col gap-3 min-h-0" style={{ "max-height": "calc(100% - 16px)" }}>
        <Show when={data()?.currentPhase}>
          <div class="text-12-regular text-text-weaker">Current phase: <span class="text-text-base">{data()!.currentPhase}</span></div>
        </Show>
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
        </div>

        <div class="flex gap-0 min-h-0 flex-1" style={{ "max-height": "60vh" }}>
          <div
            class="overflow-y-auto min-w-0 shrink-0"
            classList={{ "w-full": !detail(), "w-[340px] border-r border-border-base": !!detail() }}
          >
            <Show when={data.loading}>
              <div class="text-13-regular text-text-weaker p-4">Loading methodology…</div>
            </Show>
            <Show when={!data.loading}>
              <Show
                when={items().length > 0}
                fallback={<div class="text-13-regular text-text-weaker p-4">No {section()} for this session.</div>}
              >
                <For each={items()}>
                  {(row, i) => {
                    const active = () => i() === selected()
                    return (
                      <button
                        class="w-full text-left px-3 py-1.5 flex items-start gap-2 cursor-pointer hover:bg-surface-raised-base transition-colors"
                        classList={{ "bg-surface-selected-base": active() }}
                        onClick={() => setSelected(active() ? -1 : i())}
                      >
                        <Show when={section() === "phases"}>
                          <span class={`shrink-0 ${statusColor(field(row, "status"))}`}>·</span>
                          <span class="text-12-regular text-text-base truncate">{field(row, "name", "id") || "phase"}</span>
                        </Show>
                        <Show when={section() === "violations"}>
                          <span class={`shrink-0 ${sevColor(field(row, "severity"))}`}>·</span>
                          <span class="text-11-regular text-text-weaker shrink-0">{field(row, "gate")}</span>
                          <span class="text-12-regular text-text-base truncate">{field(row, "message", "title")}</span>
                        </Show>
                        <Show when={section() === "intel" || section() === "coverage" || section() === "chains"}>
                          <span class="text-12-regular text-text-base truncate">
                            {field(row, "title", "name", "label", "id") || JSON.stringify(row).slice(0, 80)}
                          </span>
                        </Show>
                      </button>
                    )
                  }}
                </For>
              </Show>
            </Show>
          </div>

          <Show when={detail()}>
            {(row) => {
              const d = () => row()
              return (
                <div class="flex-1 min-w-0 overflow-y-auto px-4 py-2 flex flex-col gap-2">
                  <span class="text-14-medium text-text-base break-words">
                    {field(d(), "name", "title", "message", "gate", "id") || "Detail"}
                  </span>
                  <DetailRow label="Status" value={field(d(), "status") || undefined} />
                  <DetailRow label="Severity" value={field(d(), "severity") || undefined} />
                  <DetailRow label="Gate" value={field(d(), "gate") || undefined} />
                  <DetailRow label="Phase" value={field(d(), "phase", "phaseId") || undefined} />
                  <DetailRow label="Deliverables" value={field(d(), "deliverableCount") || undefined} />
                  <DetailRow label="ID" value={field(d(), "id") || undefined} />
                </div>
              )
            }}
          </Show>
        </div>
      </div>
    </Dialog>
  )
}
