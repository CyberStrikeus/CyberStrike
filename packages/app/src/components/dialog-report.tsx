import { Component, createResource, createSignal, Show } from "solid-js"
import { useSDK } from "@/context/sdk"
import { Dialog } from "@cyberstrike-io/ui/dialog"
import { Button } from "@cyberstrike-io/ui/button"
import { Spinner } from "@cyberstrike-io/ui/spinner"
import { showToast } from "@cyberstrike-io/ui/toast"

function Stat(props: { label: string; value: string | number }) {
  return (
    <div class="flex flex-col gap-0.5">
      <span class="text-11-regular text-text-weaker uppercase tracking-wide">{props.label}</span>
      <span class="text-16-medium text-text-base tabular-nums">{props.value}</span>
    </div>
  )
}

export const DialogReport: Component<{ sessionID: string }> = (props) => {
  const sdk = useSDK()
  const [downloading, setDownloading] = createSignal(false)

  // Compile is the authoritative summary (same call the TUI's report dialog makes).
  const [report] = createResource(
    () => props.sessionID,
    async (sessionID) => {
      const s = sdk()
      if (!s) throw new Error("not connected")
      const res = await s.client.methodology.reportCompile({ sessionID })
      if (!res.data) throw new Error("no report data")
      return res.data
    },
  )

  const download = async () => {
    if (downloading()) return
    setDownloading(true)
    try {
      const s = sdk()
      if (!s) return
      const res = await s.client.methodology.reportDownload({ sessionID: props.sessionID })
      const body = res.data
      const text = typeof body === "string" ? body : JSON.stringify(body, null, 2)
      const url = URL.createObjectURL(new Blob([text], { type: "text/markdown" }))
      const a = document.createElement("a")
      a.href = url
      a.download = `cyberstrike-report-${props.sessionID}.md`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      showToast({ title: "Report downloaded", variant: "success" })
    } catch {
      showToast({ title: "Failed to download report", variant: "error" })
    } finally {
      setDownloading(false)
    }
  }

  return (
    <Dialog title="Assessment Report" size="large">
      <div class="flex flex-col gap-4 min-h-0">
        <Show when={report.loading}>
          <div class="flex items-center gap-2 text-13-regular text-text-weaker">
            <Spinner /> Compiling report…
          </div>
        </Show>
        <Show when={report.error}>
          <div class="text-13-regular text-red-500">Failed to compile report.</div>
        </Show>
        <Show when={report()}>
          {(r) => (
            <>
              <div class="text-16-medium text-text-base">{r().session?.title ?? "Session"}</div>
              <div class="grid grid-cols-3 gap-4">
                <Stat label="Findings" value={r().findings?.length ?? 0} />
                <Stat label="Chains" value={r().chains?.length ?? 0} />
                <Stat label="Requests" value={r().requests?.total ?? 0} />
                <Stat label="Agents" value={r().agents?.length ?? 0} />
                <Stat label="Assets" value={r().assetCoverage?.length ?? 0} />
                <Stat label="Duration" value={`${Math.round((r().session?.duration ?? 0) / 1000)}s`} />
              </div>
              <div class="flex justify-end pt-2">
                <Button onClick={download} disabled={downloading()}>
                  {downloading() ? "Downloading…" : "Download report (.md)"}
                </Button>
              </div>
            </>
          )}
        </Show>
      </div>
    </Dialog>
  )
}
