import { createEffect, createMemo, createSignal, For, onCleanup, Show, type Accessor, type JSXElement } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { useNavigate } from "@solidjs/router"
import { useDialog } from "@cyberstrike-io/ui/context/dialog"
import { Popover } from "@cyberstrike-io/ui/popover"
import { Tabs } from "@cyberstrike-io/ui/tabs"
import { Button } from "@cyberstrike-io/ui/button"
import { Icon } from "@cyberstrike-io/ui/icon"
import { useSync } from "@/context/sync"
import { useSDK } from "@/context/sdk"
import { normalizeServerUrl, ServerConnection, useServer } from "@/context/server"
import { usePlatform } from "@/context/platform"
import { useLanguage } from "@/context/language"
import { DialogSelectServer } from "./dialog-select-server"
import { ServerRow } from "@/components/server/server-row"
import { useCheckServerHealth, type ServerHealth } from "@/utils/server-health"

const pollMs = 10_000

const pluginEmptyMessage = (value: string, file: string): JSXElement => {
  const parts = value.split(file)
  if (parts.length === 1) return value
  return (
    <>
      {parts[0]}
      <code class="bg-surface-raised-base px-1.5 py-0.5 rounded-sm text-text-base">{file}</code>
      {parts.slice(1).join(file)}
    </>
  )
}

const listServersByHealth = (
  list: ServerConnection.Any[],
  activeKey: string | undefined,
  status: Record<string, ServerHealth | undefined>,
) => {
  if (!list.length) return list
  const order = new Map(list.map((conn, index) => [conn, index] as const))
  const rank = (value?: ServerHealth) => {
    if (value?.healthy === true) return 0
    if (value?.healthy === false) return 2
    return 1
  }

  return list.slice().sort((a, b) => {
    const ka = ServerConnection.key(a)
    const kb = ServerConnection.key(b)
    if (ka === activeKey) return -1
    if (kb === activeKey) return 1
    const diff = rank(status[ka]) - rank(status[kb])
    if (diff !== 0) return diff
    return (order.get(a) ?? 0) - (order.get(b) ?? 0)
  })
}

const useServerHealth = (servers: Accessor<ServerConnection.Any[]>) => {
  const checkServerHealth = useCheckServerHealth()
  const [status, setStatus] = createStore({} as Record<string, ServerHealth | undefined>)

  createEffect(() => {
    const list = servers()
    let dead = false

    const refresh = async () => {
      const results: Record<string, ServerHealth> = {}
      await Promise.all(
        list.map(async (conn) => {
          results[ServerConnection.key(conn)] = await checkServerHealth(conn.http)
        }),
      )
      if (dead) return
      setStatus(reconcile(results))
    }

    void refresh()
    const id = setInterval(() => void refresh(), pollMs)
    onCleanup(() => {
      dead = true
      clearInterval(id)
    })
  })

  return status
}

const useDefaultServerUrl = (
  get: (() => string | Promise<string | null | undefined> | null | undefined) | undefined,
) => {
  const [url, setUrl] = createSignal<string | undefined>()
  const [tick, setTick] = createSignal(0)

  createEffect(() => {
    tick()
    let dead = false
    const result = get?.()
    if (!result) {
      setUrl(undefined)
      onCleanup(() => {
        dead = true
      })
      return
    }

    if (result instanceof Promise) {
      void result.then((next) => {
        if (dead) return
        setUrl(next ? normalizeServerUrl(next) : undefined)
      })
      onCleanup(() => {
        dead = true
      })
      return
    }

    setUrl(normalizeServerUrl(result))
    onCleanup(() => {
      dead = true
    })
  })

  return { url, refresh: () => setTick((value) => value + 1) }
}

