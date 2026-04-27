// Hackbrowser launch dialog — multi-field form for the /hackbrowser slash
// command. Surface mirrors the LLM tool and the CLI subcommand: target,
// credentials, scope, exclude, headless. Same fields, same semantics across
// all three entry points.
//
// Modeled after dialog-export-options.tsx: tab cycles fields, space toggles
// the headless checkbox, return submits. Submission resolves the Promise
// from DialogHackbrowserLaunch.show — the slash handler does the SDK call.
//
// Multi-value fields (credentials, scope, exclude) accept comma-separated
// input; the form parses on submit. Trim/empty filtering is centralized in
// `splitCSV`.

import { TextareaRenderable, TextAttributes } from "@opentui/core"
import { useTheme } from "../context/theme"
import { useDialog, type DialogContext } from "../ui/dialog"
import { createStore } from "solid-js/store"
import { onMount, Show } from "solid-js"
import { useKeyboard } from "@opentui/solid"

export interface HackbrowserLaunchInput {
  target: string
  credentials?: string[]
  scope?: string[]
  exclude?: string[]
  steps?: number
  headless: boolean
}

type Field = "target" | "credentials" | "scope" | "exclude" | "steps" | "headless"

const FIELD_ORDER: Field[] = ["target", "credentials", "scope", "exclude", "steps", "headless"]

function splitCSV(s: string | undefined): string[] | undefined {
  if (!s) return undefined
  const parts = s
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
  return parts.length > 0 ? parts : undefined
}

export interface DialogHackbrowserLaunchProps {
  onConfirm?: (input: HackbrowserLaunchInput) => void
  onCancel?: () => void
}

