import { Component, createMemo, createSignal, Match, Show, Switch as Cond } from "solid-js"
import { useSync } from "@/context/sync"
import { useSDK } from "@/context/sdk"
import { Dialog } from "@cyberstrike-io/ui/dialog"
import { List } from "@cyberstrike-io/ui/list"
import { Switch } from "@cyberstrike-io/ui/switch"
import { TextField } from "@cyberstrike-io/ui/text-field"
import { Button } from "@cyberstrike-io/ui/button"
import { IconButton } from "@cyberstrike-io/ui/icon-button"
import { Spinner } from "@cyberstrike-io/ui/spinner"
import { useLanguage } from "@/context/language"

type Step = "list" | "add-type" | "local-command" | "local-env" | "remote-url" | "name" | "connecting" | "done"

const statusLabels = {
  connected: "mcp.status.connected",
  failed: "mcp.status.failed",
  needs_auth: "mcp.status.needs_auth",
  disabled: "mcp.status.disabled",
} as const

function deriveName(command: string[]): string {
  const runner = command[0]
  if ((runner === "npx" || runner === "bunx") && command.length > 1)
    return command[1].replace(/^@[^/]+\//, "")
  if (runner === "bun" && command[1] === "run" && command.length > 2)
    return nameFromPath(command[2])
  if (runner === "node" && command.length > 1) return nameFromPath(command[1])
  if (command.length === 1) return nameFromPath(runner)
  const file = command.slice(1).find((a) => !a.startsWith("-"))
  return file ? nameFromPath(file) : nameFromPath(runner)
}

function nameFromPath(filepath: string): string {
  const parts = filepath.replace(/\\/g, "/").split("/").filter(Boolean)
  const filename = parts[parts.length - 1] ?? filepath
  const base = filename.replace(/\.[^.]+$/, "")
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
  const pairs = input
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
  for (const pair of pairs) {
    const eq = pair.indexOf("=")
    if (eq > 0) env[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim()
  }
  return env
}

function sanitizeName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-|-$/g, "")
}

