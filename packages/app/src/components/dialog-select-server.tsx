import { createResource, createEffect, createMemo, onCleanup, Show } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { useDialog } from "@cyberstrike-io/ui/context/dialog"
import { Dialog } from "@cyberstrike-io/ui/dialog"
import { List } from "@cyberstrike-io/ui/list"
import { Button } from "@cyberstrike-io/ui/button"
import { IconButton } from "@cyberstrike-io/ui/icon-button"
import { TextField } from "@cyberstrike-io/ui/text-field"
import { normalizeServerUrl, ServerConnection, useServer } from "@/context/server"
import { usePlatform } from "@/context/platform"
import { useNavigate } from "@solidjs/router"
import { useLanguage } from "@/context/language"
import { DropdownMenu } from "@cyberstrike-io/ui/dropdown-menu"
import { showToast } from "@cyberstrike-io/ui/toast"
import { ServerRow } from "@/components/server/server-row"
import { useCheckServerHealth, type ServerHealth } from "@/utils/server-health"

const DEFAULT_USERNAME = "cyberstrike"

interface ServerFormProps {
  value: string
  name: string
  username: string
  password: string
  placeholder: string
  busy: boolean
  error: string
  status: boolean | undefined
  onChange: (value: string) => void
  onNameChange: (value: string) => void
  onUsernameChange: (value: string) => void
  onPasswordChange: (value: string) => void
  onSubmit: () => void
  onBack: () => void
}

function showRequestError(language: ReturnType<typeof useLanguage>, err: unknown) {
  showToast({
    variant: "error",
    title: language.t("common.requestFailed"),
    description: err instanceof Error ? err.message : String(err),
  })
}

function useDefaultServer(platform: ReturnType<typeof usePlatform>, language: ReturnType<typeof useLanguage>) {
  const [defaultUrl, defaultUrlActions] = createResource(
    async () => {
      try {
        const url = await platform.getDefaultServerUrl?.()
        if (!url) return null
        return normalizeServerUrl(url) ?? null
      } catch (err) {
        showRequestError(language, err)
        return null
      }
    },
    { initialValue: null },
  )

  const canDefault = createMemo(() => !!platform.getDefaultServerUrl && !!platform.setDefaultServerUrl)
  const setDefault = async (url: string | null) => {
    try {
      await platform.setDefaultServerUrl?.(url)
      defaultUrlActions.mutate(url)
    } catch (err) {
      showRequestError(language, err)
    }
  }

  return { defaultUrl, canDefault, setDefault }
}

