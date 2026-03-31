import { Show } from "solid-js"
import { createStore } from "solid-js/store"
import { Button } from "@cyberstrike-io/ui/button"
import { TextField } from "@cyberstrike-io/ui/text-field"
import { Logo } from "@cyberstrike-io/ui/logo"
import { normalizeServerUrl, ServerConnection, useServer } from "@/context/server"
import { useCheckServerHealth } from "@/utils/server-health"
import { useLanguage } from "@/context/language"

export function HubConnectScreen() {
  const server = useServer()
  const language = useLanguage()
  const checkHealth = useCheckServerHealth()

  const [state, setState] = createStore({
    mode: "choose" as "choose" | "remote",
    url: "",
    username: "cyberstrike",
    password: "",
    busy: false,
    error: "",
  })

  async function connect(raw: string, username?: string, password?: string) {
    setState({ busy: true, error: "" })
    const normalized = normalizeServerUrl(raw)
    if (!normalized) {
      setState({ busy: false, error: language.t("hub.connect.error") })
      return
    }
    const http: ServerConnection.HttpBase = { url: normalized }
    if (username) http.username = username
    if (password) http.password = password

    const result = await checkHealth(http)
    if (!result.healthy) {
      setState({ busy: false, error: language.t("hub.connect.error") })
      return
    }

    server.add({ type: "http", http })
  }

  function onKeyDown(e: KeyboardEvent) {
    e.stopPropagation()
    if (e.key !== "Enter" || e.isComposing) return
    e.preventDefault()
    connect(state.url, state.username, state.password)
  }

  return (
    <div class="flex flex-col items-center justify-center min-h-screen px-4">
      <div class="w-full max-w-sm flex flex-col items-center">
        <Logo class="w-48 opacity-20" />
        <p class="text-14-medium text-text-strong mt-6">{language.t("hub.connect.title")}</p>
        <p class="text-12-regular text-text-weak mt-1">{language.t("hub.connect.description")}</p>

        <div class="w-full mt-6 flex flex-col gap-3">
          <Show when={state.mode === "choose"}>
            <button
              class="w-full p-4 rounded-md bg-surface-raised-base hover:bg-surface-base-hover text-left transition-colors"
              disabled={state.busy}
              onClick={() => connect("http://localhost:4096")}
            >
              <div class="text-14-medium text-text-strong">
                {state.busy ? language.t("hub.connect.connecting") : language.t("hub.connect.localhost")}
              </div>
              <div class="text-12-regular text-text-weak mt-0.5">
                {language.t("hub.connect.localhost.description")}
              </div>
            </button>
            <button
              class="w-full p-4 rounded-md bg-surface-raised-base hover:bg-surface-base-hover text-left transition-colors"
              disabled={state.busy}
              onClick={() => setState({ mode: "remote", error: "" })}
            >
              <div class="text-14-medium text-text-strong">{language.t("hub.connect.remote")}</div>
              <div class="text-12-regular text-text-weak mt-0.5">
                {language.t("hub.connect.remote.description")}
              </div>
            </button>
          </Show>

          <Show when={state.mode === "remote"}>
            <TextField
              type="text"
              label={language.t("hub.connect.url")}
              placeholder={language.t("hub.connect.url.placeholder")}
              value={state.url}
              disabled={state.busy}
              onChange={(v: string) => setState({ url: v, error: "" })}
              onKeyDown={onKeyDown}
              autofocus
            />
            <div class="grid grid-cols-2 gap-2">
              <TextField
                type="text"
                label={language.t("hub.connect.username")}
                placeholder="cyberstrike"
                value={state.username}
                disabled={state.busy}
                onChange={(v: string) => setState({ username: v })}
                onKeyDown={onKeyDown}
              />
              <TextField
                type="password"
                label={language.t("hub.connect.password")}
                placeholder="password"
                value={state.password}
                disabled={state.busy}
                onChange={(v: string) => setState({ password: v })}
                onKeyDown={onKeyDown}
              />
            </div>
            <div class="flex gap-2">
              <Button
                variant="secondary"
                size="large"
                disabled={state.busy}
                onClick={() => setState({ mode: "choose", error: "" })}
              >
                {language.t("hub.connect.back")}
              </Button>
              <Button
                variant="primary"
                size="large"
                disabled={state.busy || !state.url.trim()}
                onClick={() => connect(state.url, state.username, state.password)}
                class="flex-1"
              >
                {state.busy ? language.t("hub.connect.connecting") : language.t("hub.connect.button")}
              </Button>
            </div>
          </Show>

          <Show when={state.error}>
            <p class="text-12-regular text-text-on-critical-base text-center">{state.error}</p>
          </Show>
        </div>
      </div>
    </div>
  )
}
