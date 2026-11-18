import { Component, createMemo, createSignal, For, Show } from "solid-js"
import { useSync } from "@/context/sync"
import { Dialog } from "@cyberstrike-io/ui/dialog"
import { AssistantMessage, Message, Part } from "@cyberstrike-io/sdk/v2"

type TabID = "overview" | "diagnostics"

const TABS: { id: TabID; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "diagnostics", label: "LLM Diagnostics" },
]

// Finish reasons that mean the model stopped because a safety/guardrail layer intervened — the
// signal #28 wants surfaced. The provider maps its own stop reason onto "content-filter" upstream
// (session/processor.ts), so this is the single string to match across providers.
const GUARDRAIL_FINISH = "content-filter"

const formatNumber = (n: number) => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return n.toLocaleString()
}

const formatCost = (n: number) => (n > 0 && n < 0.01 ? "<$0.01" : `$${n.toFixed(2)}`)

const formatDuration = (ms: number) => {
  if (ms <= 0) return "—"
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}

function StatTile(props: { label: string; value: string; accent?: string }) {
  return (
    <div class="flex flex-col gap-0.5 rounded border border-border-base px-3 py-2 min-w-0">
      <span class="text-11-medium text-text-weaker uppercase tracking-wide truncate">{props.label}</span>
      <span class={`text-16-medium tabular-nums ${props.accent ?? "text-text-base"}`}>{props.value}</span>
    </div>
  )
}

function Bar(props: { label: string; value: number; total: number; accent?: string; right?: string }) {
  const pct = () => (props.total > 0 ? Math.round((props.value / props.total) * 100) : 0)
  return (
    <div class="flex flex-col gap-0.5">
      <div class="flex items-baseline justify-between gap-2">
        <span class="text-12-regular text-text-base truncate">{props.label}</span>
        <span class="text-12-regular text-text-weaker shrink-0 tabular-nums">{props.right ?? String(props.value)}</span>
      </div>
      <div class="h-1 rounded bg-surface-raised-base overflow-hidden">
        <div class={`h-full ${props.accent ?? "bg-accent-base"}`} style={{ width: `${pct()}%` }} />
      </div>
    </div>
  )
}