function useServerPreview() {
  const checkServerHealth = useCheckServerHealth()

  const looksComplete = (value: string) => {
    const normalized = normalizeServerUrl(value)
    if (!normalized) return false
    const host = normalized.replace(/^https?:\/\//, "").split("/")[0]
    if (!host) return false
    if (host.includes("localhost") || host.startsWith("127.0.0.1")) return true
    return host.includes(".") || host.includes(":")
  }

  const previewStatus = async (
    value: string,
    username: string,
    password: string,
    setStatus: (value: boolean | undefined) => void,
  ) => {
    setStatus(undefined)
    if (!looksComplete(value)) return
    const normalized = normalizeServerUrl(value)
    if (!normalized) return
    const http: ServerConnection.HttpBase = { url: normalized }
    if (username) http.username = username
    if (password) http.password = password
    const result = await checkServerHealth(http)
    setStatus(result.healthy)
  }

  return { previewStatus }
}

function ServerForm(props: ServerFormProps) {
  const language = useLanguage()
  const keyDown = (event: KeyboardEvent) => {
    event.stopPropagation()
    if (event.key === "Escape") {
      event.preventDefault()
      props.onBack()
      return
    }
    if (event.key !== "Enter" || event.isComposing) return
    event.preventDefault()
    props.onSubmit()
  }

  return (
    <div class="px-5">
      <div class="bg-surface-base rounded-md p-5 flex flex-col gap-3">
        <div class="flex-1 min-w-0 [&_[data-slot=input-wrapper]]:relative">
          <TextField
            type="text"
            label={language.t("dialog.server.add.url")}
            placeholder={props.placeholder}
            value={props.value}
            autofocus
            validationState={props.error ? "invalid" : "valid"}
            error={props.error}
            disabled={props.busy}
            onChange={props.onChange}
            onKeyDown={keyDown}
          />
        </div>
        <TextField
          type="text"
          label={language.t("dialog.server.add.name")}
          placeholder={language.t("dialog.server.add.namePlaceholder")}
          value={props.name}
          disabled={props.busy}
          onChange={props.onNameChange}
          onKeyDown={keyDown}
        />
        <div class="grid grid-cols-2 gap-2 min-w-0">
          <TextField
            type="text"
            label={language.t("dialog.server.add.username")}
            placeholder={language.t("dialog.server.add.usernamePlaceholder")}
            value={props.username}
            disabled={props.busy}
            onChange={props.onUsernameChange}
            onKeyDown={keyDown}
          />
          <TextField
            type="password"
            label={language.t("dialog.server.add.password")}
            placeholder={language.t("dialog.server.add.passwordPlaceholder")}
            value={props.password}
            disabled={props.busy}
            onChange={props.onPasswordChange}
            onKeyDown={keyDown}
          />
        </div>
      </div>
      <Button
        variant="primary"
        size="large"
        disabled={props.busy || !props.value.trim()}
        onClick={props.onSubmit}
        class="mt-1"
      >
        {props.busy ? language.t("dialog.server.add.checking") : language.t("dialog.server.add.button")}
      </Button>
    </div>
  )
}

interface EditRowProps {
  value: string
  name: string
  username: string
  password: string
  placeholder: string
  busy: boolean
  error: string
  status: boolean | undefined
  onChange: (value: string) => void
  onNameChange: (value: string) => void
  onUsernameChange: (value: string) => void
  onPasswordChange: (value: string) => void
  onKeyDown: (event: KeyboardEvent) => void
  onBlur: () => void
}

function EditRow(props: EditRowProps) {
  const language = useLanguage()
  return (
    <div class="flex flex-col gap-2 px-4 min-w-0 flex-1 py-2" onClick={(event) => event.stopPropagation()}>
      <div class="flex items-center gap-3 min-w-0">
        <div
          classList={{
            "size-1.5 rounded-full shrink-0": true,
            "bg-icon-success-base": props.status === true,
            "bg-icon-critical-base": props.status === false,
            "bg-border-weak-base": props.status === undefined,
          }}
        />
        <div class="flex-1 min-w-0">
          <TextField
            type="text"
            hideLabel
            placeholder={props.placeholder}
            value={props.value}
            autofocus
            validationState={props.error ? "invalid" : "valid"}
            error={props.error}
            disabled={props.busy}
            onChange={props.onChange}
            onKeyDown={props.onKeyDown}
            onBlur={props.onBlur}
          />
        </div>
      </div>
      <TextField
        type="text"
        label={language.t("dialog.server.add.name")}
        placeholder={language.t("dialog.server.add.namePlaceholder")}
        value={props.name}
        disabled={props.busy}
        onChange={props.onNameChange}
        onKeyDown={props.onKeyDown}
      />
      <div class="grid grid-cols-2 gap-2 min-w-0">
        <TextField
          type="text"
          label={language.t("dialog.server.add.username")}
          placeholder={language.t("dialog.server.add.usernamePlaceholder")}
          value={props.username}
          disabled={props.busy}
          onChange={props.onUsernameChange}
          onKeyDown={props.onKeyDown}
        />
        <TextField
          type="password"
          label={language.t("dialog.server.add.password")}
          placeholder={language.t("dialog.server.add.passwordPlaceholder")}
          value={props.password}
          disabled={props.busy}
          onChange={props.onPasswordChange}
          onKeyDown={props.onKeyDown}
        />
      </div>
    </div>
  )
}

export function DialogSelectServer() {
  const navigate = useNavigate()
  const dialog = useDialog()
  const server = useServer()
  const platform = usePlatform()
  const language = useLanguage()
  const checkServerHealth = useCheckServerHealth()
  const { defaultUrl, canDefault, setDefault } = useDefaultServer(platform, language)
  const { previewStatus } = useServerPreview()
  let listRoot: HTMLDivElement | undefined
  const [store, setStore] = createStore({
    status: {} as Record<string, ServerHealth | undefined>,
    addServer: {
      url: "",
      name: "",
      username: DEFAULT_USERNAME,
      password: "",
      adding: false,
      error: "",
      showForm: false,
      status: undefined as boolean | undefined,
    },
    editServer: {
      id: undefined as string | undefined,
      value: "",
      name: "",
      username: "",
      password: "",
      error: "",
      busy: false,
      status: undefined as boolean | undefined,
    },
  })

  const resetAdd = () => {
    setStore("addServer", {
      url: "",
      name: "",
      username: DEFAULT_USERNAME,
      password: "",
      error: "",
      showForm: false,
      status: undefined,
      adding: false,
    })
  }

  const resetEdit = () => {
    setStore("editServer", {
      id: undefined,
      value: "",
      name: "",
      username: "",
      password: "",
      error: "",
      status: undefined,
      busy: false,
    })
  }

  const replaceServer = (original: ServerConnection.Any, next: ServerConnection.Http) => {
    const active = server.key
    const newConn = server.add(next)
    if (!newConn) return
    const nextActive = active === ServerConnection.key(original) ? ServerConnection.key(newConn) : active
    if (nextActive) server.setActive(nextActive)
    server.remove(ServerConnection.key(original))
  }

  const items = createMemo(() => {
    const current = server.current
    const list = server.list
    if (!current) return list
    const currentKey = ServerConnection.key(current)
    if (!list.find((x) => ServerConnection.key(x) === currentKey)) return [current, ...list]
    return [current, ...list.filter((x) => ServerConnection.key(x) !== currentKey)]
  })

  const current = createMemo(() => items().find((x) => ServerConnection.key(x) === server.key) ?? items()[0])

  const sortedItems = createMemo(() => {
    const list = items()
    if (!list.length) return list
    const active = current()
    const order = new Map(list.map((conn, index) => [conn, index] as const))
    const rank = (value?: ServerHealth) => {
      if (value?.healthy === true) return 0
      if (value?.healthy === false) return 2
      return 1
    }
    return list.slice().sort((a, b) => {
      if (a === active) return -1
      if (b === active) return 1
      const diff = rank(store.status[ServerConnection.key(a)]) - rank(store.status[ServerConnection.key(b)])
      if (diff !== 0) return diff
      return (order.get(a) ?? 0) - (order.get(b) ?? 0)
    })
  })

  async function refreshHealth() {
    const results: Record<string, ServerHealth> = {}
    await Promise.all(
      items().map(async (conn) => {
        results[ServerConnection.key(conn)] = await checkServerHealth(conn.http)
      }),
    )
    setStore("status", reconcile(results))
  }

  createEffect(() => {
    items()
    refreshHealth()
    const interval = setInterval(refreshHealth, 10_000)
    onCleanup(() => clearInterval(interval))
  })

  createEffect(() => {
    if (!server.needsAuth()) return
    const conn = server.current
    if (!conn) return
    const k = ServerConnection.key(conn)
    if (store.editServer.id === k) return
    setStore("editServer", {
      id: k,
      value: conn.http.url,
      name: conn.displayName ?? "",
      username: conn.http.username ?? DEFAULT_USERNAME,
      password: conn.http.password ?? "",
      error: "",
      status: false,
    })
  })

  async function select(conn: ServerConnection.Any, persist?: boolean) {
    const k = ServerConnection.key(conn)
    if (!persist && store.status[k]?.healthy === false) return
    dialog.close()
    if (persist && conn.type === "http") {
      server.add(conn)
      navigate("/")
      return
    }
    server.setActive(k)
    navigate("/")
  }

  const handleAddChange = (value: string) => {
    if (store.addServer.adding) return
    setStore("addServer", { url: value, error: "" })
    void previewStatus(value, store.addServer.username, store.addServer.password, (next) =>
      setStore("addServer", { status: next }),
    )
  }

  const handleAddNameChange = (value: string) => {
    if (store.addServer.adding) return
    setStore("addServer", { name: value, error: "" })
  }

  const handleAddUsernameChange = (value: string) => {
    if (store.addServer.adding) return
    setStore("addServer", { username: value, error: "" })
    void previewStatus(store.addServer.url, value, store.addServer.password, (next) =>
      setStore("addServer", { status: next }),
    )
  }

  const handleAddPasswordChange = (value: string) => {
    if (store.addServer.adding) return
    setStore("addServer", { password: value, error: "" })
    void previewStatus(store.addServer.url, store.addServer.username, value, (next) =>
      setStore("addServer", { status: next }),
    )
  }

  const scrollListToBottom = () => {
    const scroll = listRoot?.querySelector<HTMLDivElement>('[data-slot="list-scroll"]')
    if (!scroll) return
    requestAnimationFrame(() => {
      scroll.scrollTop = scroll.scrollHeight
    })
  }

  const handleEditChange = (value: string) => {
    if (store.editServer.busy) return
    setStore("editServer", { value, error: "" })
    void previewStatus(value, store.editServer.username, store.editServer.password, (next) =>
      setStore("editServer", { status: next }),
    )
  }

  async function handleAdd() {
    if (store.addServer.adding) return
    const normalized = normalizeServerUrl(store.addServer.url)
    if (!normalized) {
      resetAdd()
      return
    }

    setStore("addServer", { adding: true, error: "" })

    const conn: ServerConnection.Http = {
      type: "http",
      http: { url: normalized },
    }
    if (store.addServer.name.trim()) conn.displayName = store.addServer.name.trim()
    if (store.addServer.password) conn.http.password = store.addServer.password
    if (store.addServer.password && store.addServer.username) conn.http.username = store.addServer.username

    const result = await checkServerHealth(conn.http)
    setStore("addServer", { adding: false })

    if (!result.healthy) {
      setStore("addServer", { error: language.t("dialog.server.add.error") })
      return
    }

    resetAdd()
    await select(conn, true)
  }

  async function handleEdit(original: ServerConnection.Any, value: string) {
    if (store.editServer.busy) return
    const normalized = normalizeServerUrl(value)
    if (!normalized) {
      resetEdit()
      return
    }

    const sameUrl = normalized === original.http.url
    const sameName = (store.editServer.name.trim() || "") === (original.displayName || "")
    const sameUser = (store.editServer.username || "") === (original.http.username || "")
    const samePass = (store.editServer.password || "") === (original.http.password || "")
    if (sameUrl && sameName && sameUser && samePass) {
      resetEdit()
      return
    }

    setStore("editServer", { busy: true, error: "" })

    const conn: ServerConnection.Http = {
      type: "http",
      http: { url: normalized },
    }
    if (store.editServer.name.trim()) conn.displayName = store.editServer.name.trim()
    if (store.editServer.password) conn.http.password = store.editServer.password
    if (store.editServer.password && store.editServer.username) conn.http.username = store.editServer.username

    const result = await checkServerHealth(conn.http)
    setStore("editServer", { busy: false })

    if (!result.healthy) {
      setStore("editServer", { error: language.t("dialog.server.add.error") })
      return
    }

    replaceServer(original, conn)
    resetEdit()
  }

  const handleEditKey = (event: KeyboardEvent, original: ServerConnection.Any) => {
    event.stopPropagation()
    if (event.key === "Escape") {
      event.preventDefault()
      resetEdit()
      return
    }
    if (event.key !== "Enter" || event.isComposing) return
    event.preventDefault()
    handleEdit(original, store.editServer.value)
  }

  async function handleRemove(conn: ServerConnection.Any) {
    const k = ServerConnection.key(conn)
    server.remove(k)
    if ((await platform.getDefaultServerUrl?.()) === k) {
      platform.setDefaultServerUrl?.(null)
    }
  }

  return (
    <Dialog title={language.t("dialog.server.title")}>
      <div class="flex flex-col gap-2">
        <div ref={(el) => (listRoot = el)}>
          <List
            search={{ placeholder: language.t("dialog.server.search.placeholder"), autofocus: false }}
            noInitialSelection
            emptyMessage={language.t("dialog.server.empty")}
            items={sortedItems}
            key={(x) => ServerConnection.key(x)}
            onSelect={(x) => {
              if (x) select(x)
            }}
            onFilter={(value) => {
              if (value && store.addServer.showForm && !store.addServer.adding) {
                resetAdd()
              }
            }}
            divider={true}
            class="px-5 [&_[data-slot=list-search-wrapper]]:w-full [&_[data-slot=list-scroll]]:max-h-[300px] [&_[data-slot=list-scroll]]:overflow-y-auto [&_[data-slot=list-items]]:bg-surface-raised-base [&_[data-slot=list-items]]:rounded-md [&_[data-slot=list-item]]:min-h-14 [&_[data-slot=list-item]]:p-3 [&_[data-slot=list-item]]:!bg-transparent [&_[data-slot=list-item-add]]:px-0"
            add={
              store.addServer.showForm
                ? {
                    render: () => (
                      <ServerForm
                        value={store.addServer.url}
                        name={store.addServer.name}
                        username={store.addServer.username}
                        password={store.addServer.password}
                        placeholder={language.t("dialog.server.add.placeholder")}
                        busy={store.addServer.adding}
                        error={store.addServer.error}
                        status={store.addServer.status}
                        onChange={handleAddChange}
                        onNameChange={handleAddNameChange}
                        onUsernameChange={handleAddUsernameChange}
                        onPasswordChange={handleAddPasswordChange}
                        onSubmit={handleAdd}
                        onBack={resetAdd}
                      />
                    ),
                  }
                : undefined
            }
          >
            {(conn) => {
              const k = ServerConnection.key(conn)
              return (
                <div class="flex items-center gap-3 min-w-0 flex-1 group/item">
                  <Show
                    when={store.editServer.id !== k}
                    fallback={
                      <EditRow
                        value={store.editServer.value}
                        name={store.editServer.name}
                        username={store.editServer.username}
                        password={store.editServer.password}
                        placeholder={language.t("dialog.server.add.placeholder")}
                        busy={store.editServer.busy}
                        error={store.editServer.error}
                        status={store.editServer.status}
                        onChange={handleEditChange}
                        onNameChange={(v) => setStore("editServer", "name", v)}
                        onUsernameChange={(v) => {
                          setStore("editServer", "username", v)
                          void previewStatus(store.editServer.value, v, store.editServer.password, (next) =>
                            setStore("editServer", { status: next }),
                          )
                        }}
                        onPasswordChange={(v) => {
                          setStore("editServer", "password", v)
                          void previewStatus(store.editServer.value, store.editServer.username, v, (next) =>
                            setStore("editServer", { status: next }),
                          )
                        }}
                        onKeyDown={(event) => handleEditKey(event, conn)}
                        onBlur={() => handleEdit(conn, store.editServer.value)}
                      />
                    }
                  >
                    <ServerRow
                      conn={conn}
                      status={store.status[k]}
                      dimmed={store.status[k]?.healthy === false}
                      class="flex items-center gap-3 px-4 min-w-0 flex-1"
                      badge={
                        <Show when={defaultUrl() === k}>
                          <span class="text-text-weak bg-surface-base text-14-regular px-1.5 rounded-xs">
                            {language.t("dialog.server.status.default")}
                          </span>
                        </Show>
                      }
                    />
                  </Show>
                  <Show when={store.editServer.id !== k}>
                    <div class="flex items-center justify-center gap-5 pl-4">
                      <Show when={current() === conn}>
                        <p class="text-text-weak text-12-regular">{language.t("dialog.server.current")}</p>
                      </Show>

                      <DropdownMenu>
                        <DropdownMenu.Trigger
                          as={IconButton}
                          icon="dot-grid"
                          variant="ghost"
                          class="shrink-0 size-8 hover:bg-surface-base-hover data-[expanded]:bg-surface-base-active"
                          onClick={(e: MouseEvent) => e.stopPropagation()}
                          onPointerDown={(e: PointerEvent) => e.stopPropagation()}
                        />
                        <DropdownMenu.Portal>
                          <DropdownMenu.Content class="mt-1">
                            <DropdownMenu.Item
                              onSelect={() => {
                                setStore("editServer", {
                                  id: k,
                                  value: conn.http.url,
                                  name: conn.displayName ?? "",
                                  username: conn.http.username ?? "",
                                  password: conn.http.password ?? "",
                                  error: "",
                                  status: store.status[k]?.healthy,
                                })
                              }}
                            >
                              <DropdownMenu.ItemLabel>{language.t("dialog.server.menu.edit")}</DropdownMenu.ItemLabel>
                            </DropdownMenu.Item>
                            <Show when={canDefault() && defaultUrl() !== k}>
                              <DropdownMenu.Item onSelect={() => setDefault(k)}>
                                <DropdownMenu.ItemLabel>
                                  {language.t("dialog.server.menu.default")}
                                </DropdownMenu.ItemLabel>
                              </DropdownMenu.Item>
                            </Show>
                            <Show when={canDefault() && defaultUrl() === k}>
                              <DropdownMenu.Item onSelect={() => setDefault(null)}>
                                <DropdownMenu.ItemLabel>
                                  {language.t("dialog.server.menu.defaultRemove")}
                                </DropdownMenu.ItemLabel>
                              </DropdownMenu.Item>
                            </Show>
                            <DropdownMenu.Separator />
                            <DropdownMenu.Item
                              onSelect={() => handleRemove(conn)}
                              class="text-text-on-critical-base hover:bg-surface-critical-weak"
                            >
                              <DropdownMenu.ItemLabel>{language.t("dialog.server.menu.delete")}</DropdownMenu.ItemLabel>
                            </DropdownMenu.Item>
                          </DropdownMenu.Content>
                        </DropdownMenu.Portal>
                      </DropdownMenu>
                    </div>
                  </Show>
                </div>
              )
            }}
          </List>
        </div>

        <div class="px-5 pb-5">
          <Button
            variant="secondary"
            icon="plus-small"
            size="large"
            onClick={() => {
              setStore("addServer", {
                showForm: true,
                url: "",
                name: "",
                username: DEFAULT_USERNAME,
                password: "",
                error: "",
              })
              scrollListToBottom()
            }}
            class="py-1.5 pl-1.5 pr-3 flex items-center gap-1.5"
          >
            {store.addServer.adding ? language.t("dialog.server.add.checking") : language.t("dialog.server.add.button")}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
