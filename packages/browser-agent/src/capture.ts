import type { Page, Request as PWRequest } from "playwright"
import type { UIField, UIContext } from "./types.ts"

// ============================================================
// UI Context Capture
// ============================================================

/**
 * Snapshot interactive form fields scoped to a specific form.
 * Called right before a form submission so we know the exact UI state at request time.
 *
 * @param formSelector  CSS selector for the form (e.g. "form#login", "body").
 *                      When "body", falls back to full-page scan but still filters noise.
 */
export async function snapshotPageUI(page: Page, formSelector: string, componentPath = ""): Promise<UIContext> {
  const pageUrl = page.url()
  const pageTitle = await page.title()

  const fields = await page.evaluate((formSel: string): UIField[] => {
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

    function isHiddenCSS(el: HTMLElement): boolean {
      const style = window.getComputedStyle(el)
      return style.display === "none" || style.visibility === "hidden" || style.opacity === "0"
    }

    // Noise patterns — Angular CDK / Material internals that are never real form fields
    const NOISE_ID_PREFIX = /^(cdk-|mat-)/i

    // Scope to the form element when possible, fall back to full document
    const root: ParentNode =
      formSel && formSel !== "body"
        ? (document.querySelector(formSel) ?? document)
        : document

    // --- Form inputs ---
    const inputs = root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
      "input, textarea, select"
    )

    for (const el of inputs) {
      const tagName = el.tagName.toLowerCase()
      const type = tagName === "input" ? (el as HTMLInputElement).type.toLowerCase() : tagName
      const name = el.getAttribute("name") || el.getAttribute("id") || el.getAttribute("data-name") || ""

      // Skip Angular/CDK internal inputs that have no user-meaningful name
      if (NOISE_ID_PREFIX.test(name) && el.disabled) continue

      const value = type === "checkbox"
        ? String((el as HTMLInputElement).checked)
        : type === "select" || tagName === "select"
          ? (el as HTMLSelectElement).value
          : (el as HTMLInputElement | HTMLTextAreaElement).value ?? ""

      const isHidden = type === "hidden" || isHiddenCSS(el as HTMLElement)

      results.push({
        name,
        label: getLabel(el as HTMLElement),
        value,
        type,
        isReadOnly: (el as HTMLInputElement).readOnly ?? false,
        isDisabled: el.disabled,
        isHidden,
        isDisplayOnly: false,
        validation: {
          min: (el as HTMLInputElement).min || undefined,
          max: (el as HTMLInputElement).max || undefined,
          maxLength: (el as HTMLInputElement).maxLength > 0
            ? String((el as HTMLInputElement).maxLength)
            : undefined,
          pattern: (el as HTMLInputElement).pattern || undefined,
          required: el.required || false,
        },
      })
    }

    // --- Display-only values — only data-* attributed elements, not generic span/div[id] ---
    const displaySelectors = [
      "[data-field]", "[data-value]", "[data-id]",
      ".field-value", ".read-only-value", ".display-value",
      "td[id]",
    ]

    for (const sel of displaySelectors) {
      const els = root.querySelectorAll<HTMLElement>(sel)
      for (const el of els) {
        if (el.querySelector("input, select, textarea, button")) continue

        const name =
          el.getAttribute("data-field") ||
          el.getAttribute("data-name") ||
          el.getAttribute("id") ||
          ""

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
  }, formSelector) as UIField[]

  // Best-guess form name from the page
  const formName = await page.evaluate(() => {
    const form = document.querySelector("form")
    return (
      form?.getAttribute("aria-label") ||
      form?.getAttribute("id") ||
      form?.getAttribute("name") ||
      document.querySelector("h1, h2, [role=heading]")?.textContent?.trim() ||
      ""
    )
  }) as string

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
  body: string | null
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
export function correlateWithUI(
  uiContext: UIContext,
  requestParams: Record<string, string>
): UIContext {
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
