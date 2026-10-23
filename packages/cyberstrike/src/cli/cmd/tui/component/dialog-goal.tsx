import { createMemo, Show } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { useDialog } from "@tui/ui/dialog"
import { DialogSelect } from "@tui/ui/dialog-select"
import { DialogPrompt } from "@tui/ui/dialog-prompt"
import { useSDK } from "@tui/context/sdk"
import { useSync } from "@tui/context/sync"
import { useLocal } from "@tui/context/local"
import { useTheme } from "@tui/context/theme"
import { useToast } from "@tui/ui/toast"
import { parseGoal, goalLabel } from "./prompt/goal"

export function useGoal() {
  const sdk = useSDK()
  const sync = useSync()
  const local = useLocal()
  const dialog = useDialog()
  const toast = useToast()
  return async (input: string, sessionID: string, isObjective = false) => {
    try {
      const command = isObjective ? { op: "create" as const, objective: input } : parseGoal(input)
      if (command.op === "dialog" || command.op === "status") {
        const result = await sdk.client.session.goalGet({ sessionID }, { throwOnError: true })
        sync.set("goal", sessionID, result.data ?? undefined)
        dialog.replace(() => <DialogGoal sessionID={sessionID} />)
        return true
      }
      if (command.op === "create") {
        const result = await sdk.client.session.goalCreate(
          {
            sessionID,
            objective: command.objective,
            durationSeconds: "durationSeconds" in command ? command.durationSeconds : undefined,
            model: local.model.current(),
            agent: local.agent.current().name,
            variant: local.model.variant.current(),
          },
          { throwOnError: true },
        )
        sync.set("goal", sessionID, result.data)
        return true
      }
      const result = await sdk.client.session.goalUpdate({ sessionID, body: command }, { throwOnError: true })
      sync.set("goal", sessionID, result.data)
      return true
    } catch (error) {
      toast.show({ variant: "error", message: error instanceof Error ? error.message : JSON.stringify(error) })
      return false
    }
  }
}

export function DialogGoal(props: { sessionID: string }) {
  const sync = useSync()
  const dialog = useDialog()
  const dispatch = useGoal()
  const { theme } = useTheme()
  const dimensions = useTerminalDimensions()
  const goal = createMemo(() => sync.data.goal[props.sessionID])
  const unfinished = () => goal() && !["completed", "dropped"].includes(goal()!.status)
  const create = () =>
    dialog.replace(() => (
      <DialogPrompt
        title="Goal objective"
        onConfirm={async (objective) => {
          if (await dispatch(objective, props.sessionID, true)) dialog.clear()
        }}
      />
    ))
  return (
    <box>
      <scrollbox maxHeight={Math.max(3, Math.floor(dimensions().height / 3))} paddingLeft={2} paddingRight={2}>
        <Show when={goal()} fallback={<text fg={theme.textMuted}>No goal in this session</text>}>
          {(goal) => (
            <box gap={1}>
              <text fg={theme.text}>
                {goalLabel(goal().status)}: {goal().objective}
              </text>
              <text fg={theme.textMuted}>
                Tokens: {goal().tokensUsed.toLocaleString()} / {goal().tokenBudget?.toLocaleString() ?? "unlimited"}.
                Time: {Math.round(goal().timeUsedSeconds)}s
              </text>
              <Show when={goal().deadlineAt}>
                <text fg={theme.textMuted}>Deadline: {new Date(goal().deadlineAt!).toLocaleString()}</text>
              </Show>
              <Show when={goal().reason}>
                <text fg={theme.textMuted}>{goal().reason}</text>
              </Show>
              <Show when={goal().report}>
                <text fg={theme.textMuted}>{goal().report}</text>
              </Show>
            </box>
          )}
        </Show>
      </scrollbox>
      <DialogSelect
        title="Goal"
        options={[
          { title: "Set an objective", value: "create", disabled: !!unfinished(), onSelect: create },
          {
            title: "Pause after this step",
            value: "pause",
            disabled: goal()?.status !== "active",
            onSelect: async () => {
              if (await dispatch("/goal pause", props.sessionID)) dialog.clear()
            },
          },
          {
            title: "Resume goal",
            value: "resume",
            disabled: !unfinished() || goal()?.status === "active",
            onSelect: async () => {
              if (await dispatch("/goal resume", props.sessionID)) dialog.clear()
            },
          },
          {
            title: "Change token budget",
            value: "budget",
            disabled: !unfinished(),
            onSelect: () =>
              dialog.replace(() => (
                <DialogPrompt
                  title="Token budget (number or off)"
                  value={String(goal()?.tokenBudget ?? "off")}
                  onConfirm={async (budget) => {
                    if (await dispatch(`/goal budget ${budget}`, props.sessionID)) dialog.clear()
                  }}
                />
              )),
          },
          {
            title: "Change duration",
            value: "duration",
            disabled: !unfinished(),
            onSelect: () =>
              dialog.replace(() => (
                <DialogPrompt
                  title="Duration (1m, 8h, 2d or off)"
                  onConfirm={async (duration) => {
                    if (await dispatch(`/goal duration ${duration}`, props.sessionID)) dialog.clear()
                  }}
                />
              )),
          },
          {
            title: "Drop goal without completion",
            value: "drop",
            disabled: !unfinished(),
            onSelect: async () => {
              if (await dispatch("/goal drop", props.sessionID)) dialog.clear()
            },
          },
        ]}
      />
    </box>
  )
}
