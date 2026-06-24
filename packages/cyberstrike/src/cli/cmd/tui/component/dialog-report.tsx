import { Show, createSignal, onMount } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { useTheme } from "../context/theme"
import { useDialog } from "@tui/ui/dialog"
import { useSDK } from "@tui/context/sdk"
import { useKeyboard } from "@opentui/solid"

export function DialogReport(props: { sessionID: string; onGenerate?: () => void }) {
  const { theme } = useTheme()
  const dialog = useDialog()
  const sdk = useSDK()

  const [loading, setLoading] = createSignal(true)
  const [data, setData] = createSignal<any>(null)
  const [error, setError] = createSignal<string>()

  onMount(() => {
    dialog.setSize("large")
    sdk.client.methodology
      .reportCompile({ sessionID: props.sessionID })
      .then((r) => {
        setData(r.data)
        setLoading(false)
      })
      .catch((e: any) => {
        setError(String(e))
        setLoading(false)
      })
  })

  useKeyboard((evt) => {
    if (evt.defaultPrevented) return
    if (evt.name === "escape") {
      evt.preventDefault()
      dialog.clear()
    }
    if (evt.name === "return") {
      evt.preventDefault()
      props.onGenerate?.()
      dialog.clear()
    }
  })

  return (
    <box paddingLeft={2} paddingRight={2} paddingBottom={1} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          Report Summary
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>

      <Show when={loading()}>
        <box paddingTop={1}>
          <text fg={theme.textMuted}>Loading report data...</text>
        </box>
      </Show>

      <Show when={error()}>
        <box paddingTop={1}>
          <text fg={theme.error}>Error: {error()}</text>
        </box>
      </Show>

      <Show when={!loading() && !error() && data()}>
        {(d) => {
          const report = d() as any
          const findings = report.findings ?? []
          const crit = findings.filter((f: any) => f.severity === "critical").length
          const high = findings.filter((f: any) => f.severity === "high").length
          const med = findings.filter((f: any) => f.severity === "medium").length
          const low = findings.filter((f: any) => f.severity === "low").length
          const info = findings.filter((f: any) => f.severity === "info").length

          return (
            <box flexDirection="column" gap={1} paddingTop={1}>
              <text attributes={TextAttributes.BOLD} fg={theme.text}>
                {report.session?.title ?? "Session"}
              </text>

              <box flexDirection="column">
                <text fg={theme.text}>Findings: {findings.length} total</text>
                <text fg={theme.textMuted}>
                  {"  "}
                  <Show when={crit > 0}>
                    <span style={{ fg: theme.error }}>{crit} Critical</span>{" "}
                  </Show>
                  <Show when={high > 0}>
                    <span style={{ fg: theme.error }}>{high} High</span>{" "}
                  </Show>
                  <Show when={med > 0}>
                    <span style={{ fg: theme.warning }}>{med} Medium</span>{" "}
                  </Show>
                  <Show when={low > 0}>{low} Low </Show>
                  <Show when={info > 0}>{info} Info</Show>
                </text>
              </box>

              <box flexDirection="column">
                <text fg={theme.text}>
                  Coverage: {report.coverage?.coveragePercent ?? 0}% ({report.coverage?.completedChecks ?? 0}/
                  {report.coverage?.totalChecks ?? 0} VRT checks)
                </text>
                <text fg={theme.text}>
                  Methodology: {report.methodology?.completionPercent ?? 0}% ({report.methodology?.completedCount ?? 0}/
                  {report.methodology?.totalCount ?? 0} phases)
                </text>
                <text fg={theme.text}>
                  Chains: {(report.chains ?? []).filter((c: any) => c.status !== "disproven").length} active
                </text>
              </box>

              <box flexDirection="column">
                <text fg={theme.text}>
                  Validation:{" "}
                  <Show when={report.validation?.passed} fallback={<span style={{ fg: theme.error }}>FAILED</span>}>
                    <span style={{ fg: theme.success }}>PASSED</span>
                  </Show>{" "}
                  ({report.validation?.blockingCount ?? 0} blocking, {report.validation?.warningCount ?? 0} warnings)
                </text>
                <text fg={theme.text}>Requests: {report.requests?.total ?? 0} total</text>
              </box>

              <box paddingTop={1}>
                <text
                  fg={theme.primary}
                  onMouseUp={() => {
                    props.onGenerate?.()
                    dialog.clear()
                  }}
                >
                  Press Enter to generate report via agent
                </text>
              </box>
            </box>
          )
        }}
      </Show>

      <box paddingTop={1}>
        <text fg={theme.textMuted}>Enter Generate Esc Close</text>
      </box>
    </box>
  )
}
