import { createMemo, createSignal, onMount, Show } from "solid-js"
import { useSync } from "@tui/context/sync"
import { map, pipe, sortBy } from "remeda"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useDialog, type DialogContext } from "@tui/ui/dialog"
import { useSDK } from "../context/sdk"
import { DialogPrompt } from "../ui/dialog-prompt"
import { Link } from "../ui/link"
import { useTheme } from "../context/theme"
import { TextAttributes } from "@opentui/core"
import type { ProviderAuthAuthorization } from "@cyberstrike-io/sdk/v2"
import { DialogModel } from "./dialog-model"
import { useKeyboard } from "@opentui/solid"
import { Clipboard } from "@tui/util/clipboard"
import { useToast } from "../ui/toast"

const PROVIDER_PRIORITY: Record<string, number> = {
  cyberstrike: 0,
  anthropic: 1,
  "github-copilot": 2,
  openai: 3,
  google: 4,
}

export function createDialogProviderOptions() {
  const sync = useSync()
  const dialog = useDialog()
  const sdk = useSDK()
  const options = createMemo(() => {
    const providerOptions = pipe(
      sync.data.provider_next.all,
      sortBy((x) => PROVIDER_PRIORITY[x.id] ?? 99),
      map((provider) => ({
        title: provider.name,
        value: provider.id,
        description: {
          cyberstrike: "(Recommended)",
          anthropic: "(Claude Max or API key)",
          openai: "(ChatGPT Plus/Pro or API key)",
        }[provider.id],
        category: provider.id in PROVIDER_PRIORITY ? "Popular" : "Other",
        async onSelect() {
          const methods = sync.data.provider_auth[provider.id] ?? [
            {
              type: "api",
              label: "API key",
            },
          ]
          let index: number | null = 0
          if (methods.length > 1) {
            index = await new Promise<number | null>((resolve) => {
              dialog.replace(
                () => (
                  <DialogSelect
                    title="Select auth method"
                    options={methods.map((x, index) => ({
                      title: x.label,
                      value: index,
                    }))}
                    onSelect={(option) => resolve(option.value)}
                  />
                ),
                () => resolve(null),
              )
            })
          }
          if (index == null) return
          const method = methods[index]
          if (method.type === "oauth") {
            const result = await sdk.client.provider.oauth.authorize({
              providerID: provider.id,
              method: index,
            })
            if (result.data?.method === "code") {
              dialog.replace(() => (
                <CodeMethod providerID={provider.id} title={method.label} index={index} authorization={result.data!} />
              ))
            }
            if (result.data?.method === "auto") {
              dialog.replace(() => (
                <AutoMethod providerID={provider.id} title={method.label} index={index} authorization={result.data!} />
              ))
            }
          }
          if (method.type === "api") {
            return dialog.replace(() => <ApiMethod providerID={provider.id} title={method.label} />)
          }
        },
      })),
    )

    providerOptions.push({
      title: "Custom / Local LLM",
      value: "__local__",
      description: "(vLLM, Ollama, llama.cpp)",
      category: "Other",
      async onSelect() {
        dialog.replace(() => <LocalProviderFlow />)
      },
    })

    return providerOptions
  })
  return options
}

export function DialogProvider() {
  const options = createDialogProviderOptions()
  return <DialogSelect title="Connect a provider" options={options()} />
}

interface AutoMethodProps {
  index: number
  providerID: string
  title: string
  authorization: ProviderAuthAuthorization
}
function AutoMethod(props: AutoMethodProps) {
  const { theme } = useTheme()
  const sdk = useSDK()
  const dialog = useDialog()
  const sync = useSync()
  const toast = useToast()

  useKeyboard((evt) => {
    if (evt.name === "c" && !evt.ctrl && !evt.meta) {
      const code = props.authorization.instructions.match(/[A-Z0-9]{4}-[A-Z0-9]{4,5}/)?.[0] ?? props.authorization.url
      Clipboard.copy(code)
        .then(() => toast.show({ message: "Copied to clipboard", variant: "info" }))
        .catch(toast.error)
    }
  })

  onMount(async () => {
    const result = await sdk.client.provider.oauth.callback({
      providerID: props.providerID,
      method: props.index,
    })
    if (result.error) {
      dialog.clear()
      return
    }
    await sdk.client.instance.dispose()
    await sync.bootstrap()
    dialog.replace(() => <DialogModel providerID={props.providerID} />)
  })

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          {props.title}
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>
      <box gap={1}>
        <Link href={props.authorization.url} fg={theme.primary} />
        <text fg={theme.textMuted}>{props.authorization.instructions}</text>
      </box>
      <text fg={theme.textMuted}>Waiting for authorization...</text>
      <text fg={theme.text}>
        c <span style={{ fg: theme.textMuted }}>copy</span>
      </text>
    </box>
  )
}

