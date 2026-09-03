import { Show, createMemo } from "solid-js"
import { useParams } from "@solidjs/router"
import { useWorkbench } from "@/context/workbench"
import { activitySummary } from "@/pages/session/activity"

function Count(props: { value: number }) {
  return (
    <Show when={props.value > 0}>
      <span class="min-w-4 h-4 px-1 rounded-full bg-surface-accent-base text-10-medium text-text-accent-base tabular-nums">
        {Math.min(props.value, 99)}
      </span>
    </Show>
  )
}

export function WorkbenchBar(props: {
  busy: boolean
  observer: boolean
  onActivity: () => void
  onMission: () => void
  onTopology: () => void
  onMemory: () => void
}) {
  const params = useParams()
  const workbench = useWorkbench()
  const latest = createMemo(() => {
    const event = workbench.latest()
    return event ? activitySummary(event) : "Waiting for session activity"
  })

  return (
    <Show when={params.id}>
      <div
        class="h-8 shrink-0 flex items-center gap-1.5 px-2 border-b border-border-weak-base bg-background-stronger"
        role="status"
        aria-live="polite"
      >
        <button
          type="button"
          class="h-6 flex items-center gap-1.5 px-2 rounded bg-surface-base text-10-medium text-text-base hover:text-text-strong"
          onClick={props.onActivity}
          aria-label="Open live activity"
        >
          <span
            class="size-1.5 rounded-full"
            classList={{
              "bg-icon-success-base": workbench.connected && !props.busy,
              "bg-icon-warning-base animate-pulse": props.busy,
              "bg-icon-danger-base": !workbench.connected && !!workbench.error,
              "bg-surface-inset-base": !workbench.connected && !workbench.error,
            }}
          />
          <span>{props.busy ? "Agent running" : workbench.connected ? "Live" : "Connecting"}</span>
          <Count value={workbench.changes("activity")} />
        </button>
        <div class="hidden sm:flex items-center gap-1 text-10-mono text-text-weaker">
          <span>{workbench.count("tool")} tool events</span>
          <span>·</span>
          <span>{workbench.count("browser")} web events</span>
          <span>·</span>
          <span>{workbench.count("finding")} evidence</span>
        </div>
        <div class="flex-1 min-w-0 px-1 text-10-mono text-text-weak truncate" title={latest()}>
          {latest()}
        </div>
        <button
          type="button"
          class="hidden lg:flex h-6 items-center gap-1 px-2 rounded text-10-medium text-text-weak hover:bg-surface-base hover:text-text-base"
          onClick={props.onMission}
        >
          Mission <Count value={workbench.changes("mission")} />
        </button>
        <button
          type="button"
          class="hidden lg:flex h-6 items-center gap-1 px-2 rounded text-10-medium text-text-weak hover:bg-surface-base hover:text-text-base"
          onClick={props.onTopology}
        >
          Topology <Count value={workbench.changes("topology")} />
        </button>
        <Show when={!props.observer}>
          <button
            type="button"
            class="hidden lg:flex h-6 items-center gap-1 px-2 rounded text-10-medium text-text-weak hover:bg-surface-base hover:text-text-base"
            onClick={props.onMemory}
          >
            Memory <Count value={workbench.changes("memory")} />
          </button>
        </Show>
      </div>
    </Show>
  )
}
