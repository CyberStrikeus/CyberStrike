import type { Page, Locator, ElementHandle, Request as PWRequest } from "playwright"
import type { UIField, UIContext } from "./types.ts"

// ============================================================
// UI Context Capture
// ============================================================

/**
 * Snapshot form fields scoped to the trigger element's enclosing form/dialog.
 * Called right before a form-submitting action so the snapshot reflects pre-action UI state.
 *
 * @param trigger  Playwright Locator of the element being clicked. When null, falls back
 *                 to a full-page scan (legacy / debug path). When non-null, scope resolution
 *                 follows Kural 3: form → dialog → empty fields.
 * @param componentPath  Human-readable path used in returned UIContext (cosmetic).
 */
export async function snapshotPageUI(page: Page, trigger: Locator | null, componentPath = ""): Promise<UIContext> {
  const pageUrl = page.url()
  const pageTitle = await page.title()

  // Resolve the trigger to a real DOM handle. If the locator can't find an element
  // (detached, stale), we fall through to null — the conservative body-scope fallback.
  let triggerHandle: ElementHandle | null = null
  if (trigger) {
    try {
      triggerHandle = await trigger.elementHandle({ timeout: 500 })
    } catch {
      triggerHandle = null
    }
  }

  const fields = (await page.evaluate(
    (triggerEl: Element | null): UIField[] => {
      // Kural 3: modal/dialog container selectors (ARIA-first, widely-used frameworks only)
      const DIALOG_SEL =
        "[role=dialog], [role=alertdialog], [aria-modal='true'], mat-dialog-container, .cdk-overlay-pane"

      const results: UIField[] = []

      function getLabel(el: HTMLElement): string {
        const aria = el.getAttribute("aria-label")
        if (aria) return aria.trim()

        const id = el.getAttribute("id")
        if (id) {
          const label = document.querySelector(`label[for="${id}"]`)
          if (label) return label.textContent?.trim() ?? ""
        }

        const parentLabel = el.closest("label")
        if (parentLabel) return parentLabel.textContent?.trim() ?? ""

        const ph = (el as HTMLInputElement).placeholder
        if (ph) return ph

        return (el as HTMLInputElement).name || el.getAttribute("data-name") || ""
      }

      // Kural 4 (BUG-17): compute WHY a field is hidden. Walks ancestors because
      // display:none and opacity:0 don't inherit via computed style of the child.
      // Returns the first hiding reason encountered on el or any ancestor.
      function computeHidden(
        el: HTMLElement,
        type: string,
      ): { isHidden: boolean; hiddenReason?: "type=hidden" | "display:none" | "visibility:hidden" | "opacity:0" } {
        if (type === "hidden") return { isHidden: true, hiddenReason: "type=hidden" }
        let cur: Element | null = el
        while (cur && cur !== document.documentElement) {
          const style = window.getComputedStyle(cur)
          if (style.display === "none") return { isHidden: true, hiddenReason: "display:none" }
          if (style.visibility === "hidden") return { isHidden: true, hiddenReason: "visibility:hidden" }
          if (parseFloat(style.opacity) === 0) return { isHidden: true, hiddenReason: "opacity:0" }
          cur = cur.parentElement
        }
        return { isHidden: false }
      }

      // Back-compat alias for the radio collapse block which only needs a boolean signal.
      function isHiddenCSS(el: HTMLElement): boolean {
        return computeHidden(el, "").isHidden
      }

      // Noise patterns — Angular CDK / Material internals that are never real form fields
      const NOISE_ID_PREFIX = /^(cdk-|mat-)/i

      // Kural 3: resolve scope from trigger element.
      //   1. closest("form")           → form scope
      //   2. closest(dialog selectors) → dialog scope
      //   3. trigger present, neither  → return [] (outside form context)
      //   4. no trigger                → document (legacy body scan)
      let root: ParentNode | null
      if (triggerEl) {
        root = triggerEl.closest("form") ?? triggerEl.closest(DIALOG_SEL)
        if (!root) return [] // action outside any form/dialog — no meaningful ui_context
      } else {
        root = document
      }

      // --- Form inputs ---
      const inputs = root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
        "input, textarea, select",
      )

      // Radio inputs are collected into groups (by name) and emitted as one field each — see Kural 1.
      type RadioGroup = {
        name: string
        label: string
        checkedValue: string
        allValues: string[]
        anyRequired: boolean
        allDisabled: boolean
        anyCSSHidden: boolean
      }
      const radioGroups = new Map<string, RadioGroup>()

      for (const el of inputs) {
        const tagName = el.tagName.toLowerCase()
        const type = tagName === "input" ? (el as HTMLInputElement).type.toLowerCase() : tagName
        // Identifier fallback chain — modern SPAs often omit name/id and rely on
        // test-hook attributes (data-testid/data-test/data-cy) or accessibility
        // labels. Ordered by reliability: form-standard → DOM unique → custom
        // semantic → test infrastructure → accessibility.
        const name =
          el.getAttribute("name") ||
          el.getAttribute("id") ||
          el.getAttribute("data-name") ||
          el.getAttribute("data-testid") ||
          el.getAttribute("data-test") ||
          el.getAttribute("data-cy") ||
          el.getAttribute("aria-label") ||
          ""

        // Skip Angular/CDK internal inputs that have no user-meaningful name
        if (NOISE_ID_PREFIX.test(name) && el.disabled) continue

        // Kural 1: collapse radios by name — accumulate here, emit after the loop
        if (type === "radio") {
          const radioName = el.getAttribute("name") || ""
          if (!radioName) continue // nameless radio can't be grouped; skip (rare, handled by Kural 5 later)
          const input = el as HTMLInputElement
          const existing = radioGroups.get(radioName)
          if (existing) {
            existing.allValues.push(input.value)
            if (input.checked) existing.checkedValue = input.value
            if (input.required) existing.anyRequired = true
            if (!input.disabled) existing.allDisabled = false
            if (isHiddenCSS(input)) existing.anyCSSHidden = true
          } else {
            radioGroups.set(radioName, {
              name: radioName,
              label: getLabel(input),
              checkedValue: input.checked ? input.value : "",
              allValues: [input.value],
              anyRequired: input.required,
              allDisabled: input.disabled,
              anyCSSHidden: isHiddenCSS(input),
            })
          }
          continue
        }

        const value =
          type === "checkbox"
            ? String((el as HTMLInputElement).checked)
            : type === "select" || tagName === "select"
              ? (el as HTMLSelectElement).value
              : ((el as HTMLInputElement | HTMLTextAreaElement).value ?? "")

        const hidden = computeHidden(el as HTMLElement, type)

        results.push({
          name,
          label: getLabel(el as HTMLElement),
          value,
          type,
          isReadOnly: (el as HTMLInputElement).readOnly ?? false,
          isDisabled: el.disabled,
          isHidden: hidden.isHidden,
          hiddenReason: hidden.hiddenReason,
          isDisplayOnly: false,
          validation: {
            min: (el as HTMLInputElement).min || undefined,
            max: (el as HTMLInputElement).max || undefined,
            maxLength: (el as HTMLInputElement).maxLength > 0 ? String((el as HTMLInputElement).maxLength) : undefined,
            pattern: (el as HTMLInputElement).pattern || undefined,
            required: el.required || false,
          },
        })
      }

      // Emit one UIField per radio group (Kural 1). options = first 3 + ", ..." if >3.
      for (const group of radioGroups.values()) {
        const first3 = group.allValues.slice(0, 3).join(", ")
        const options = group.allValues.length > 3 ? `${first3}, ...` : first3
        results.push({
          name: group.name,
          label: group.label,
          value: group.checkedValue,
          type: "radio",
          options,
          isReadOnly: false,
          isDisabled: group.allDisabled,
          isHidden: group.anyCSSHidden,
          isDisplayOnly: false,
          validation: { required: group.anyRequired },
        })
      }

      // --- Display-only values — only data-* attributed elements, not generic span/div[id] ---
      const displaySelectors = [
        "[data-field]",
        "[data-value]",
        "[data-id]",
        ".field-value",
        ".read-only-value",
        ".display-value",
        "td[id]",
      ]

      for (const sel of displaySelectors) {
        const els = root.querySelectorAll<HTMLElement>(sel)
        for (const el of els) {
          if (el.querySelector("input, select, textarea, button")) continue

          // Kural 2: listbox/menu/combobox entries are NOT form fields —
          // they are option pickers. Skip both the entries themselves and
          // any descendant of a listbox/menu/combobox container.
          if (el.matches("[role=option], [role=menuitem], [role=tab]")) continue
          if (el.closest("[role=listbox], [role=menu], [role=combobox]")) continue

          const name = el.getAttribute("data-field") || el.getAttribute("data-name") || el.getAttribute("id") || ""

          // Skip Angular CDK noise IDs
          if (NOISE_ID_PREFIX.test(name)) continue

          const text = el.textContent?.trim() ?? ""
          if (!text) continue

          results.push({
            name,
            label: el.getAttribute("aria-label") || name,
            value: text,
            type: "display",
            isReadOnly: true,
            isDisabled: false,
            isHidden: isHiddenCSS(el),
            isDisplayOnly: true,
            validation: {},
          })
        }
      }

      return results
    },
    triggerHandle as ElementHandle<Element> | null,
  )) as UIField[]

  // Release the handle after evaluate — avoid leaks if caller keeps page alive
  if (triggerHandle) {
    await triggerHandle.dispose().catch(() => {})
  }

  // Best-guess form name from the page
  const formName = (await page.evaluate(() => {
    const form = document.querySelector("form")
    return (
      form?.getAttribute("aria-label") ||
      form?.getAttribute("id") ||
      form?.getAttribute("name") ||
      document.querySelector("h1, h2, [role=heading]")?.textContent?.trim() ||
      ""
    )
  })) as string

  return {
    pageUrl,
    pageTitle,
    componentPath: componentPath || pageTitle,
    formName,
    fields,
    hiddenParams: [], // filled later during correlation
  }
}

