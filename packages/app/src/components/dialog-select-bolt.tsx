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

type Step = "list" | "url" | "token" | "name" | "pairing" | "done"

const statusLabels = {
  connected: "mcp.status.connected",
  failed: "mcp.status.failed",
  needs_auth: "mcp.status.needs_auth",
  disabled: "mcp.status.disabled",
} as const

function sanitizeName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-|-$/g, "")
}

export const DialogSelectBolt: Component = () => {
  const sync = useSync()
  const sdk = useSDK()
  const language = useLanguage()
  const [loading, setLoading] = createSignal<string | null>(null)
  const [step, setStep] = createSignal<Step>("list")
  const [error, setError] = createSignal("")
  const [boltUrl, setBoltUrl] = createSignal("")
  const [adminToken, setAdminToken] = createSignal("")
  const [serverName, setServerName] = createSignal("")
  const [defaultName, setDefaultName] = createSignal("")
  const [doneInfo, setDoneInfo] = createSignal({ name: "", status: "" })

  const items = createMemo(() =>
    Object.entries(sync.data.bolt ?? {})
      .map(([name, status]) => ({ name, status: status.status }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  )

  const enabledCount = createMemo(() => items().filter((i) => i.status === "connected").length)
  const totalCount = createMemo(() => items().length)

  const toggle = async (name: string) => {
    if (loading()) return
    setLoading(name)
    try {
      const status = sync.data.bolt[name]
      if (status?.status === "connected") {
        await sdk.client.bolt.disconnect({ name })
      } else {
        await sdk.client.bolt.connect({ name })
      }
      const result = await sdk.client.bolt.status()
      if (result.data) sync.set("bolt", result.data)
    } finally {
      setLoading(null)
    }
  }

  const remove = async (name: string) => {
    if (loading()) return
    setLoading(name)
    try {
      await sdk.client.bolt.remove({ name })
      const result = await sdk.client.bolt.status()
      if (result.data) sync.set("bolt", result.data)
    } catch {
    } finally {
      setLoading(null)
    }
  }

  const resetForm = () => {
    setBoltUrl("")
    setAdminToken("")
    setServerName("")
    setDefaultName("")
    setError("")
  }

  const startAdd = () => {
    resetForm()
    setStep("url")
  }

  const back = () => {
    setError("")
    const s = step()
    if (s === "url") {
      setStep("list")
      return
    }
    if (s === "token") {
      setStep("url")
      return
    }
    if (s === "name") {
      setStep("token")
      return
    }
    if (s === "done") {
      setStep("list")
      return
    }
    setStep("list")
  }

  const handleUrl = () => {
    const val = boltUrl().trim()
    if (!val) return
    try {
      const parsed = new URL(val)
      const host = parsed.hostname
      setDefaultName(host === "localhost" || host === "127.0.0.1" ? "bolt" : host.replace(/\./g, "-"))
      setError("")
      setStep("token")
    } catch {
      setError("Invalid URL")
    }
  }

  const handleToken = () => {
    if (!adminToken().trim()) return
    setStep("name")
  }

  const handleName = async () => {
    const name = sanitizeName(serverName() || defaultName())
    if (!name) return

    if (sync.data.bolt?.[name]) {
      setError(`"${name}" already exists`)
      return
    }

    // Check duplicate URL
    try {
      const cfgRes = await sdk.client.config.get()
      const cfg = cfgRes.data as Record<string, Record<string, { url?: string }>> | undefined
      if (cfg) {
        const inputOrigin = new URL(boltUrl()).origin
        for (const [existing, bolt] of Object.entries(cfg.bolt ?? {})) {
          if (bolt.url && new URL(bolt.url).origin === inputOrigin) {
            setError(`Already configured as "${existing}"`)
            return
          }
        }
      }
    } catch {}

    setStep("pairing")

    try {
      // 1. Pair with Bolt server (Ed25519 key exchange)
      await sdk.client.bolt.pair({ name, url: boltUrl(), adminToken: adminToken() })

      // 2. Connect via bolt route (also persists to global config)
      await sdk.client.bolt.add({ name, config: { url: boltUrl() } })

      // 4. Refresh status
      const result = await sdk.client.bolt.status()
      if (result.data) sync.set("bolt", result.data)

      const serverStatus = (result.data as Record<string, { status: string }>)?.[name]?.status ?? "unknown"
      setDoneInfo({ name, status: serverStatus })
      setStep("done")
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setStep("url")
    }
  }

  const title = () => {
    const s = step()
    if (s === "list") return language.t("dialog.bolt.title")
    if (s === "url") return language.t("dialog.bolt.add.url")
    if (s === "token") return language.t("dialog.bolt.add.token")
    if (s === "name") return language.t("dialog.bolt.add.name")
    if (s === "pairing") return language.t("dialog.bolt.add.pairing")
    if (s === "done") return language.t("dialog.bolt.add.done")
    return language.t("dialog.bolt.title")
  }

  const description = () => {
    if (step() === "list")
      return language.t("dialog.bolt.description", { enabled: enabledCount(), total: totalCount() })
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
            emptyMessage={language.t("dialog.bolt.empty")}
            key={(x) => x?.name ?? ""}
            items={items}
            filterKeys={["name", "status"]}
            sortBy={(a, b) => a.name.localeCompare(b.name)}
            onSelect={(x) => {
              if (x) toggle(x.name)
            }}
          >
            {(i) => {
              const boltStatus = () => sync.data.bolt[i.name]
              const status = () => boltStatus()?.status
              const statusLabel = () => {
                const key = status() ? statusLabels[status() as keyof typeof statusLabels] : undefined
                if (!key) return
                return language.t(key)
              }
              const err = () => {
                const s = boltStatus()
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

        {/* ─── Bolt URL ─── */}
        <Match when={step() === "url"}>
          <div class="flex flex-col gap-3 p-4">
            <Show when={error()}>
              <p class="text-12-regular text-icon-danger-base">{error()}</p>
            </Show>
            <TextField
              placeholder="http://myserver:3001"
              description={language.t("dialog.bolt.add.urlDescription")}
              value={boltUrl()}
              onChange={(v) => {
                setBoltUrl(v)
                setError("")
              }}
              autofocus
              onKeyDown={(e: KeyboardEvent) => {
                if (e.key === "Enter") handleUrl()
              }}
            />
            <div class="flex gap-2">
              <Button variant="ghost" size="small" onClick={back}>
                {language.t("dialog.bolt.add.back")}
              </Button>
              <Button variant="primary" size="small" onClick={handleUrl}>
                {language.t("dialog.bolt.add.next")}
              </Button>
            </div>
          </div>
        </Match>

        {/* ─── Admin token ─── */}
        <Match when={step() === "token"}>
          <div class="flex flex-col gap-3 p-4">
            <TextField
              placeholder="paste admin token here"
              description={language.t("dialog.bolt.add.tokenDescription")}
              value={adminToken()}
              onChange={setAdminToken}
              autofocus
              onKeyDown={(e: KeyboardEvent) => {
                if (e.key === "Enter") handleToken()
              }}
            />
            <div class="flex gap-2">
              <Button variant="ghost" size="small" onClick={back}>
                {language.t("dialog.bolt.add.back")}
              </Button>
              <Button variant="primary" size="small" onClick={handleToken}>
                {language.t("dialog.bolt.add.next")}
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
              onKeyDown={(e: KeyboardEvent) => {
                if (e.key === "Enter") handleName()
              }}
            />
            <div class="flex gap-2">
              <Button variant="ghost" size="small" onClick={back}>
                {language.t("dialog.bolt.add.back")}
              </Button>
              <Button variant="primary" size="small" onClick={handleName}>
                {language.t("dialog.bolt.add.pair")}
              </Button>
            </div>
          </div>
        </Match>

        {/* ─── Pairing ─── */}
        <Match when={step() === "pairing"}>
          <div class="flex flex-col items-center gap-3 p-8">
            <Spinner />
            <p class="text-13-regular text-text-weak">{language.t("dialog.bolt.add.pairingMessage")}</p>
          </div>
        </Match>

        {/* ─── Done ─── */}
        <Match when={step() === "done"}>
          <div class="flex flex-col gap-3 p-4">
            <p class="text-13-regular text-icon-success-base">
              {doneInfo().name} — {doneInfo().status}
            </p>
            <Button variant="primary" size="small" onClick={() => setStep("list")}>
              {language.t("dialog.bolt.add.finish")}
            </Button>
          </div>
        </Match>
      </Cond>
    </Dialog>
  )
}
