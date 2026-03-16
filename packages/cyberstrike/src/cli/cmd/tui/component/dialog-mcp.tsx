import { createMemo, createSignal } from "solid-js"
import { useLocal } from "@tui/context/local"
import { useSync } from "@tui/context/sync"
import { map, pipe, entries, sortBy } from "remeda"
import { DialogSelect, type DialogSelectRef, type DialogSelectOption } from "@tui/ui/dialog-select"
import { useTheme } from "../context/theme"
import { Keybind } from "@/util/keybind"
import { TextAttributes } from "@opentui/core"
import { useSDK } from "@tui/context/sdk"
import { useDialog } from "@tui/ui/dialog"
import { DialogPrompt } from "../ui/dialog-prompt"

function Status(props: { enabled: boolean; loading: boolean }) {
  const { theme } = useTheme()
  if (props.loading) {
    return <span style={{ fg: theme.textMuted }}>⋯ Loading</span>
  }
  if (props.enabled) {
    return <span style={{ fg: theme.success, attributes: TextAttributes.BOLD }}>✓ Enabled</span>
  }
  return <span style={{ fg: theme.textMuted }}>○ Disabled</span>
}

export function DialogMcp() {
  const local = useLocal()
  const sync = useSync()
  const sdk = useSDK()
  const dialog = useDialog()
  const [, setRef] = createSignal<DialogSelectRef<unknown>>()
  const [loading, setLoading] = createSignal<string | null>(null)

  const options = createMemo(() => {
    const mcpData = sync.data.mcp
    const loadingMcp = loading()

    const mcpOptions = pipe(
      mcpData ?? {},
      entries(),
      sortBy(([name]) => name),
      map(([name, status]) => ({
        value: name,
        title: name,
        description: status.status === "failed" ? "failed" : status.status,
        footer: <Status enabled={local.mcp.isEnabled(name)} loading={loadingMcp === name} />,
        category: undefined as string | undefined,
      })),
    )

    mcpOptions.push({
      value: "__add__",
      title: "Add MCP Server",
      description: "(local or remote)",
      footer: undefined as any,
      category: undefined,
    })

    return mcpOptions
  })

  const keybinds = createMemo(() => [
    {
      keybind: Keybind.parse("space")[0],
      title: "toggle",
      onTrigger: async (option: DialogSelectOption<string>) => {
        if (option.value === "__add__") return
        if (loading() !== null) return

        setLoading(option.value)
        try {
          await local.mcp.toggle(option.value)
          const status = await sdk.client.mcp.status()
          if (status.data) {
            sync.set("mcp", status.data)
          }
        } catch (error) {
          console.error("Failed to toggle MCP:", error)
        } finally {
          setLoading(null)
        }
      },
    },
    {
      keybind: Keybind.parse("a")[0],
      title: "add",
      onTrigger: () => {
        dialog.replace(() => <McpAddFlow />)
      },
    },
  ])

  return (
    <DialogSelect
      ref={setRef}
      title="MCPs"
      options={options()}
      keybind={keybinds()}
      onSelect={(option) => {
        if (option.value === "__add__") {
          dialog.replace(() => <McpAddFlow />)
        }
      }}
    />
  )
}

// --- MCP Add Flow ---

function McpAddFlow() {
  const dialog = useDialog()

  return (
    <DialogSelect
      title="Add MCP Server"
      options={[
        {
          value: "local",
          title: "Local",
          description: "npx, bunx, binary, or script",
        },
        {
          value: "remote",
          title: "Remote",
          description: "HTTP/SSE URL",
        },
      ]}
      onSelect={(option) => {
        if (option.value === "local") {
          dialog.replace(() => <McpLocalCommandStep />)
        } else {
          dialog.replace(() => <McpRemoteUrlStep />)
        }
      }}
    />
  )
}

function McpLocalCommandStep(props: { error?: string }) {
  const dialog = useDialog()
  const { theme } = useTheme()

  return (
    <DialogPrompt
      title="Command"
      placeholder="npx my-mcp-server"
      description={
        props.error
          ? () => <text fg={theme.error}>{props.error}</text>
          : () => <text fg={theme.textMuted}>Full command to start the MCP server (e.g., npx cve-mcp)</text>
      }
      onConfirm={(value) => {
        if (!value) return
        const parts = value.trim().split(/\s+/)
        if (parts.length === 0) return
        const name = deriveName(parts)
        dialog.replace(() => <McpLocalEnvStep command={parts} defaultName={name} />)
      }}
    />
  )
}

