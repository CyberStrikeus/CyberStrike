import { For, Show, createMemo, createSignal } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { useSync } from "@tui/context/sync"
import { useKeyboard } from "@opentui/solid"
import { useTheme } from "../context/theme"
import { useDialog } from "@tui/ui/dialog"
import type { AssistantMessage, Message, Part } from "@cyberstrike-io/sdk/v2"

// TUI twin of the web /stats dialog (packages/app DialogStats) — same per-session token/cost/model/
// tool + LLM-diagnostics computation, rendered with opentui instead of the web's DOM so the command
// exists on BOTH surfaces (command catalog session.stats; see command-surface-parity.test.ts).
type TabID = "overview" | "diagnostics"
const TABS: { id: TabID; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "diagnostics", label: "LLM Diagnostics" },
]

// A finish reason meaning a safety/guardrail layer stopped the model — providers map their own stop
// reason onto "content-filter" upstream (session/processor.ts), so this is the one string to match.
const GUARDRAIL_FINISH = "content-filter"

const fmtNum = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}k` : n.toLocaleString())
const fmtCost = (n: number) => (n > 0 && n < 0.01 ? "<$0.01" : `$${n.toFixed(2)}`)
const fmtDur = (ms: number) => {
  if (ms <= 0) return "—"
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}
const bar = (value: number, total: number, width = 16) => {
  const fill = total > 0 ? Math.round((value / total) * width) : 0
  return "█".repeat(fill) + "░".repeat(Math.max(0, width - fill))
}

export function DialogStats(props: { sessionID: string }) {
  const sync = useSync()
  const { theme } = useTheme()
  const dialog = useDialog()
  const [tab, setTab] = createSignal<TabID>("overview")

  const messages = createMemo<Message[]>(() => sync.data.message?.[props.sessionID] ?? [])
  const assistants = createMemo(() => messages().filter((m): m is AssistantMessage => m.role === "assistant"))
  const parts = createMemo<Part[]>(() => {
    const byMessage = sync.data.part
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
      totalTokens: tokens.input + tokens.output + tokens.reasoning + tokens.cacheRead + tokens.cacheWrite,
      duration: firstStart === Infinity ? 0 : lastEnd - firstStart,
      models: [...models.entries()].sort((x, y) => y[1].calls - x[1].calls),
      tools: [...tools.entries()].sort((x, y) => y[1] - x[1]),
      toolTotal: [...tools.values()].reduce((s, n) => s + n, 0),
    }
  })

  const diagnostics = createMemo(() => {
    const a = assistants()
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

  const cycle = (dir: number) => {
    const i = TABS.findIndex((t) => t.id === tab())
    setTab(TABS[(i + dir + TABS.length) % TABS.length]!.id)
  }
  useKeyboard((evt) => {
    if (evt.name === "escape" || evt.name === "q") return dialog.clear()
    if (evt.name === "right" || evt.name === "tab" || evt.name === "l") return cycle(1)
    if (evt.name === "left" || evt.name === "h") return cycle(-1)
  })

  return (
    <box paddingLeft={2} paddingRight={2} paddingBottom={1} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          Stats
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          ←/→ tabs · esc
        </text>
      </box>

      <box flexDirection="row" gap={2} paddingTop={1}>
        <For each={TABS}>
          {(t) => (
            <text fg={t.id === tab() ? theme.accent : theme.textMuted} attributes={t.id === tab() ? TextAttributes.BOLD : undefined}>
              {t.label}
            </text>
          )}
        </For>
      </box>

      <Show when={messages().length === 0}>
        <box paddingTop={1}>
          <text fg={theme.textMuted}>No activity recorded for this session yet.</text>
        </box>
      </Show>

      <Show when={tab() === "overview" && messages().length > 0}>
        <box flexDirection="column" gap={1} paddingTop={1}>
          <box flexDirection="column">
            <Stat theme={theme} label="Assistant turns" value={fmtNum(overview().turns)} />
            <Stat theme={theme} label="User messages" value={fmtNum(overview().userMessages)} />
            <Stat theme={theme} label="Duration" value={fmtDur(overview().duration)} />
            <Stat theme={theme} label="Total tokens" value={fmtNum(overview().totalTokens)} />
            <Stat theme={theme} label="Cost" value={fmtCost(overview().cost)} />
            <Stat theme={theme} label="Tool calls" value={fmtNum(overview().toolTotal)} />
          </box>
          <box flexDirection="column">
            <text fg={theme.textMuted} attributes={TextAttributes.BOLD}>
              Tokens
            </text>
            <Stat theme={theme} label="Input" value={fmtNum(overview().tokens.input)} />
            <Stat theme={theme} label="Output" value={fmtNum(overview().tokens.output)} />
            <Stat theme={theme} label="Reasoning" value={fmtNum(overview().tokens.reasoning)} />
            <Stat theme={theme} label="Cache read" value={fmtNum(overview().tokens.cacheRead)} />
            <Stat theme={theme} label="Cache write" value={fmtNum(overview().tokens.cacheWrite)} />
          </box>
          <Show when={overview().models.length > 0}>
            <box flexDirection="column">
              <text fg={theme.textMuted} attributes={TextAttributes.BOLD}>
                Models
              </text>
              <For each={overview().models}>
                {([key, m]) => (
                  <box flexDirection="row" gap={1}>
                    <text fg={theme.accent}>{bar(m.calls, overview().turns)}</text>
                    <text fg={theme.text}>{key}</text>
                    <text fg={theme.textMuted}>{`${m.calls} calls · ${fmtNum(m.tokens)} tok · ${fmtCost(m.cost)}`}</text>
                  </box>
                )}
              </For>
            </box>
          </Show>
          <Show when={overview().tools.length > 0}>
            <box flexDirection="column">
              <text fg={theme.textMuted} attributes={TextAttributes.BOLD}>
                Tools
              </text>
              <For each={overview().tools}>
                {([name, count]) => (
                  <box flexDirection="row" gap={1}>
                    <text fg={theme.accent}>{bar(count, overview().toolTotal)}</text>
                    <text fg={theme.text}>{name}</text>
                    <text fg={theme.textMuted}>{String(count)}</text>
                  </box>
                )}
              </For>
            </box>
          </Show>
        </box>
      </Show>

      <Show when={tab() === "diagnostics" && messages().length > 0}>
        <box flexDirection="column" gap={1} paddingTop={1}>
          <box flexDirection="column">
            <Stat theme={theme} label="Model turns" value={fmtNum(diagnostics().turns)} />
            <Stat theme={theme} label="Model steps" value={fmtNum(diagnostics().steps)} />
            <Stat theme={theme} label="Guardrail hits" value={fmtNum(diagnostics().guardrail)} />
            <Stat theme={theme} label="Errors" value={fmtNum(diagnostics().errored)} />
            <Stat theme={theme} label="Stuck / aborted" value={`${diagnostics().stuckNudged} / ${diagnostics().stuckAborted}`} />
            <Stat theme={theme} label="Step-capped" value={fmtNum(diagnostics().stepCapped)} />
          </box>
          <Show when={diagnostics().finishes.length > 0}>
            <box flexDirection="column">
              <text fg={theme.textMuted} attributes={TextAttributes.BOLD}>
                Finish reasons
              </text>
              <For each={diagnostics().finishes}>
                {([reason, count]) => (
                  <box flexDirection="row" gap={1}>
                    <text fg={theme.accent}>{bar(count, diagnostics().steps)}</text>
                    <text fg={theme.text}>{reason}</text>
                    <text fg={theme.textMuted}>{String(count)}</text>
                  </box>
                )}
              </For>
            </box>
          </Show>
          <Show when={diagnostics().errors.length > 0}>
            <box flexDirection="column">
              <text fg={theme.textMuted} attributes={TextAttributes.BOLD}>
                Errors by type
              </text>
              <For each={diagnostics().errors}>
                {([name, count]) => (
                  <box flexDirection="row" gap={1}>
                    <text fg={theme.text}>{name}</text>
                    <text fg={theme.textMuted}>{String(count)}</text>
                  </box>
                )}
              </For>
            </box>
          </Show>
        </box>
      </Show>
    </box>
  )
}

function Stat(props: { theme: ReturnType<typeof useTheme>["theme"]; label: string; value: string }) {
  return (
    <box flexDirection="row" justifyContent="space-between">
      <text fg={props.theme.textMuted}>{props.label}</text>
      <text fg={props.theme.text}>{props.value}</text>
    </box>
  )
}