export const DialogStats: Component<{ sessionID: string }> = (props) => {
  const sync = useSync()
  const [tab, setTab] = createSignal<TabID>("overview")

  const messages = createMemo<Message[]>(() => sync()?.data.message?.[props.sessionID] ?? [])
  const assistants = createMemo(() => messages().filter((m): m is AssistantMessage => m.role === "assistant"))

  const parts = createMemo<Part[]>(() => {
    const byMessage = sync()?.data.part
    if (!byMessage) return []
    return messages().flatMap((m) => byMessage[m.id] ?? [])
  })

  const overview = createMemo(() => {
    const a = assistants()
    const tokens = { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 }
    let cost = 0
    const models = new Map<string, { calls: number; cost: number; tokens: number }>()
    let firstStart = Infinity
    let lastEnd = 0
    for (const m of a) {
      cost += m.cost ?? 0
      tokens.input += m.tokens.input
      tokens.output += m.tokens.output
      tokens.reasoning += m.tokens.reasoning
      tokens.cacheRead += m.tokens.cache.read
      tokens.cacheWrite += m.tokens.cache.write
      const key = `${m.providerID}/${m.modelID}`
      const prev = models.get(key) ?? { calls: 0, cost: 0, tokens: 0 }
      prev.calls += 1
      prev.cost += m.cost ?? 0
      prev.tokens += m.tokens.input + m.tokens.output + m.tokens.reasoning
      models.set(key, prev)
      if (m.time.created < firstStart) firstStart = m.time.created
      if ((m.time.completed ?? m.time.created) > lastEnd) lastEnd = m.time.completed ?? m.time.created
    }
    const totalTokens = tokens.input + tokens.output + tokens.reasoning + tokens.cacheRead + tokens.cacheWrite
    const tools = new Map<string, number>()
    for (const p of parts()) {
      if (p.type !== "tool") continue
      tools.set(p.tool, (tools.get(p.tool) ?? 0) + 1)
    }
    return {
      turns: a.length,
      userMessages: messages().length - a.length,
      cost,
      tokens,
      totalTokens,
      duration: firstStart === Infinity ? 0 : lastEnd - firstStart,
      models: [...models.entries()].sort((x, y) => y[1].calls - x[1].calls),
      tools: [...tools.entries()].sort((x, y) => y[1] - x[1]),
      toolTotal: [...tools.values()].reduce((s, n) => s + n, 0),
    }
  })

  const diagnostics = createMemo(() => {
    const a = assistants()
    // Finish reasons + guardrail come from ONE source — the per-step `step-finish` parts the
    // processor writes on every finish-step (reason = the provider's finishReason). Message-level
    // `finish` is just the LAST step's reason copied onto the message, so counting both would
    // double-count. Steps are the finer, authoritative signal (an intermediate content-filter that
    // the message-level finish never carries still shows up here), and they are synced to the app.
    const errors = new Map<string, number>()
    let errored = 0
    let stepCapped = 0
    let stuckNudged = 0
    let stuckAborted = 0
    for (const m of a) {
      if (m.error) {
        errored += 1
        errors.set(m.error.name, (errors.get(m.error.name) ?? 0) + 1)
      }
      if (m.stepCapped) stepCapped += 1
      if (m.stuckNudged) stuckNudged += 1
      if (m.stuckAborted) stuckAborted += 1
    }
    const finishes = new Map<string, number>()
    let guardrail = 0
    let steps = 0
    for (const p of parts()) {
      if (p.type !== "step-finish") continue
      steps += 1
      const reason = p.reason ?? "unknown"
      finishes.set(reason, (finishes.get(reason) ?? 0) + 1)
      if (reason === GUARDRAIL_FINISH) guardrail += 1
    }
    return {
      turns: a.length,
      steps,
      guardrail,
      errored,
      stepCapped,
      stuckNudged,
      stuckAborted,
      finishes: [...finishes.entries()].sort((x, y) => y[1] - x[1]),
      errors: [...errors.entries()].sort((x, y) => y[1] - x[1]),
    }
  })

  return (
    <Dialog title={`Stats — ${TABS.find((t) => t.id === tab())?.label}`} size="x-large">
      <div class="flex flex-col gap-3 min-h-0" style={{ "max-height": "calc(100% - 16px)" }}>
        <div class="flex gap-1 flex-wrap">
          <For each={TABS}>
            {(t) => (
              <button
                class="px-2 py-0.5 rounded text-12-medium cursor-pointer transition-colors"
                classList={{
                  "bg-accent-base text-white": t.id === tab(),
                  "text-text-weaker hover:text-text-base": t.id !== tab(),
                }}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            )}
          </For>
        </div>

        <div class="overflow-y-auto min-h-0 flex-1" style={{ "max-height": "60vh" }}>
          <Show when={messages().length === 0}>
            <div class="text-13-regular text-text-weaker p-4">No activity recorded for this session yet.</div>
          </Show>

          <Show when={tab() === "overview" && messages().length > 0}>
            <div class="flex flex-col gap-4 p-1">
              <div class="grid grid-cols-2 sm:grid-cols-3 gap-2">
                <StatTile label="Assistant turns" value={formatNumber(overview().turns)} />
                <StatTile label="User messages" value={formatNumber(overview().userMessages)} />
                <StatTile label="Duration" value={formatDuration(overview().duration)} />
                <StatTile label="Total tokens" value={formatNumber(overview().totalTokens)} />
                <StatTile label="Cost" value={formatCost(overview().cost)} accent="text-accent-base" />
                <StatTile label="Tool calls" value={formatNumber(overview().toolTotal)} />
              </div>

              <div class="flex flex-col gap-2">
                <span class="text-12-medium text-text-weaker uppercase tracking-wide">Tokens</span>
                <div class="grid grid-cols-2 sm:grid-cols-5 gap-2">
                  <StatTile label="Input" value={formatNumber(overview().tokens.input)} />
                  <StatTile label="Output" value={formatNumber(overview().tokens.output)} />
                  <StatTile label="Reasoning" value={formatNumber(overview().tokens.reasoning)} />
                  <StatTile label="Cache read" value={formatNumber(overview().tokens.cacheRead)} />
                  <StatTile label="Cache write" value={formatNumber(overview().tokens.cacheWrite)} />
                </div>
              </div>

              <Show when={overview().models.length > 0}>
                <div class="flex flex-col gap-2">
                  <span class="text-12-medium text-text-weaker uppercase tracking-wide">Models</span>
                  <For each={overview().models}>
                    {([key, m]) => (
                      <Bar
                        label={key}
                        value={m.calls}
                        total={overview().turns}
                        right={`${m.calls} calls · ${formatNumber(m.tokens)} tok · ${formatCost(m.cost)}`}
                      />
                    )}
                  </For>
                </div>
              </Show>

              <Show when={overview().tools.length > 0}>
                <div class="flex flex-col gap-2">
                  <span class="text-12-medium text-text-weaker uppercase tracking-wide">Tools</span>
                  <For each={overview().tools}>
                    {([name, count]) => <Bar label={name} value={count} total={overview().toolTotal} />}
                  </For>
                </div>
              </Show>
            </div>
          </Show>

          <Show when={tab() === "diagnostics" && messages().length > 0}>
            <div class="flex flex-col gap-4 p-1">
              <div class="grid grid-cols-2 sm:grid-cols-3 gap-2">
                <StatTile label="Model turns" value={formatNumber(diagnostics().turns)} />
                <StatTile label="Model steps" value={formatNumber(diagnostics().steps)} />
                <StatTile
                  label="Guardrail hits"
                  value={formatNumber(diagnostics().guardrail)}
                  accent={diagnostics().guardrail > 0 ? "text-orange-500" : "text-text-base"}
                />
                <StatTile
                  label="Errors"
                  value={formatNumber(diagnostics().errored)}
                  accent={diagnostics().errored > 0 ? "text-red-500" : "text-text-base"}
                />
                <StatTile
                  label="Stuck / aborted"
                  value={`${diagnostics().stuckNudged} / ${diagnostics().stuckAborted}`}
                  accent={diagnostics().stuckAborted > 0 ? "text-red-500" : "text-text-base"}
                />
                <StatTile
                  label="Step-capped"
                  value={formatNumber(diagnostics().stepCapped)}
                  accent={diagnostics().stepCapped > 0 ? "text-yellow-500" : "text-text-base"}
                />
              </div>

              <div class="flex flex-col gap-2">
                <span class="text-12-medium text-text-weaker uppercase tracking-wide">Finish reasons</span>
                <For each={diagnostics().finishes}>
                  {([reason, count]) => (
                    <Bar
                      label={reason}
                      value={count}
                      total={diagnostics().steps}
                      accent={reason === GUARDRAIL_FINISH ? "bg-orange-500" : reason === "error" ? "bg-red-500" : "bg-accent-base"}
                    />
                  )}
                </For>
              </div>

              <Show when={diagnostics().errors.length > 0}>
                <div class="flex flex-col gap-2">
                  <span class="text-12-medium text-text-weaker uppercase tracking-wide">Errors by type</span>
                  <For each={diagnostics().errors}>
                    {([name, count]) => <Bar label={name} value={count} total={diagnostics().errored} accent="bg-red-500" />}
                  </For>
                </div>
              </Show>
            </div>
          </Show>
        </div>
      </div>
    </Dialog>
  )
}