function McpRemoteUrlStep(props: { error?: string }) {
  const dialog = useDialog()
  const { theme } = useTheme()

  return (
    <DialogPrompt
      title="URL"
      placeholder="https://mcp.example.com/sse"
      description={
        props.error
          ? () => <text fg={theme.error}>{props.error}</text>
          : undefined
      }
      onConfirm={(value) => {
        if (!value) return
        try {
          const url = new URL(value)
          const name = url.hostname.replace(/\./g, "-")
          dialog.replace(() => <McpNameStep type="remote" url={value} defaultName={name} />)
        } catch {
          dialog.replace(() => <McpRemoteUrlStep error="Invalid URL" />)
        }
      }}
    />
  )
}

function McpLocalEnvStep(props: { command: string[]; defaultName: string }) {
  const dialog = useDialog()

  return (
    <DialogPrompt
      title="Environment variables (optional)"
      placeholder="KEY=VALUE, KEY2=VALUE2"
      description={() => (
        <text fg={useTheme().theme.textMuted}>Comma-separated KEY=VALUE pairs, or leave empty</text>
      )}
      onConfirm={(value) => {
        const env = parseEnvVars(value || "")
        dialog.replace(() => (
          <McpNameStep
            type="local"
            command={props.command}
            environment={Object.keys(env).length > 0 ? env : undefined}
            defaultName={props.defaultName}
          />
        ))
      }}
    />
  )
}

interface McpNameStepProps {
  type: "local" | "remote"
  command?: string[]
  environment?: Record<string, string>
  url?: string
  defaultName: string
}

function McpNameStep(props: McpNameStepProps) {
  const dialog = useDialog()
  const sdk = useSDK()
  const sync = useSync()

  return (
    <DialogPrompt
      title="Server name"
      placeholder={props.defaultName}
      onConfirm={async (value) => {
        const name = (value || props.defaultName).toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-|-$/g, "")
        if (!name) return

        const config = props.type === "local"
          ? { type: "local" as const, command: props.command!, environment: props.environment }
          : { type: "remote" as const, url: props.url! }

        dialog.replace(() => <McpConnectingStep name={name} config={config} />)

        try {
          // Persist to config file
          await sdk.client.config.update({
            config: { mcp: { [name]: config } },
          })

          // Connect the MCP server
          await sdk.client.mcp.add({ name, config })

          // Refresh status
          const status = await sdk.client.mcp.status()
          if (status.data) {
            sync.set("mcp", status.data)
          }

          const serverStatus = status.data?.[name]?.status ?? "unknown"
          dialog.replace(() => <McpDoneStep name={name} status={serverStatus} />)
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          if (props.type === "local") {
            dialog.replace(() => <McpLocalCommandStep error={msg} />)
          } else {
            dialog.replace(() => <McpRemoteUrlStep error={msg} />)
          }
        }
      }}
    />
  )
}

function McpConnectingStep(props: { name: string; config: any }) {
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
      <text fg={theme.textMuted}>Connecting to {props.name}...</text>
    </box>
  )
}

function McpDoneStep(props: { name: string; status: string }) {
  const dialog = useDialog()
  const { theme } = useTheme()

  const statusColor = () => {
    if (props.status === "connected") return theme.success
    if (props.status === "failed") return theme.error
    return theme.warning
  }

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          MCP server added
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>
      <text fg={statusColor()}>
        {props.name} — {props.status}
      </text>
    </box>
  )
}

// --- Bolt Flow ---

function BoltUrlStep(props: { error?: string }) {
  const dialog = useDialog()
  const { theme } = useTheme()

  return (
    <DialogPrompt
      title="Bolt URL"
      placeholder="http://myserver:3001"
      description={
        props.error
          ? () => <text fg={theme.error}>{props.error}</text>
          : () => <text fg={theme.textMuted}>URL of the Bolt server (Docker container)</text>
      }
      onConfirm={(value) => {
        if (!value) return
        try {
          new URL(value)
          dialog.replace(() => <BoltTokenStep url={value} />)
        } catch {
          dialog.replace(() => <BoltUrlStep error="Invalid URL" />)
        }
      }}
    />
  )
}