export function DialogHackbrowserLaunch(props: DialogHackbrowserLaunchProps) {
  const dialog = useDialog()
  const { theme } = useTheme()
  let targetArea: TextareaRenderable
  let credsArea: TextareaRenderable
  let scopeArea: TextareaRenderable
  let excludeArea: TextareaRenderable
  let stepsArea: TextareaRenderable

  const [store, setStore] = createStore({
    headless: true,
    // Recomputed on tab navigation away from the credentials field. Drives
    // the headless checkbox label + auto-disabling, so the form reflects the
    // launcher's "credentials present → headless: false" rule before submit.
    credentialsPresent: false,
    active: "target" as Field,
  })

  const refreshCredentialsPresent = () => {
    const ids = splitCSV(credsArea?.plainText)
    setStore("credentialsPresent", !!ids && ids.length >= 1)
  }

  const collect = (): HackbrowserLaunchInput | null => {
    const target = targetArea?.plainText?.trim() ?? ""
    if (!target) return null
    const credentials = splitCSV(credsArea?.plainText)
    const scope = splitCSV(scopeArea?.plainText)
    const exclude = splitCSV(excludeArea?.plainText)
    // Steps: optional positive int 1-200; reject malformed input by failing
    // the collect (caller treats null as "form not yet submittable").
    const stepsRaw = stepsArea?.plainText?.trim()
    let steps: number | undefined = undefined
    if (stepsRaw) {
      const n = parseInt(stepsRaw, 10)
      if (!Number.isFinite(n) || n < 1 || n > 200) return null
      steps = n
    }
    // Credentials always require manual login (browser opens, user logs in).
    // Force headless off here so the launcher's pre-flight validation accepts
    // the call; otherwise respect the user's checkbox.
    const headless = credentials && credentials.length >= 1 ? false : store.headless
    return { target, credentials, scope, exclude, steps, headless }
  }

  const focusActive = () => {
    if (store.active === "target") targetArea?.focus()
    else if (store.active === "credentials") credsArea?.focus()
    else if (store.active === "scope") scopeArea?.focus()
    else if (store.active === "exclude") excludeArea?.focus()
    else if (store.active === "steps") stepsArea?.focus()
    else {
      targetArea?.blur()
      credsArea?.blur()
      scopeArea?.blur()
      excludeArea?.blur()
      stepsArea?.blur()
    }
  }

  useKeyboard((evt) => {
    if (evt.name === "tab") {
      // Refresh credentialsPresent so the headless checkbox label updates
      // immediately when the user tabs away from the credentials field.
      refreshCredentialsPresent()
      const idx = FIELD_ORDER.indexOf(store.active)
      const next = FIELD_ORDER[(idx + 1) % FIELD_ORDER.length]
      setStore("active", next)
      setTimeout(focusActive, 0)
      evt.preventDefault()
    }
    if (evt.name === "space" && store.active === "headless" && !store.credentialsPresent) {
      setStore("headless", !store.headless)
      evt.preventDefault()
    }
    if (evt.name === "return") {
      // Submit from any field. Mirrors the dialog-export-options pattern —
      // a global return handler is the primary submit path; the textarea
      // onSubmit acts as redundant insurance (Promise resolves once).
      // All form fields are single-line so we don't need newlines anywhere.
      refreshCredentialsPresent()
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
      if (targetArea && !targetArea.isDestroyed) targetArea.focus()
    }, 1)
  })

  const submitFromTextarea = () => {
    refreshCredentialsPresent()
    const input = collect()
    if (input) props.onConfirm?.(input)
  }

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
          <text fg={store.active === "target" ? theme.primary : theme.text}>Target URL: *</text>
        </box>
        <textarea
          onSubmit={submitFromTextarea}
          height={3}
          keyBindings={[{ name: "return", action: "submit" }]}
          ref={(val: TextareaRenderable) => (targetArea = val)}
          placeholder="https://target.example.com"
          textColor={theme.text}
          focusedTextColor={theme.text}
          cursorColor={theme.text}
        />
      </box>

      <box gap={1}>
        <box>
          <text fg={store.active === "credentials" ? theme.primary : theme.text}>
            Credentials (optional, comma-separated IDs):
          </text>
        </box>
        <textarea
          onSubmit={submitFromTextarea}
          height={3}
          keyBindings={[{ name: "return", action: "submit" }]}
          ref={(val: TextareaRenderable) => (credsArea = val)}
          placeholder="cred_admin, cred_user"
          textColor={theme.text}
          focusedTextColor={theme.text}
          cursorColor={theme.text}
        />
        <text fg={theme.textMuted} paddingLeft={1}>
          Anonymous crawl when empty. Each ID = one manual browser login. Multiple IDs run sequentially per identity.
        </text>
      </box>

      <box gap={1}>
        <box>
          <text fg={store.active === "scope" ? theme.primary : theme.text}>
            Scope (optional, comma-separated host patterns):
          </text>
        </box>
        <textarea
          onSubmit={submitFromTextarea}
          height={3}
          keyBindings={[{ name: "return", action: "submit" }]}
          ref={(val: TextareaRenderable) => (scopeArea = val)}
          placeholder="*.localhost, api.example.com"
          textColor={theme.text}
          focusedTextColor={theme.text}
          cursorColor={theme.text}
        />
      </box>

      <box gap={1}>
        <box>
          <text fg={store.active === "exclude" ? theme.primary : theme.text}>
            Exclude (optional, comma-separated UI labels):
          </text>
        </box>
        <textarea
          onSubmit={submitFromTextarea}
          height={3}
          keyBindings={[{ name: "return", action: "submit" }]}
          ref={(val: TextareaRenderable) => (excludeArea = val)}
          placeholder="Delete Account, Cancel Subscription"
          textColor={theme.text}
          focusedTextColor={theme.text}
          cursorColor={theme.text}
        />
      </box>

      <box gap={1}>
        <box>
          <text fg={store.active === "steps" ? theme.primary : theme.text}>
            Max pages (optional, 1-200, default 50):
          </text>
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
        <box
          flexDirection="row"
          gap={2}
          paddingLeft={1}
          backgroundColor={store.active === "headless" ? theme.backgroundElement : undefined}
          onMouseUp={() => {
            if (store.credentialsPresent) return
            setStore("active", "headless")
            focusActive()
          }}
        >
          <text
            fg={
              store.credentialsPresent
                ? theme.textMuted
                : store.active === "headless"
                  ? theme.primary
                  : theme.textMuted
            }
          >
            {(store.credentialsPresent ? false : store.headless) ? "[x]" : "[ ]"}
          </text>
          <text
            fg={
              store.credentialsPresent
                ? theme.textMuted
                : store.active === "headless"
                  ? theme.primary
                  : theme.text
            }
          >
            {store.credentialsPresent ? "Headless (forced off — credentials need manual login)" : "Headless"}
          </text>
        </box>
      </box>

      <Show when={store.credentialsPresent}>
        <text fg={theme.warning ?? theme.textMuted} paddingLeft={1}>
          ⚠ Manual login: Esc and /hackbrowser-stop cannot cancel during the login wait.
          Close the browser window manually to abort. (INTEGRATION.md §10.10)
        </text>
      </Show>

      <text fg={theme.textMuted} paddingBottom={1}>
        <span style={{ fg: theme.text }}>tab</span> to switch fields,{" "}
        <span style={{ fg: theme.text }}>space</span> to toggle headless,{" "}
        <span style={{ fg: theme.text }}>return</span> to launch (works from any field),{" "}
        <span style={{ fg: theme.text }}>esc</span> to cancel
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
