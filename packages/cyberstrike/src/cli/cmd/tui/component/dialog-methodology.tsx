import { For, Show, createMemo, createSignal, onMount } from "solid-js"
import { ScrollBoxRenderable, TextAttributes } from "@opentui/core"
import { useTheme } from "../context/theme"
import { useDialog } from "@tui/ui/dialog"
import { useSDK } from "@tui/context/sdk"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"

type SectionID = "intel" | "coverage" | "chains" | "phases" | "violations"

// View-only methodology browser (/methodology). Snapshot — fetched on open via
// the /methodology routes; re-open to refresh. The sidebar shows a live digest;
// this dialog is the detail view.
export function DialogMethodology(props: { sessionID: string }) {
  const { theme } = useTheme()
  const dialog = useDialog()
  const sdk = useSDK()
  const dimensions = useTerminalDimensions()
  const listMaxHeight = createMemo(() => Math.max(8, Math.floor(dimensions().height / 2) - 8))
  let scroll: ScrollBoxRenderable | undefined

  const sections: { id: SectionID; label: string }[] = [
    { id: "intel", label: "Intel" },
    { id: "coverage", label: "Coverage" },
    { id: "chains", label: "Chains" },
    { id: "phases", label: "Phases" },
    { id: "violations", label: "Violations" },
  ]

  const [section, setSection] = createSignal<SectionID>("intel")
  const [index, setIndex] = createSignal(0)
  const [mode, setMode] = createSignal<"list" | "detail">("list")

  const [intel, setIntel] = createSignal<any[]>([])
  const [coverage, setCoverage] = createSignal<any[]>([])
  const [chains, setChains] = createSignal<any[]>([])
  const [phases, setPhases] = createSignal<any[]>([])
  const [violations, setViolations] = createSignal<any[]>([])

  onMount(() => {
    dialog.setSize("large")
    const sessionID = props.sessionID
    sdk.client.methodology
      .intel({ sessionID })
      .then((r) => setIntel((r.data as any[]) ?? []))
      .catch(() => {})
    sdk.client.methodology
      .assetCoverage({ sessionID })
      .then((r) => setCoverage((r.data as any[]) ?? []))
      .catch(() => {})
    sdk.client.methodology
      .chains({ sessionID })
      .then((r) => setChains((r.data as any[]) ?? []))
      .catch(() => {})
    sdk.client.methodology
      .state({ sessionID })
      .then((r) => {
        const d = r.data as any
        setPhases(d?.phases ?? [])
        setViolations(d?.violations ?? [])
      })
      .catch(() => {})
  })

  const items = createMemo<any[]>(() => {
    switch (section()) {
      case "intel":
        return intel()
      case "coverage":
        return coverage()
      case "chains":
        return chains()
      case "phases":
        return phases()
      case "violations":
        return violations()
    }
  })

  const selectedItem = createMemo(() => {
    const list = items()
    const i = index()
    if (i < 0 || i >= list.length) return undefined
    return list[i]
  })

  const titleSuffix = createMemo(() => sections.find((s) => s.id === section())?.label ?? "")

  const ensureVisible = (i: number) => {
    if (!scroll) return
    const child = scroll.getChildren()[i]
    if (!child) return
    const y = child.y
    const height = scroll.height
    if (y >= height) scroll.scrollBy(y - height + 1)
    if (y < 0) scroll.scrollBy(y)
  }

  const moveSection = (direction: number) => {
    const pos = sections.findIndex((x) => x.id === section())
    if (pos === -1) return
    let next = pos + direction
    if (next >= sections.length) next = 0
    if (next < 0) next = sections.length - 1
    setSection(sections[next].id)
    setIndex(0)
    setMode("list")
  }

  useKeyboard((evt) => {
    if (evt.defaultPrevented) return
    if (evt.name === "left" || evt.name === "h") {
      evt.preventDefault()
      moveSection(-1)
    }
    if (evt.name === "right" || evt.name === "l") {
      evt.preventDefault()
      moveSection(1)
    }
    if (evt.name === "up" || evt.name === "k") {
      const list = items()
      if (list.length === 0) return
      evt.preventDefault()
      const next = index() - 1
      const value = next < 0 ? list.length - 1 : next
      setIndex(value)
      ensureVisible(value)
    }
    if (evt.name === "down" || evt.name === "j") {
      const list = items()
      if (list.length === 0) return
      evt.preventDefault()
      const next = index() + 1
      const value = next >= list.length ? 0 : next
      setIndex(value)
      ensureVisible(value)
    }
    if (evt.name === "return") {
      if (items().length === 0) return
      evt.preventDefault()
      setMode((prev) => (prev === "list" ? "detail" : "list"))
    }
    if (evt.name === "escape") {
      evt.preventDefault()
      if (mode() === "detail") setMode("list")
      else dialog.clear()
    }
  })

  const sev = (s?: string) =>
    s === "critical" || s === "high" || s === "blocking"
      ? theme.error
      : s === "medium" || s === "warning"
        ? theme.warning
        : theme.textMuted

  return (
    <box paddingLeft={2} paddingRight={2} paddingBottom={1} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          Methodology · {titleSuffix()} ({items().length})<Show when={mode() === "detail"}> · Detail</Show>
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>

      <box flexDirection="row" gap={1} paddingTop={1}>
        <For each={sections}>
          {(s) => {
            const active = () => s.id === section()
            return (
              <box paddingLeft={1} paddingRight={1} backgroundColor={active() ? theme.primary : undefined}>
                <text fg={active() ? theme.selectedListItemText : theme.textMuted}>{s.label}</text>
              </box>
            )
          }}
        </For>
      </box>

      <Show
        when={mode() === "detail" && selectedItem()}
        fallback={
          <Show
            when={items().length > 0}
            fallback={
              <box paddingTop={1}>
                <text fg={theme.textMuted}>No {titleSuffix().toLowerCase()} for this session yet.</text>
              </box>
            }
          >
            <box paddingTop={1}>
              <scrollbox
                flexGrow={1}
                maxHeight={listMaxHeight()}
                ref={(r: ScrollBoxRenderable) => {
                  scroll = r
                }}
              >
                <For each={items()}>
                  {(item, i) => {
                    const v = () => item as any
                    const active = () => i() === index()
                    return (
                      <box
                        paddingTop={1}
                        paddingBottom={1}
                        paddingLeft={2}
                        paddingRight={2}
                        backgroundColor={active() ? theme.backgroundElement : undefined}
                        flexDirection="column"
                      >
                        <Show when={section() === "intel"}>
                          <text fg={theme.text}>
                            <span style={{ fg: sev(v().severity) }}>[{(v().severity ?? "info").toUpperCase()}]</span>{" "}
                            {v().title}
                          </text>
                          <text fg={theme.textMuted}>
                            {v().type} · {v().asset} · {v().confidenceLevel ?? v().confidence_level ?? "—"}
                          </text>
                        </Show>
                        <Show when={section() === "coverage"}>
                          <text fg={theme.text}>{v().asset}</text>
                          <text fg={theme.textMuted}>
                            {v().completedChecks}/{v().totalChecks} checked ({v().coveragePercent}%) ·{" "}
                            {v().vulnerableChecks} vulnerable
                          </text>
                        </Show>
                        <Show when={section() === "chains"}>
                          <text fg={theme.warning}>{v().pattern}</text>
                          <text fg={theme.textMuted}>
                            {v().expectedImpact ?? "—"}
                            <Show when={v().confidence != null}> · confidence {v().confidence}</Show>
                          </text>
                        </Show>
                        <Show when={section() === "phases"}>
                          <text fg={theme.text}>
                            <span style={{ fg: v().status === "completed" ? theme.success : theme.textMuted }}>
                              {v().status === "completed" ? "✓" : v().status === "in_progress" ? "●" : "◌"}
                            </span>{" "}
                            {v().name}
                          </text>
                          <text fg={theme.textMuted}>
                            {v().id} · {v().status} · {v().deliverableCount} deliverable
                            {v().deliverableCount === 1 ? "" : "s"}
                          </text>
                        </Show>
                        <Show when={section() === "violations"}>
                          <text fg={theme.text}>
                            <span style={{ fg: sev(v().severity) }}>[{(v().severity ?? "").toUpperCase()}]</span>{" "}
                            {v().gate}
                          </text>
                          <text fg={theme.textMuted} wrapMode="word">
                            {v().message}
                          </text>
                        </Show>
                      </box>
                    )
                  }}
                </For>
              </scrollbox>
            </box>
          </Show>
        }
      >
        {(item) => (
          <box paddingTop={1}>
            <scrollbox flexGrow={1} maxHeight={listMaxHeight()} gap={1}>
              <For each={Object.entries(item() as Record<string, any>)}>
                {([key, value]) => (
                  <box flexDirection="column">
                    <text attributes={TextAttributes.BOLD} fg={theme.textMuted}>
                      {key}
                    </text>
                    <text fg={theme.text} wrapMode="word">
                      {typeof value === "object" && value !== null ? JSON.stringify(value) : String(value ?? "—")}
                    </text>
                  </box>
                )}
              </For>
            </scrollbox>
          </box>
        )}
      </Show>

      <box paddingTop={1}>
        <text fg={theme.textMuted}>
          <Show when={mode() === "detail"} fallback="←→ Section  ↑↓ Navigate  Enter Details  Esc Close">
            Enter Back Esc Close
          </Show>
        </text>
      </box>
    </box>
  )
}