function BoltTokenStep(props: { url: string; error?: string }) {
  const dialog = useDialog()
  const { theme } = useTheme()

  return (
    <DialogPrompt
      title="Admin Token"
      placeholder="paste admin token here"
      description={
        props.error
          ? () => <text fg={theme.error}>{props.error}</text>
          : () => <text fg={theme.textMuted}>From: docker logs bolt | grep "Admin token"</text>
      }
      onConfirm={(value) => {
        if (!value) return
        const url = new URL(props.url)
        const defaultName = url.hostname === "localhost" || url.hostname === "127.0.0.1"
          ? "bolt"
          : url.hostname.replace(/\./g, "-")
        dialog.replace(() => <BoltNameStep url={props.url} adminToken={value} defaultName={defaultName} />)
      }}
    />
  )
}

function BoltNameStep(props: { url: string; adminToken: string; defaultName: string }) {
  const dialog = useDialog()
  const sdk = useSDK()
  const sync = useSync()

  return (
    <DialogPrompt
      title="Server name"
      placeholder={props.defaultName}
      onConfirm={async (value) => {
        const name = (value || props.defaultName).toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-|-$/g, "")
        if (!name) return

        dialog.replace(() => <BoltPairingStep name={name} />)

        try {
          // 1. Pair with Bolt server (Ed25519 key exchange)
          const pairRes = await sdk.fetch(`${sdk.url}/bolt/${name}/pair`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: props.url, adminToken: props.adminToken }),
          })
          if (!pairRes.ok) {
            const err = await pairRes.json().catch(() => ({ error: "Pairing failed" }))
            throw new Error((err as any).error ?? `Pairing failed (${pairRes.status})`)
          }

          // 2. Persist bolt config (separate from mcp)
          await sdk.client.config.update({
            config: { bolt: { [name]: { url: props.url } } } as any,
          })

          // 3. Connect via bolt route
          await sdk.fetch(`${sdk.url}/bolt`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, config: { url: props.url } }),
          })

          // 4. Refresh bolt status
          const statusRes = await sdk.fetch(`${sdk.url}/bolt`)
          const statusData = statusRes.ok ? await statusRes.json() : {}
          sync.set("bolt", statusData)

          const serverStatus = (statusData as any)?.[name]?.status ?? "unknown"
          dialog.replace(() => <BoltDoneStep name={name} status={serverStatus} />)
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          dialog.replace(() => <BoltUrlStep error={msg} />)
        }
      }}
    />
  )
}

function BoltPairingStep(props: { name: string }) {
  const dialog = useDialog()
  const { theme } = useTheme()

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          Pairing...
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>
      <text fg={theme.textMuted}>Pairing with {props.name}...</text>
    </box>
  )
}

// --- Helpers ---