export const DialogSelectMcp: Component = () => {
  const sync = useSync()
  const sdk = useSDK()
  const language = useLanguage()
  const [loading, setLoading] = createSignal<string | null>(null)
  const [step, setStep] = createSignal<Step>("list")
  const [error, setError] = createSignal("")
  const [addType, setAddType] = createSignal<"local" | "remote">("local")
  const [command, setCommand] = createSignal("")
  const [env, setEnv] = createSignal("")
  const [url, setUrl] = createSignal("")
  const [serverName, setServerName] = createSignal("")
  const [defaultName, setDefaultName] = createSignal("")
  const [doneInfo, setDoneInfo] = createSignal({ name: "", status: "" })

  const items = createMemo(() =>
    Object.entries(sync.data.mcp ?? {})
      .map(([name, status]) => ({ name, status: status.status }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  )

  const enabledCount = createMemo(() => items().filter((i) => i.status === "connected").length)
  const totalCount = createMemo(() => items().length)

  const toggle = async (name: string) => {
    if (loading()) return
    setLoading(name)
    try {
      const status = sync.data.mcp[name]
      if (status?.status === "connected") {
        await sdk.client.mcp.disconnect({ name })
      } else {
        await sdk.client.mcp.connect({ name })
      }
      const result = await sdk.client.mcp.status()
      if (result.data) sync.set("mcp", result.data)
    } finally {
      setLoading(null)
    }
  }

  const remove = async (name: string) => {
    if (loading()) return
    setLoading(name)
    try {
      await sdk.client.mcp.remove({ name })
      const result = await sdk.client.mcp.status()
      if (result.data) sync.set("mcp", result.data)
    } catch {} finally {
      setLoading(null)
    }
  }

  const resetForm = () => {
    setAddType("local")
    setCommand("")
    setEnv("")
    setUrl("")
    setServerName("")
    setDefaultName("")
    setError("")
  }

  const startAdd = () => {
    resetForm()
    setStep("add-type")
  }

  const back = () => {
    setError("")
    const s = step()
    if (s === "add-type") { setStep("list"); return }
    if (s === "local-command") { setStep("add-type"); return }
    if (s === "local-env") { setStep("local-command"); return }
    if (s === "remote-url") { setStep("add-type"); return }
    if (s === "name") {
      setStep(addType() === "local" ? "local-env" : "remote-url")
      return
    }
    if (s === "done") { setStep("list"); return }
    setStep("list")
  }

  const handleLocalCommand = () => {
    const val = command().trim()
    if (!val) return
    setDefaultName(deriveName(val.split(/\s+/)))
    setStep("local-env")
  }

  const handleLocalEnv = () => {
    setStep("name")
  }

  const handleRemoteUrl = () => {
    const val = url().trim()
    if (!val) return
    try {
      const parsed = new URL(val)
      setDefaultName(parsed.hostname.replace(/\./g, "-"))
      setError("")
      setStep("name")
    } catch {
      setError("Invalid URL")
    }
  }

  const handleName = async () => {
    const name = sanitizeName(serverName() || defaultName())
    if (!name) return

    if (sync.data.mcp?.[name]) {
      setError(`"${name}" already exists`)
      return
    }

    setStep("connecting")
    const parts = command().trim().split(/\s+/)
    const envMap = parseEnvVars(env())
    const config =
      addType() === "local"
        ? { type: "local" as const, command: parts, environment: Object.keys(envMap).length > 0 ? envMap : undefined }
        : { type: "remote" as const, url: url() }

    try {
      const addResult = await sdk.client.mcp.add({ name, config })
      const serverStatus = (addResult.data as Record<string, { status: string }>)?.[name]?.status ?? "unknown"

      if (serverStatus !== "connected") {
        await sdk.client.mcp.remove({ name }).catch(() => {})
        const errMsg =
          (addResult.data as Record<string, { error?: string }>)?.[name]?.error ?? `Connection failed (${serverStatus})`
        setError(errMsg)
        setStep(addType() === "local" ? "local-command" : "remote-url")
        return
      }

      await sdk.client.config.update({ config: { mcp: { [name]: config } } })
      const status = await sdk.client.mcp.status()
      if (status.data) sync.set("mcp", status.data)
      setDoneInfo({ name, status: serverStatus })
      setStep("done")
    } catch (e) {
      await sdk.client.mcp.remove({ name }).catch(() => {})
      setError(e instanceof Error ? e.message : String(e))
      setStep(addType() === "local" ? "local-command" : "remote-url")
    }
  }

  const title = () => {
    const s = step()
    if (s === "list") return language.t("dialog.mcp.title")
    if (s === "add-type") return language.t("dialog.mcp.add.title")
    if (s === "local-command") return language.t("dialog.mcp.add.command")
    if (s === "local-env") return language.t("dialog.mcp.add.env")
    if (s === "remote-url") return language.t("dialog.mcp.add.url")
    if (s === "name") return language.t("dialog.mcp.add.name")
    if (s === "connecting") return language.t("dialog.mcp.add.connecting")
    if (s === "done") return language.t("dialog.mcp.add.done")
    return language.t("dialog.mcp.title")
  }

  const description = () => {
    if (step() === "list") return language.t("dialog.mcp.description", { enabled: enabledCount(), total: totalCount() })
    return undefined
  }

  return (
    <Dialog title={title()} description={description()}>
      <Cond>
        {/* ─── List ─── */}
        <Match when={step() === "list"}>
          <List
            search={{
              placeholder: language.t("common.search.placeholder"),
              autofocus: true,
              action: <IconButton icon="plus-small" size="small" variant="ghost" onClick={startAdd} />,
            }}
            emptyMessage={language.t("dialog.mcp.empty")}
            key={(x) => x?.name ?? ""}
            items={items}
            filterKeys={["name", "status"]}
            sortBy={(a, b) => a.name.localeCompare(b.name)}
            onSelect={(x) => {
              if (x) toggle(x.name)
            }}
          >
            {(i) => {
              const mcpStatus = () => sync.data.mcp[i.name]
              const status = () => mcpStatus()?.status
              const statusLabel = () => {
                const key = status() ? statusLabels[status() as keyof typeof statusLabels] : undefined
                if (!key) return
                return language.t(key)
              }
              const err = () => {
                const s = mcpStatus()
                return s?.status === "failed" ? s.error : undefined
              }
              const enabled = () => status() === "connected"
              return (
                <div class="w-full flex items-center justify-between gap-x-3">
                  <div class="flex flex-col gap-0.5 min-w-0">
                    <div class="flex items-center gap-2">
                      <span class="truncate">{i.name}</span>
                      <Show when={statusLabel()}>
                        <span class="text-11-regular text-text-weaker">{statusLabel()}</span>
                      </Show>
                      <Show when={loading() === i.name}>
                        <span class="text-11-regular text-text-weak">{language.t("common.loading.ellipsis")}</span>
                      </Show>
                    </div>
                    <Show when={err()}>
                      <span class="text-11-regular text-text-weaker truncate">{err()}</span>
                    </Show>
                  </div>
                  <div class="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                    <IconButton icon="trash" variant="ghost" size="small" onClick={() => remove(i.name)} />
                    <Switch checked={enabled()} disabled={loading() === i.name} onChange={() => toggle(i.name)} />
                  </div>
                </div>
              )
            }}
          </List>
        </Match>

        {/* ─── Add type ─── */}
        <Match when={step() === "add-type"}>
          <div class="flex flex-col gap-2 p-4">
            <button
              class="w-full text-left px-3 py-2.5 rounded-md border border-surface-inset-base hover:bg-surface-raised-base transition-colors"
              onClick={() => {
                setAddType("local")
                setStep("local-command")
              }}
            >
              <div class="text-13-medium">Local</div>
              <div class="text-11-regular text-text-weaker">npx, bunx, binary, or script</div>
            </button>
            <button
              class="w-full text-left px-3 py-2.5 rounded-md border border-surface-inset-base hover:bg-surface-raised-base transition-colors"
              onClick={() => {
                setAddType("remote")
                setStep("remote-url")
              }}
            >
              <div class="text-13-medium">Remote</div>
              <div class="text-11-regular text-text-weaker">HTTP/SSE URL</div>
            </button>
            <div class="pt-1">
              <Button variant="ghost" size="small" onClick={back}>
                {language.t("dialog.mcp.add.back")}
              </Button>
            </div>
          </div>
        </Match>

        {/* ─── Local command ─── */}
        <Match when={step() === "local-command"}>
          <div class="flex flex-col gap-3 p-4">
            <Show when={error()}>
              <p class="text-12-regular text-icon-danger-base">{error()}</p>
            </Show>
            <TextField
              placeholder="npx my-mcp-server"
              description={language.t("dialog.mcp.add.commandDescription")}
              value={command()}
              onChange={(v) => {
                setCommand(v)
                setError("")
              }}
              autofocus
              onKeyDown={(e) => {
                if (e.key === "Enter") handleLocalCommand()
              }}
            />
            <div class="flex gap-2">
              <Button variant="ghost" size="small" onClick={back}>
                {language.t("dialog.mcp.add.back")}
              </Button>
              <Button variant="primary" size="small" onClick={handleLocalCommand}>
                {language.t("dialog.mcp.add.next")}
              </Button>
            </div>
          </div>
        </Match>

        {/* ─── Local env ─── */}
        <Match when={step() === "local-env"}>
          <div class="flex flex-col gap-3 p-4">
            <TextField
              placeholder="KEY=VALUE, KEY2=VALUE2"
              description={language.t("dialog.mcp.add.envDescription")}
              value={env()}
              onChange={setEnv}
              autofocus
              onKeyDown={(e) => {
                if (e.key === "Enter") handleLocalEnv()
              }}
            />
            <div class="flex gap-2">
              <Button variant="ghost" size="small" onClick={back}>
                {language.t("dialog.mcp.add.back")}
              </Button>
              <Button variant="primary" size="small" onClick={handleLocalEnv}>
                {language.t("dialog.mcp.add.next")}
              </Button>
            </div>
          </div>
        </Match>

        {/* ─── Remote URL ─── */}
        <Match when={step() === "remote-url"}>
          <div class="flex flex-col gap-3 p-4">
            <Show when={error()}>
              <p class="text-12-regular text-icon-danger-base">{error()}</p>
            </Show>
            <TextField
              placeholder="https://mcp.example.com/sse"
              value={url()}
              onChange={(v) => {
                setUrl(v)
                setError("")
              }}
              autofocus
              onKeyDown={(e) => {
                if (e.key === "Enter") handleRemoteUrl()
              }}
            />
            <div class="flex gap-2">
              <Button variant="ghost" size="small" onClick={back}>
                {language.t("dialog.mcp.add.back")}
              </Button>
              <Button variant="primary" size="small" onClick={handleRemoteUrl}>
                {language.t("dialog.mcp.add.next")}
              </Button>
            </div>
          </div>
        </Match>

        {/* ─── Server name ─── */}
        <Match when={step() === "name"}>
          <div class="flex flex-col gap-3 p-4">
            <Show when={error()}>
              <p class="text-12-regular text-icon-danger-base">{error()}</p>
            </Show>
            <TextField
              placeholder={defaultName()}
              value={serverName()}
              onChange={(v) => {
                setServerName(v)
                setError("")
              }}
              autofocus
              onKeyDown={(e) => {
                if (e.key === "Enter") handleName()
              }}
            />
            <div class="flex gap-2">
              <Button variant="ghost" size="small" onClick={back}>
                {language.t("dialog.mcp.add.back")}
              </Button>
              <Button variant="primary" size="small" onClick={handleName}>
                {language.t("dialog.mcp.add.connect")}
              </Button>
            </div>
          </div>
        </Match>

        {/* ─── Connecting ─── */}
        <Match when={step() === "connecting"}>
          <div class="flex flex-col items-center gap-3 p-8">
            <Spinner />
            <p class="text-13-regular text-text-weak">{language.t("dialog.mcp.add.connectingMessage")}</p>
          </div>
        </Match>

        {/* ─── Done ─── */}
        <Match when={step() === "done"}>
          <div class="flex flex-col gap-3 p-4">
            <p class="text-13-regular text-icon-success-base">
              {doneInfo().name} — {doneInfo().status}
            </p>
            <Button variant="primary" size="small" onClick={() => setStep("list")}>
              {language.t("dialog.mcp.add.finish")}
            </Button>
          </div>
        </Match>
      </Cond>
    </Dialog>
  )
}