interface CodeMethodProps {
  index: number
  title: string
  providerID: string
  authorization: ProviderAuthAuthorization
}
function CodeMethod(props: CodeMethodProps) {
  const { theme } = useTheme()
  const sdk = useSDK()
  const sync = useSync()
  const dialog = useDialog()
  const [error, setError] = createSignal(false)

  return (
    <DialogPrompt
      title={props.title}
      placeholder="Authorization code"
      onConfirm={async (value) => {
        const { error } = await sdk.client.provider.oauth.callback({
          providerID: props.providerID,
          method: props.index,
          code: value,
        })
        if (!error) {
          await sdk.client.instance.dispose()
          await sync.bootstrap()
          dialog.replace(() => <DialogModel providerID={props.providerID} />)
          return
        }
        setError(true)
      }}
      description={() => (
        <box gap={1}>
          <text fg={theme.textMuted}>{props.authorization.instructions}</text>
          <Link href={props.authorization.url} fg={theme.primary} />
          <Show when={error()}>
            <text fg={theme.error}>Invalid code</text>
          </Show>
        </box>
      )}
    />
  )
}

interface ApiMethodProps {
  providerID: string
  title: string
}
function ApiMethod(props: ApiMethodProps) {
  const dialog = useDialog()
  const sdk = useSDK()
  const sync = useSync()
  const { theme } = useTheme()

  return (
    <DialogPrompt
      title={props.title}
      placeholder="API key"
      description={
        props.providerID === "cyberstrike" ? (
          <box gap={1}>
            <text fg={theme.textMuted}>
              CyberStrike Zen gives you access to all the best coding models at the cheapest prices with a single API key.
            </text>
            <text fg={theme.text}>
              Go to <span style={{ fg: theme.primary }}>https://cyberstrike.io/zen</span> to get a key
            </text>
          </box>
        ) : undefined
      }
      onConfirm={async (value) => {
        if (!value) return
        await sdk.client.auth.set({
          providerID: props.providerID,
          auth: {
            type: "api",
            key: value,
          },
        })
        await sdk.client.instance.dispose()
        await sync.bootstrap()
        dialog.replace(() => <DialogModel providerID={props.providerID} />)
      }}
    />
  )
}

export function LocalProviderFlow() {
  const dialog = useDialog()

  return (
    <DialogPrompt
      title="Provider name"
      placeholder="Local Llama"
      onConfirm={(value) => {
        if (!value) return
        dialog.replace(() => <LocalUrlStep name={value} />)
      }}
    />
  )
}

function LocalUrlStep(props: { name: string; error?: string }) {
  const dialog = useDialog()
  const { theme } = useTheme()

  return (
    <DialogPrompt
      title="Base URL"
      placeholder="http://192.168.1.201:8000/v1"
      description={
        props.error
          ? () => <text fg={theme.error}>{props.error}</text>
          : undefined
      }
      onConfirm={(value) => {
        if (!value) return
        try {
          new URL(value)
        } catch {
          dialog.replace(() => <LocalUrlStep name={props.name} error="Invalid URL" />)
          return
        }
        dialog.replace(() => <LocalKeyStep name={props.name} url={value} />)
      }}
    />
  )
}

function LocalKeyStep(props: { name: string; url: string }) {
  const dialog = useDialog()
  const sdk = useSDK()
  const sync = useSync()

  return (
    <DialogPrompt
      title="API key (optional)"
      placeholder="sk-... or leave empty"
      onConfirm={async (value) => {
        const key = value || undefined
        const base = props.url
          .replace(/\/+$/, "")
          .replace(/\/(chat\/)?completions$/, "")
          .replace(/\/models$/, "")
        const providerID = props.name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "")

        dialog.replace(() => <LocalDiscoveringStep url={base} />)
        try {
          const modelsURL = base + "/models"
          const headers: Record<string, string> = { "Content-Type": "application/json" }
          if (key) headers["Authorization"] = `Bearer ${key}`
          const resp = await fetch(modelsURL, { headers, signal: AbortSignal.timeout(10_000) })
          if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText}`)
          const body = (await resp.json()) as { data?: { id: string; owned_by?: string }[] }
          if (!body.data?.length) throw new Error("No models found")

          const models: Record<string, { name: string; tool_call: boolean; limit: { context: number; output: number } }> = {}
          for (const m of body.data) {
            models[m.id] = { name: m.id, tool_call: true, limit: { context: 131072, output: 32768 } }
          }

          await sdk.client.config.update({
            config: {
              provider: {
                [providerID]: {
                  name: props.name,
                  api: base,
                  models,
                },
              },
            },
          })

          if (key) {
            await sdk.client.auth.set({
              providerID,
              auth: { type: "api", key },
            })
          }

          await sdk.client.instance.dispose()
          await sync.bootstrap()
          const modelIDs = body.data!.map((m) => m.id)
          dialog.replace(() => <LocalDoneStep providerID={providerID} modelIDs={modelIDs} />)
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          dialog.replace(() => <LocalUrlStep name={props.name} error={msg} />)
        }
      }}
    />
  )
}

function LocalDiscoveringStep(props: { url: string }) {
  const dialog = useDialog()
  const { theme } = useTheme()

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          Discovering models...
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>
      <text fg={theme.textMuted}>Connecting to {props.url}...</text>
    </box>
  )
}

function LocalDoneStep(props: { providerID: string; modelIDs: string[] }) {
  const dialog = useDialog()
  const { theme } = useTheme()

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          Provider added
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>
      <text fg={theme.accent}>
        {props.providerID} — {props.modelIDs.length} model(s)
      </text>
      <text fg={theme.textMuted}>
        {"Use: cyberstrike --model " + props.providerID + "/" + props.modelIDs[0]}
      </text>
    </box>
  )
}