function deriveName(command: string[]): string {
  // npx cve-mcp → cve-mcp
  // bunx hackbrowser-mcp → hackbrowser-mcp
  // bun run /path/to/hackbrowser-mcp/src/index.ts --mcp → hackbrowser-mcp
  // bun run ./server.ts → server
  // /path/to/binary → binary
  const runner = command[0]
  if ((runner === "npx" || runner === "bunx") && command.length > 1) {
    return command[1].replace(/^@[^/]+\//, "")
  }
  if (runner === "bun" && command[1] === "run" && command.length > 2) {
    return nameFromPath(command[2])
  }
  if (runner === "node" && command.length > 1) {
    return nameFromPath(command[1])
  }
  if (command.length === 1) {
    return nameFromPath(runner)
  }
  // Find first arg that looks like a file path
  const file = command.slice(1).find((a) => !a.startsWith("-"))
  return file ? nameFromPath(file) : nameFromPath(runner)
}

function nameFromPath(filepath: string): string {
  const parts = filepath.replace(/\\/g, "/").split("/").filter(Boolean)
  const filename = parts[parts.length - 1] ?? filepath
  const base = filename.replace(/\.[^.]+$/, "")
  // If filename is index/main/server, use parent dir (skip src/dist/lib)
  if (["index", "main", "server", "app"].includes(base) && parts.length > 1) {
    const skip = new Set(["src", "dist", "lib", "bin", "build"])
    for (let i = parts.length - 2; i >= 0; i--) {
      if (!skip.has(parts[i])) return parts[i]
    }
  }
  return base
}

function parseEnvVars(input: string): Record<string, string> {
  const env: Record<string, string> = {}
  if (!input.trim()) return env
  const pairs = input.split(",").map((s) => s.trim()).filter(Boolean)
  for (const pair of pairs) {
    const eq = pair.indexOf("=")
    if (eq > 0) {
      env[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim()
    }
  }
  return env
}

// --- Bolt Dialog (standalone /bolt command) ---

export function DialogBolt() {
  const sync = useSync()
  const sdk = useSDK()
  const dialog = useDialog()
  const [, setRef] = createSignal<DialogSelectRef<unknown>>()
  const [loading, setLoading] = createSignal<string | null>(null)

  const options = createMemo(() => {
    const boltData = sync.data.bolt
    const loadingBolt = loading()

    const boltOptions = pipe(
      boltData ?? {},
      entries(),
      sortBy(([name]) => name),
      map(([name, status]) => ({
        value: name,
        title: name,
        description: status.status === "failed" ? "failed" : status.status,
        footer: <BoltStatus status={status.status} loading={loadingBolt === name} />,
        category: undefined as string | undefined,
      })),
    )

    boltOptions.push({
      value: "__add_bolt__",
      title: "Add Bolt Server",
      description: "(Docker Kali container)",
      footer: undefined as any,
      category: undefined,
    })

    return boltOptions
  })

  const keybinds = createMemo(() => [
    {
      keybind: Keybind.parse("space")[0],
      title: "toggle",
      onTrigger: async (option: DialogSelectOption<string>) => {
        if (option.value === "__add_bolt__") return
        if (loading() !== null) return

        setLoading(option.value)
        try {
          const action = (sync.data.bolt?.[option.value]?.status === "disabled") ? "connect" : "disconnect"
          await sdk.fetch(`${sdk.url}/bolt/${option.value}/${action}`, { method: "POST" })
          const statusRes = await sdk.fetch(`${sdk.url}/bolt`)
          if (statusRes.ok) {
            sync.set("bolt", await statusRes.json())
          }
        } catch (error) {
          console.error("Failed to toggle Bolt:", error)
        } finally {
          setLoading(null)
        }
      },
    },
    {
      keybind: Keybind.parse("a")[0],
      title: "add",
      onTrigger: () => {
        dialog.replace(() => <BoltUrlStep />)
      },
    },
  ])

  return (
    <DialogSelect
      ref={setRef}
      title="Bolt"
      options={options()}
      keybind={keybinds()}
      onSelect={(option) => {
        if (option.value === "__add_bolt__") {
          dialog.replace(() => <BoltUrlStep />)
        }
      }}
    />
  )
}

function BoltStatus(props: { status: string; loading: boolean }) {
  const { theme } = useTheme()
  if (props.loading) {
    return <span style={{ fg: theme.textMuted }}>... Loading</span>
  }
  if (props.status === "connected") {
    return <span style={{ fg: theme.success, attributes: TextAttributes.BOLD }}>✓ Connected</span>
  }
  if (props.status === "disabled") {
    return <span style={{ fg: theme.textMuted }}>○ Disabled</span>
  }
  if (props.status === "needs_auth") {
    return <span style={{ fg: theme.warning }}>⚠ Needs pairing</span>
  }
  return <span style={{ fg: theme.error }}>✗ Failed</span>
}

function BoltDoneStep(props: { name: string; status: string }) {
  const dialog = useDialog()
  const { theme } = useTheme()

  const statusColor = () => {
    if (props.status === "connected") return theme.success
    if (props.status === "failed") return theme.error
    return theme.warning
  }

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          Bolt server added
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>
      <text fg={statusColor()}>
        {props.name} — {props.status}
      </text>
    </box>
  )
}