export function StatusPopover() {
  const sync = useSync()
  const sdk = useSDK()
  const server = useServer()
  const platform = usePlatform()
  const dialog = useDialog()
  const language = useLanguage()
  const navigate = useNavigate()

  const servers = createMemo(() => {
    const current = server.current
    const list = server.list
    if (!current) return list
    const currentKey = ServerConnection.key(current)
    if (!list.find((x) => ServerConnection.key(x) === currentKey)) return [current, ...list]
    return [current, ...list.filter((x) => ServerConnection.key(x) !== currentKey)]
  })
  const health = useServerHealth(servers)
  const sortedServers = createMemo(() => listServersByHealth(servers(), server.key, health))
  const defaultServer = useDefaultServerUrl(platform.getDefaultServerUrl)
  const mcpNames = createMemo(() => Object.keys(sync.data.mcp ?? {}).sort((a, b) => a.localeCompare(b)))
  const mcpStatus = (name: string) => sync.data.mcp?.[name]?.status
  const lspItems = createMemo(() => sync.data.lsp ?? [])
  const lspCount = createMemo(() => lspItems().length)
  const plugins = createMemo(() => sync.data.config.plugin ?? [])
  const pluginCount = createMemo(() => plugins().length)
  const pluginEmpty = createMemo(() => pluginEmptyMessage(language.t("dialog.plugins.empty"), "cyberstrike.json"))

  const overallHealthy = createMemo(() => {
    const serverHealthy = server.healthy() === true
    const anyMcpIssue = mcpNames().some((name) => {
      const status = mcpStatus(name)
      return status !== "connected" && status !== "disabled"
    })
    return serverHealthy && !anyMcpIssue
  })

  return (
    <Popover
      triggerAs={Button}
      triggerProps={{
        variant: "ghost",
        class:
          "rounded-md h-[24px] px-3 gap-2 border border-border-base bg-surface-panel shadow-none data-[expanded]:bg-surface-raised-base-active",
        style: { scale: 1 },
      }}
      trigger={
        <div class="flex items-center gap-1.5">
          <div
            classList={{
              "size-1.5 rounded-full": true,
              "bg-icon-success-base": overallHealthy(),
              "bg-icon-critical-base": !overallHealthy() && server.healthy() !== undefined,
              "bg-border-weak-base": server.healthy() === undefined,
            }}
          />
          <span class="text-12-regular text-text-strong">{language.t("status.popover.trigger")}</span>
        </div>
      }
      class="[&_[data-slot=popover-body]]:p-0 w-[360px] max-w-[calc(100vw-40px)] bg-transparent border-0 shadow-none rounded-xl"
      gutter={6}
      placement="bottom-end"
      shift={-136}
    >
      <div class="flex items-center gap-1 w-[360px] rounded-xl shadow-[var(--shadow-lg-border-base)]">
        <Tabs
          aria-label={language.t("status.popover.ariaLabel")}
          class="tabs bg-background-strong rounded-xl overflow-hidden"
          data-component="tabs"
          data-active="servers"
          defaultValue="servers"
          variant="alt"
        >
          <Tabs.List data-slot="tablist" class="bg-transparent border-b-0 px-4 pt-2 pb-0 gap-3 h-10 overflow-x-auto">
            <Tabs.Trigger value="servers" data-slot="tab" class="text-12-regular">
              {sortedServers().length > 0 ? `${sortedServers().length} ` : ""}
              {language.t("status.popover.tab.servers")}
            </Tabs.Trigger>
            <Tabs.Trigger value="lsp" data-slot="tab" class="text-12-regular">
              {lspCount() > 0 ? `${lspCount()} ` : ""}
              {language.t("status.popover.tab.lsp")}
            </Tabs.Trigger>
            <Tabs.Trigger value="plugins" data-slot="tab" class="text-12-regular">
              {pluginCount() > 0 ? `${pluginCount()} ` : ""}
              {language.t("status.popover.tab.plugins")}
            </Tabs.Trigger>
            <Show when={mcpNames().length > 0}>
              <Tabs.Trigger value="mcp" data-slot="tab" class="text-12-regular">
                {mcpNames().length} {language.t("status.popover.tab.mcp")}
              </Tabs.Trigger>
            </Show>
          </Tabs.List>

          <Tabs.Content value="servers">
            <div class="flex flex-col px-2 pb-2">
              <div class="flex flex-col p-3 bg-background-base rounded-sm min-h-14">
                <For each={sortedServers()}>
                  {(conn) => {
                    const k = ServerConnection.key(conn)
                    const isBlocked = () => health[k]?.healthy === false
                    return (
                      <button
                        type="button"
                        class="flex items-center gap-2 w-full h-8 pl-3 pr-1.5 py-1.5 rounded-md transition-colors text-left"
                        classList={{
                          "hover:bg-surface-raised-base-hover": !isBlocked(),
                          "cursor-not-allowed": isBlocked(),
                        }}
                        aria-disabled={isBlocked()}
                        onClick={() => {
                          if (isBlocked()) return
                          server.setActive(k)
                          navigate("/")
                        }}
                      >
                        <ServerRow
                          conn={conn}
                          status={health[k]}
                          dimmed={isBlocked()}
                          class="flex items-center gap-2 w-full min-w-0"
                          nameClass="text-14-regular text-text-base truncate"
                          versionClass="text-12-regular text-text-weak truncate"
                          badge={
                            <Show when={k === defaultServer.url()}>
                              <span class="text-11-regular text-text-base bg-surface-base px-1.5 py-0.5 rounded-md">
                                {language.t("common.default")}
                              </span>
                            </Show>
                          }
                        >
                          <div class="flex-1" />
                          <Show when={k === server.key}>
                            <Icon name="check" size="small" class="text-icon-weak shrink-0" />
                          </Show>
                        </ServerRow>
                      </button>
                    )
                  }}
                </For>

                <Button
                  variant="secondary"
                  class="mt-3 self-start h-8 px-3 py-1.5"
                  onClick={() => dialog.show(() => <DialogSelectServer />, defaultServer.refresh)}
                >
                  {language.t("status.popover.action.manageServers")}
                </Button>
              </div>
            </div>
          </Tabs.Content>

          <Tabs.Content value="lsp">
            <div class="flex flex-col px-2 pb-2">
              <div class="flex flex-col p-3 bg-background-base rounded-sm min-h-14">
                <Show
                  when={lspItems().length > 0}
                  fallback={
                    <div class="text-14-regular text-text-base text-center my-auto">
                      {language.t("dialog.lsp.empty")}
                    </div>
                  }
                >
                  <For each={lspItems()}>
                    {(item) => (
                      <div class="flex items-center gap-2 w-full px-2 py-1">
                        <div
                          classList={{
                            "size-1.5 rounded-full shrink-0": true,
                            "bg-icon-success-base": item.status === "connected",
                            "bg-icon-critical-base": item.status === "error",
                          }}
                        />
                        <span class="text-14-regular text-text-base truncate">{item.name || item.id}</span>
                      </div>
                    )}
                  </For>
                </Show>
              </div>
            </div>
          </Tabs.Content>

          <Tabs.Content value="plugins">
            <div class="flex flex-col px-2 pb-2">
              <div class="flex flex-col p-3 bg-background-base rounded-sm min-h-14">
                <Show
                  when={plugins().length > 0}
                  fallback={<div class="text-14-regular text-text-base text-center my-auto">{pluginEmpty()}</div>}
                >
                  <For each={plugins()}>
                    {(plugin) => (
                      <div class="flex items-center gap-2 w-full px-2 py-1">
                        <div class="size-1.5 rounded-full shrink-0 bg-icon-success-base" />
                        <span class="text-14-regular text-text-base truncate">{plugin}</span>
                      </div>
                    )}
                  </For>
                </Show>
              </div>
            </div>
          </Tabs.Content>
          <Tabs.Content value="mcp">
            <div class="flex flex-col px-2 pb-2">
              <div class="flex flex-col p-3 bg-background-base rounded-sm min-h-14">
                <For each={mcpNames()}>
                  {(name) => (
                    <div class="flex items-center gap-2 w-full px-2 py-1">
                      <div
                        classList={{
                          "size-1.5 rounded-full shrink-0": true,
                          "bg-icon-success-base": mcpStatus(name) === "connected",
                          "bg-icon-critical-base": mcpStatus(name) === "failed" || mcpStatus(name) === "needs_auth" || mcpStatus(name) === "needs_client_registration",
                          "bg-border-weak-base": mcpStatus(name) === "disabled",
                        }}
                      />
                      <span class="text-14-regular text-text-base truncate">{name}</span>
                      <span class="text-12-regular text-text-weak ml-auto">{mcpStatus(name)}</span>
                    </div>
                  )}
                </For>
              </div>
            </div>
          </Tabs.Content>
        </Tabs>
      </div>
    </Popover>
  )
}
