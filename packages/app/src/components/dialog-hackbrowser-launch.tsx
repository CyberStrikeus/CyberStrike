// Hackbrowser launch dialog — collects a target URL (required) plus optional
// advanced fields (credentials, scope, exclude, steps, headless) and kicks off
// a crawl via sdk.client.session.hackbrowserLaunch. Surface mirrors the TUI
// slash command and the CLI subcommand: same fields, same semantics across all
// entry points. On success the caller opens the live hackbrowser side panel.

import { Component, createSignal, Show } from "solid-js"
import { useSDK } from "@/context/sdk"
import { useLanguage } from "@/context/language"
import { useDialog } from "@cyberstrike-io/ui/context/dialog"
import { Dialog } from "@cyberstrike-io/ui/dialog"
import { TextField } from "@cyberstrike-io/ui/text-field"
import { Switch } from "@cyberstrike-io/ui/switch"
import { Button } from "@cyberstrike-io/ui/button"
import { Spinner } from "@cyberstrike-io/ui/spinner"
import { showToast } from "@cyberstrike-io/ui/toast"

function splitCSV(raw: string): string[] | undefined {
  const parts = raw
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
  if (parts.length === 0) return undefined
  return parts
}

function parseSteps(raw: string): { value?: number; error: boolean } {
  const trimmed = raw.trim()
  if (!trimmed) return { error: false }
  const n = Number.parseInt(trimmed, 10)
  if (!Number.isFinite(n) || n < 1 || n > 200) return { error: true }
  return { value: n, error: false }
}

export const DialogHackbrowserLaunch: Component<{ sessionID: string; onLaunched?: () => void }> = (props) => {
  const sdk = useSDK()
  const language = useLanguage()
  const dialog = useDialog()

  const [target, setTarget] = createSignal("")
  const [credentials, setCredentials] = createSignal("Anonymous")
  const [scope, setScope] = createSignal("")
  const [exclude, setExclude] = createSignal("")
  const [steps, setSteps] = createSignal("")
  const [headless, setHeadless] = createSignal(true)
  const [advanced, setAdvanced] = createSignal(false)
  const [error, setError] = createSignal("")
  const [launching, setLaunching] = createSignal(false)

  const submit = async () => {
    if (launching()) return
    const url = target().trim()
    if (!url) {
      setError(language.t("hackbrowser.launch.target.required"))
      return
    }
    try {
      new URL(url)
    } catch {
      setError(language.t("hackbrowser.launch.target.invalid"))
      return
    }

    const parsedSteps = parseSteps(steps())
    if (parsedSteps.error) {
      setError(language.t("hackbrowser.launch.steps.invalid"))
      return
    }

    setError("")
    setLaunching(true)

    const creds = splitCSV(credentials())
    // Credentials require manual login (a browser opens), so headless is forced
    // off in that case — matching the launcher's pre-flight validation.
    const runHeadless = creds && creds.length > 0 ? false : headless()

    try {
      const result = await (sdk().client.session as any).hackbrowserLaunch({
        sessionID: props.sessionID,
        target: url,
        credentials: creds,
        scope: splitCSV(scope()),
        exclude: splitCSV(exclude()),
        steps: parsedSteps.value,
        headless: runHeadless,
      })
      showToast({
        title: language.t("hackbrowser.title"),
        description: result.data?.message ?? language.t("hackbrowser.launch.started"),
        variant: "success",
      })
      dialog.close()
      props.onLaunched?.()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      showToast({
        title: language.t("hackbrowser.launch.failed"),
        description: message,
        variant: "error",
      })
    } finally {
      setLaunching(false)
    }
  }

  const onEnter = (e: KeyboardEvent) => {
    if (e.key === "Enter") submit()
  }

  return (
    <Dialog title={language.t("hackbrowser.launch.title")} description={language.t("hackbrowser.launch.description")}>
      <Show
        when={!launching()}
        fallback={
          <div class="flex flex-col items-center gap-3 p-8">
            <Spinner />
            <p class="text-13-regular text-text-weak">{language.t("hackbrowser.launch.launching")}</p>
          </div>
        }
      >
        <div class="flex flex-col gap-3 p-4">
          <Show when={error()}>
            <p class="text-12-regular text-icon-danger-base">{error()}</p>
          </Show>

          <TextField
            label={language.t("hackbrowser.launch.target")}
            placeholder={language.t("hackbrowser.launch.target.placeholder")}
            value={target()}
            onChange={(v) => {
              setTarget(v)
              setError("")
            }}
            autofocus
            onKeyDown={onEnter}
          />

          <button
            type="button"
            class="flex items-center gap-1 self-start text-12-regular text-text-weaker hover:text-text-base cursor-pointer border-none bg-transparent"
            onClick={() => setAdvanced((v) => !v)}
          >
            <span
              class="text-[10px] transition-transform duration-150"
              style={{ transform: advanced() ? "rotate(90deg)" : "rotate(0deg)" }}
            >
              {"▶"}
            </span>
            {language.t("hackbrowser.launch.advanced")}
          </button>

          <Show when={advanced()}>
            <div class="flex flex-col gap-3">
              <TextField
                label={language.t("hackbrowser.launch.credentials")}
                description={language.t("hackbrowser.launch.credentials.description")}
                placeholder="Anonymous, user, admin"
                value={credentials()}
                onChange={setCredentials}
                onKeyDown={onEnter}
              />
              <TextField
                label={language.t("hackbrowser.launch.scope")}
                description={language.t("hackbrowser.launch.scope.description")}
                placeholder="*.localhost, api.example.com"
                value={scope()}
                onChange={setScope}
                onKeyDown={onEnter}
              />
              <TextField
                label={language.t("hackbrowser.launch.exclude")}
                description={language.t("hackbrowser.launch.exclude.description")}
                placeholder="Delete Account, Cancel Subscription"
                value={exclude()}
                onChange={setExclude}
                onKeyDown={onEnter}
              />
              <TextField
                label={language.t("hackbrowser.launch.steps")}
                description={language.t("hackbrowser.launch.steps.description")}
                placeholder="50"
                value={steps()}
                onChange={(v) => {
                  setSteps(v)
                  setError("")
                }}
                onKeyDown={onEnter}
              />
              <div class="flex items-center justify-between gap-2">
                <div class="flex flex-col min-w-0">
                  <span class="text-13-regular text-text-base">{language.t("hackbrowser.launch.headless")}</span>
                  <span class="text-11-regular text-text-weaker">
                    {language.t("hackbrowser.launch.headless.description")}
                  </span>
                </div>
                <Switch checked={headless()} onChange={setHeadless} />
              </div>
            </div>
          </Show>

          <div class="flex justify-end gap-2">
            <Button variant="ghost" size="small" onClick={() => dialog.close()}>
              {language.t("common.cancel")}
            </Button>
            <Button variant="primary" size="small" onClick={submit}>
              {language.t("hackbrowser.launch")}
            </Button>
          </div>
        </div>
      </Show>
    </Dialog>
  )
}