// ============================================================
// HTTP Request Builder (mirrors Firefox ext buildRawRequest)
// ============================================================

export function buildRawRequest(
  method: string,
  url: string,
  headers: Record<string, string>,
  body: string | null,
): string {
  const urlObj = new URL(url)
  const path = urlObj.pathname + urlObj.search + urlObj.hash

  let raw = `${method} ${path} HTTP/1.1\r\n`

  let hasHost = false
  for (const [name, value] of Object.entries(headers)) {
    raw += `${name}: ${value}\r\n`
    if (name.toLowerCase() === "host") hasHost = true
  }
  if (!hasHost) {
    raw += `Host: ${urlObj.host}\r\n`
  }

  if (body) {
    raw += `\r\n${body}`
  }

  return raw
}

// ============================================================
// Correlation: match request params → UI fields
// ============================================================

/**
 * Given the parsed request body/query params and the UI snapshot,
 * identify which params are NOT present in the UI (potential hidden params).
 */
export function correlateWithUI(uiContext: UIContext, requestParams: Record<string, string>): UIContext {
  const uiFieldNames = new Set(uiContext.fields.map((f) => f.name.toLowerCase()))

  const hiddenParams: string[] = []
  for (const param of Object.keys(requestParams)) {
    if (!uiFieldNames.has(param.toLowerCase())) {
      hiddenParams.push(param)
    }
  }

  return { ...uiContext, hiddenParams }
}

/**
 * Parse flat key=value params from a request body or query string.
 */
export function parseRequestParams(body: string | null, url: string): Record<string, string> {
  const params: Record<string, string> = {}

  // Query string
  try {
    const urlObj = new URL(url)
    urlObj.searchParams.forEach((value, key) => {
      params[key] = value
    })
  } catch {}

  if (!body) return params

  // JSON body
  try {
    const json = JSON.parse(body)
    if (typeof json === "object" && json !== null) {
      flattenObject(json, "", params)
    }
    return params
  } catch {}

  // Form-encoded body
  try {
    const sp = new URLSearchParams(body)
    sp.forEach((value, key) => {
      params[key] = value
    })
  } catch {}

  return params
}

function flattenObject(obj: Record<string, unknown>, prefix: string, out: Record<string, string>) {
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      flattenObject(value as Record<string, unknown>, fullKey, out)
    } else {
      out[fullKey] = String(value)
    }
  }
}
