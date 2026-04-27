// Hackbrowser launch dialog — multi-field form for the /hackbrowser slash
// command (Faz D). Mirrors LauncherOptions surface that the LLM tool
// intentionally hides (notably `authenticated` for manual-login mode).
//
// Modeled after dialog-export-options.tsx: tab cycles fields, space toggles
// checkboxes, return submits. Submission resolves the Promise from
// DialogHackbrowserLaunch.show — the slash handler does the SDK call.

import { TextareaRenderable, TextAttributes } from "@opentui/core"
import { useTheme } from "../context/theme"
import { useDialog, type DialogContext } from "../ui/dialog"
import { createStore } from "solid-js/store"
import { onMount, Show } from "solid-js"
import { useKeyboard } from "@opentui/solid"

export interface HackbrowserLaunchInput {
  url: string
  credentialID?: string
  steps?: number
  authenticated: boolean
  headless: boolean
}

type Field = "url" | "credentialID" | "steps" | "authenticated" | "headless"

const FIELD_ORDER: Field[] = ["url", "credentialID", "steps", "authenticated", "headless"]

export interface DialogHackbrowserLaunchProps {
  onConfirm?: (input: HackbrowserLaunchInput) => void
  onCancel?: () => void
}

export function DialogHackbrowserLaunch(props: DialogHackbrowserLaunchProps) {
  const dialog = useDialog()
  const { theme } = useTheme()
  let urlArea: TextareaRenderable
  let credArea: TextareaRenderable
  let stepsArea: TextareaRenderable

  const [store, setStore] = createStore({
    authenticated: false,
    headless: true,
    active: "url" as Field,
  })

  // Build the current input snapshot from the textareas + store. Used both at
  // submit time and to keep validation logic in one place.
  const collect = (): HackbrowserLaunchInput | null => {
    const url = urlArea?.plainText?.trim() ?? ""
    if (!url) return null
    const credentialID = credArea?.plainText?.trim() || undefined
    const stepsRaw = stepsArea?.plainText?.trim()
    const steps = stepsRaw ? parseInt(stepsRaw, 10) : undefined
    if (steps !== undefined && (!Number.isFinite(steps) || steps < 1 || steps > 200)) return null
    return {
      url,
      credentialID,
      steps,
      authenticated: store.authenticated,
      // Manual-login mode requires headfull; force headless=false when
      // authenticated is set so the launcher's pre-flight doesn't reject.
      headless: store.authenticated ? false : store.headless,
    }
  }

  const focusActive = () => {
    if (store.active === "url") urlArea?.focus()
    else if (store.active === "credentialID") credArea?.focus()
    else if (store.active === "steps") stepsArea?.focus()
    else {
      urlArea?.blur()
      credArea?.blur()
      stepsArea?.blur()
    }
  }

  useKeyboard((evt) => {
    if (evt.name === "tab") {
      const idx = FIELD_ORDER.indexOf(store.active)
      const next = FIELD_ORDER[(idx + 1) % FIELD_ORDER.length]
      setStore("active", next)
      setTimeout(focusActive, 0)
      evt.preventDefault()
    }
    if (evt.name === "space") {
      if (store.active === "authenticated") {
        const nextAuth = !store.authenticated
        setStore("authenticated", nextAuth)
        // When auth turns on, force headless off; flipping auth back off
        // restores the user's prior headless choice (default true).
        if (nextAuth) setStore("headless", false)
        else setStore("headless", true)
        evt.preventDefault()
      }
      if (store.active === "headless" && !store.authenticated) {
        setStore("headless", !store.headless)
        evt.preventDefault()
      }
    }
    if (evt.name === "return" && store.active !== "url" && store.active !== "credentialID" && store.active !== "steps") {
      const input = collect()
      if (input) props.onConfirm?.(input)
      evt.preventDefault()
    }
    if (evt.name === "escape") {
      props.onCancel?.()
      evt.preventDefault()
    }
  })

  onMount(() => {
    dialog.setSize("medium")
    setTimeout(() => {
      if (urlArea && !urlArea.isDestroyed) urlArea.focus()
    }, 1)
  })

  const submitFromTextarea = () => {
    const input = collect()
    if (input) props.onConfirm?.(input)
  }

  const checkbox = (label: string, field: "authenticated" | "headless", checked: boolean, disabled = false) => (
    <box
      flexDirection="row"
      gap={2}
      paddingLeft={1}
      backgroundColor={store.active === field ? theme.backgroundElement : undefined}
      onMouseUp={() => {
        if (disabled) return
        setStore("active", field)
        focusActive()
      }}
    >
      <text fg={disabled ? theme.textMuted : store.active === field ? theme.primary : theme.textMuted}>
        {checked ? "[x]" : "[ ]"}
      </text>
      <text fg={disabled ? theme.textMuted : store.active === field ? theme.primary : theme.text}>{label}</text>
    </box>
  )

  return (
    <box paddingLeft={2} paddingRight={2} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          Launch hackbrowser crawl
        </text>
        <text fg={theme.textMuted} onMouseUp={() => props.onCancel?.()}>
          esc
        </text>
      </box>

      <box gap={1}>
        <box>
          <text fg={store.active === "url" ? theme.primary : theme.text}>Target URL: *</text>
        </box>
        <textarea
          onSubmit={submitFromTextarea}
          height={3}
          keyBindings={[{ name: "return", action: "submit" }]}
          ref={(val: TextareaRenderable) => (urlArea = val)}
          placeholder="https://target.example.com"
          textColor={theme.text}
          focusedTextColor={theme.text}
          cursorColor={theme.text}
        />
      </box>

      <box gap={1}>
        <box>
          <text fg={store.active === "credentialID" ? theme.primary : theme.text}>
            Credential ID (optional, for capture tagging):
          </text>
        </box>
        <textarea
          onSubmit={submitFromTextarea}
          height={3}
          keyBindings={[{ name: "return", action: "submit" }]}
          ref={(val: TextareaRenderable) => (credArea = val)}
          placeholder="cred_..."
          textColor={theme.text}
          focusedTextColor={theme.text}
          cursorColor={theme.text}
        />
      </box>

      <box gap={1}>
        <box>
          <text fg={store.active === "steps" ? theme.primary : theme.text}>Max pages (optional, 1-200, default 50):</text>
        </box>
        <textarea
          onSubmit={submitFromTextarea}
          height={3}
          keyBindings={[{ name: "return", action: "submit" }]}
          ref={(val: TextareaRenderable) => (stepsArea = val)}
          placeholder="50"
          textColor={theme.text}
          focusedTextColor={theme.text}
          cursorColor={theme.text}
        />
      </box>

      <box flexDirection="column">
        {checkbox("Wait for manual login (authenticated mode)", "authenticated", store.authenticated)}
        {checkbox(
          store.authenticated ? "Headless (forced off in manual-login mode)" : "Headless",
          "headless",
          store.authenticated ? false : store.headless,
          store.authenticated,
        )}
      </box>

      <Show when={store.authenticated}>
        <text fg={theme.warning ?? theme.textMuted} paddingLeft={1}>
          ⚠ Manual-login mode: Esc and /hackbrowser-stop cannot cancel during the login wait.
          Close the browser window manually to abort. (INTEGRATION.md §10.10)
        </text>
      </Show>

      <text fg={theme.textMuted} paddingBottom={1}>
        <span style={{ fg: theme.text }}>tab</span> to switch fields,{" "}
        <span style={{ fg: theme.text }}>space</span> to toggle,{" "}
        <span style={{ fg: theme.text }}>return</span> to launch (in URL/cred/steps fields too)
      </text>
    </box>
  )
}

DialogHackbrowserLaunch.show = (dialog: DialogContext) => {
  return new Promise<HackbrowserLaunchInput | null>((resolve) => {
    dialog.replace(
      () => (
        <DialogHackbrowserLaunch
          onConfirm={(input) => {
            dialog.clear()
            resolve(input)
          }}
          onCancel={() => {
            dialog.clear()
            resolve(null)
          }}
        />
      ),
      () => resolve(null),
    )
  })
}
