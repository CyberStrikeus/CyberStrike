import { useDialog } from "@tui/ui/dialog"
import { useSDK } from "../context/sdk"
import { useSync } from "@tui/context/sync"
import { useTheme } from "../context/theme"
import { DialogPrompt } from "../ui/dialog-prompt"
import { TextAttributes } from "@opentui/core"
import { DialogModel } from "./dialog-model"

export function AnthropicSetupFlow() {
  const dialog = useDialog()
  const sdk = useSDK()
  const sync = useSync()
  const { theme } = useTheme()

  return (
    <DialogPrompt
      title="Anthropic API key"
      placeholder="sk-ant-..."
      description={
        <box gap={1}>
          <text fg={theme.textMuted}>Enter your API key (starts with sk-ant-api...)</text>
          <text fg={theme.primary}>https://console.anthropic.com/settings/keys</text>
        </box>
      }
      onConfirm={async (value) => {
        if (!value) return

        dialog.replace(() => <AnthropicConnectingStep />)

        try {
          await sdk.client.auth.set({
            providerID: "anthropic",
            auth: {
              type: "api",
              key: value,
            },
          })
          await sdk.client.instance.dispose()
          await sync.bootstrap()
          dialog.replace(() => <DialogModel providerID="anthropic" />)
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          dialog.replace(() => <AnthropicErrorStep error={msg} />)
        }
      }}
    />
  )
}

function AnthropicConnectingStep() {
  const dialog = useDialog()
  const { theme } = useTheme()

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          Connecting...
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>
      <text fg={theme.textMuted}>Setting up Anthropic provider...</text>
    </box>
  )
}

function AnthropicErrorStep(props: { error: string }) {
  const dialog = useDialog()
  const { theme } = useTheme()

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          Setup failed
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>
      <text fg={theme.error}>{props.error}</text>
      <text fg={theme.textMuted} onMouseUp={() => dialog.replace(() => <AnthropicSetupFlow />)}>
        Press enter to try again
      </text>
    </box>
  )
}
