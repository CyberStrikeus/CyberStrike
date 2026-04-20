import type { Page } from "playwright"
import { Log } from "cyberstrike/util/log"
import type { RawElement } from "./types.ts"
import { normalizeUrl } from "./state.ts"

const log = Log.create({ service: "browser-agent:scanner" })

// ============================================================
// Constants
// ============================================================

const MAX_ELEMENTS = 50

// ============================================================
// Element collection — runs inside browser via page.evaluate
// ============================================================

interface BrowserElement {
  tag: string
  role: string
  label: string
  value: string
  enabled: boolean
  href: string
  type: string
  placeholder: string
  options: string        // comma-separated option values for <select>
  selectorRole: string   // role=button[name="..."]
  selectorCSS: string    // fallback CSS selector
}

/**
 * Collect all structurally-visible interactive elements from the page DOM.
 * Scanner is viewport-agnostic: it observes DOM structure, not presentation.
 * Viewport visibility is a presentation concern handled by Playwright at
 * action-time (scrollIntoViewIfNeeded).
 *
 * Runs entirely inside the browser context via page.evaluate.
 * Returns raw data — IDs are assigned by the caller.
 */
async function collectInteractiveElements(page: Page): Promise<BrowserElement[]> {
  return page.evaluate((): BrowserElement[] => {
    // ---- isStructurallyVisible: DOM-level visibility (not viewport) ----
    function isStructurallyVisible(el: Element): boolean {
      const rect = el.getBoundingClientRect()
      // Zero-size elements (display:none collapsed, a11y-hidden off-screen tricks)
      if (rect.width === 0 && rect.height === 0) return false
      const style = window.getComputedStyle(el)
      if (style.display === "none") return false
      if (style.visibility === "hidden") return false
      if (parseFloat(style.opacity) === 0) return false
      if (el.getAttribute("aria-hidden") === "true") return false
      // pointer-events:none on non-disabled interactives usually means overlay blocker
      // (disabled buttons legitimately have pointer-events:none on Angular Material/MUI)
      if (style.pointerEvents === "none" && !(el as HTMLButtonElement).disabled) return false
      return true
    }

    function getLabel(el: Element): string {
      const ariaLabel = el.getAttribute("aria-label")?.trim()
      if (ariaLabel) {
        // If element has child text that's different and descriptive, append it
        // This differentiates product cards with same generic aria-label
        const childText = (el as HTMLElement).innerText?.trim()
        if (childText && childText.length > 5 && childText.length < 80 && childText !== ariaLabel) {
          return `${ariaLabel} — ${childText}`
        }
        return ariaLabel
      }
      const ariaLabelledBy = el.getAttribute("aria-labelledby")
      if (ariaLabelledBy) {
        const labelEl = document.getElementById(ariaLabelledBy)
        if (labelEl?.textContent?.trim()) return labelEl.textContent.trim()
      }
      const id = el.getAttribute("id")
      if (id) {
        const labelEl = document.querySelector(`label[for="${id}"]`)
        if (labelEl?.textContent?.trim()) return labelEl.textContent.trim()
      }
      const text = (el as HTMLElement).innerText?.trim()
      if (text && text.length < 80) return text
      // BUG-4: inputs wrapped in <label>text</label> have no innerText of their own —
      // the parent <label> textContent is the visible label. This matches capture.getLabel.
      const parentLabel = (el as HTMLElement).closest?.("label")
      if (parentLabel && !parentLabel.isSameNode(el)) {
        const parentText = parentLabel.textContent?.trim()
        if (parentText && parentText.length < 80) return parentText
      }
      const placeholder = (el as HTMLInputElement).placeholder
      if (placeholder) return placeholder
      const name = el.getAttribute("name") || el.getAttribute("data-testid")
      if (name) return name
      return ""
    }

    function getRole(el: Element): string {
      const explicit = el.getAttribute("role")
      if (explicit) return explicit.toLowerCase()
      const tag = el.tagName.toLowerCase()
      const type = (el as HTMLInputElement).type?.toLowerCase()
      if (tag === "button") return "button"
      if (tag === "a" && el.getAttribute("href")) return "link"
      if (tag === "input") {
        if (type === "submit" || type === "button") return "button"
        if (type === "checkbox") return "checkbox"
        if (type === "radio") return "radio"
        if (type === "hidden") return ""
        if (type === "range") return "slider"
        return "textbox"
      }
      if (tag === "textarea") return "textbox"
      if (tag === "select") return "combobox"
      if (tag === "li" && el.closest("[role=menu],[role=listbox]")) return "menuitem"
      // Clickable divs/spans with onclick handler — treat as button
      if (el.hasAttribute("onclick")) return "button"
      return ""
    }

    function buildCSSSelector(el: Element): string {
      const tag = el.tagName.toLowerCase()
      const id = el.getAttribute("id")
      if (id) return `${tag}#${CSS.escape(id)}`
      const name = el.getAttribute("name")
      if (name) return `${tag}[name="${CSS.escape(name)}"]`

      // Helper: find nearest identifiable ancestor for selector context
      function ancestorPrefix(el: Element): string {
        let current = el.parentElement
        while (current && current !== document.documentElement) {
          const aTag = current.tagName.toLowerCase()
          const aId = current.getAttribute("id")
          if (aId) return `${aTag}#${CSS.escape(aId)} `
          const aCls = typeof current.className === "string" ? current.className.trim().split(/\s+/).filter(c => c.length > 2)[0] : undefined
          if (aCls) return `${aTag}.${CSS.escape(aCls)} `
          current = current.parentElement
        }
        return ""
      }

      // class-based selector with parent context
      const cls = el.className
      if (typeof cls === "string" && cls.trim()) {
        const classes = cls.trim().split(/\s+/).filter(c => c.length > 2)
        if (classes.length > 0) {
          const clsSel = `${tag}.${CSS.escape(classes[0]!)}`
          const parent = el.parentElement
          if (parent) {
            const siblings = Array.from(parent.querySelectorAll(`:scope > ${clsSel}`))
            const idx = siblings.indexOf(el)
            if (idx >= 0) return `${ancestorPrefix(el)}${clsSel}:nth-of-type(${idx + 1})`
          }
          return clsSel
        }
      }
      // nth-of-type with parent context fallback
      const parent = el.parentElement
      if (parent) {
        const siblings = Array.from(parent.querySelectorAll(`:scope > ${tag}`))
        const idx = siblings.indexOf(el)
        if (idx >= 0) {
          const nthSel = `${tag}:nth-of-type(${idx + 1})`
          return `${ancestorPrefix(el)}${nthSel}`
        }
      }
      return tag
    }

    const INTERACTIVE_SELECTORS = [
      "button",
      "a[href]",
      "input:not([type=hidden]):not([disabled])",
      "textarea:not([disabled])",
      "select:not([disabled])",
      "[role=button]",
      "[role=link]",
      "[role=menuitem]",
      "[role=tab]",
      "[role=checkbox]",
      "[role=radio]",
      "[role=combobox]",
      "[role=option]",
      "[role=slider]",
      "[onclick]",
    ].join(", ")

    const elements: BrowserElement[] = []
    const seenCount = new Map<string, number>()
    const seenRoleSelectors = new Map<string, number>()

    for (const el of document.querySelectorAll(INTERACTIVE_SELECTORS)) {
      const role = getRole(el)
      if (!role) continue

      // Sliders (mat-slider, [role=slider]) often have pointer-events:none or opacity:0
      // on the container — skip visibility check, use input[type=range] as selector
      const isSlider = role === "slider"
      if (!isSlider && !isStructurallyVisible(el)) continue

      const label = getLabel(el)
      const tag = el.tagName.toLowerCase()
      const type = (el as HTMLInputElement).type?.toLowerCase() || ""
      const href = (el as HTMLAnchorElement).href || ""
      const value = isSlider
        ? (el.getAttribute("aria-valuenow") ?? (el as HTMLInputElement).value ?? "")
        : ((el as HTMLInputElement).value || "")
      const placeholder = (el as HTMLInputElement).placeholder || ""
      const enabled = !(el as HTMLInputElement).disabled

      // Collect <select> options (invisible in DOM but readable)
      const options = tag === "select"
        ? Array.from(el.querySelectorAll("option"))
            .map(o => o.textContent?.trim() || "")
            .filter(Boolean)
            .slice(0, 10)  // max 10 options to keep token budget
            .join(", ")
        : ""

      // Dedup key includes innerText to differentiate same-label elements (e.g. product cards)
      const innerText = (el as HTMLElement).innerText?.trim().slice(0, 40) || ""
      const dedupKey = `${role}::${label}::${href}::${innerText}`
      const count = (seenCount.get(dedupKey) ?? 0) + 1
      seenCount.set(dedupKey, count)
      // BUG-12: allow up to 3 true duplicates (same role+label+innerText) — aligns with
      // collectElements cross-viewport dedup policy (§6.2). Disambiguate via index suffix
      // so LLM and executor can address each instance separately (e.g. toolbar "Add User"
      // vs form-submit "Add User"). innerText-differentiated elements still unique without
      // suffix.
      if (count > 3) continue
      const disambiguatedLabel = count > 1 ? `${label} (${count})` : label

      // Selector always uses raw aria-label (stable for Playwright).
      // For duplicates (count > 1), the role-based selector is ambiguous —
      // Playwright's role=button[name=X] matches by accessible name, which is
      // identical across siblings by definition. Force CSS fallback so the
      // executor resolves to the exact DOM element.
      const ariaLabelRaw = (el.getAttribute("aria-label") || "").trim()
      const safeAriaLabel = ariaLabelRaw.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
      const selectorRole = count > 1
        ? ""
        : (safeAriaLabel ? `role=${role}[name="${safeAriaLabel}"]` : `role=${role}`)
      // For sliders, use input[type=range] as CSS fallback (mat-slider wraps one)
      const selectorCSS = isSlider ? "input[type=range]" : buildCSSSelector(el)

      // Track selectorRole usage — if duplicated, mark for CSS fallback
      const roleCount = (seenRoleSelectors.get(selectorRole) ?? 0) + 1
      seenRoleSelectors.set(selectorRole, roleCount)

      elements.push({ tag, role, label: disambiguatedLabel, value, enabled, href, type, placeholder, options, selectorRole, selectorCSS })
    }

    // ---- Info elements (CAPTCHA, hints, contextual labels) ----
    const INTERACTIVE_TAGS = new Set(["input", "button", "a", "select", "textarea"])
    const INTERACTIVE_ROLES = new Set(["button", "link", "menuitem", "tab", "checkbox", "radio", "combobox", "option", "slider", "textbox"])
    const infoSeen = new Set<string>()

    // Build set of labels already captured as interactive elements (avoid duplicating slider labels etc.)
    const interactiveLabels = new Set(elements.map(e => e.label.toLowerCase()))

    for (const el of document.querySelectorAll<HTMLElement>("[aria-label]")) {
      const tag = el.tagName.toLowerCase()
      const role = (el.getAttribute("role") || "").toLowerCase()
      if (INTERACTIVE_TAGS.has(tag) || INTERACTIVE_ROLES.has(role)) continue
      if (!isStructurallyVisible(el)) continue
      const ariaLabel = el.getAttribute("aria-label")?.trim()
      if (!ariaLabel) continue
      // Skip if same label already captured as interactive element (e.g. slider child sharing parent's aria-label)
      if (interactiveLabels.has(ariaLabel.toLowerCase())) continue
      const text = el.innerText?.trim() || el.textContent?.trim() || ""
      if (!text || text.length > 150) continue
      const key = `info::${ariaLabel}`
      if (infoSeen.has(key)) continue
      infoSeen.add(key)

      elements.push({
        tag, role: "info", label: ariaLabel, value: text,
        enabled: false, href: "", type: "", placeholder: "", options: "",
        selectorRole: "", selectorCSS: "",
      })
    }

    // Replace ambiguous role selectors (duplicated) with CSS selectors
    for (const el of elements) {
      if (el.selectorRole && seenRoleSelectors.get(el.selectorRole)! > 1 && el.selectorCSS) {
        el.selectorRole = ""  // force CSS fallback in assignIds
      }
    }

    return elements
  })
}

/**
 * Assign sequential IDs (E1, E2, ...) and build RawElement array.
 * Picks the best available selector for each element.
 */
function assignIds(browserElements: BrowserElement[], startId: number): RawElement[] {
  return browserElements.map((el, i) => ({
    id: `E${startId + i}`,
    tag: el.tag,
    role: el.role,
    label: el.label,
    value: el.value,
    enabled: el.enabled,
    href: el.href,
    type: el.type,
    placeholder: el.placeholder,
    options: el.options,
    // Prefer role+name selector (unique); bare role without name is ambiguous — use CSS instead
    selector: el.selectorRole.includes("[name=") ? el.selectorRole : (el.selectorCSS || el.selectorRole),
  }))
}

// ============================================================
// Public API
// ============================================================

/**
 * Collect all structurally-visible interactive elements from the page DOM.
 *
 * Single-pass, viewport-agnostic: the scanner observes DOM structure, not
 * presentation. Visibility is DOM-level (display/visibility/opacity/aria-hidden);
 * viewport position is irrelevant. Playwright handles scroll-into-view at
 * action-time, so the executor resolves any element regardless of fold position.
 *
 * This avoids the pathologies of scroll-and-collect: duplicate emission across
 * viewports, per-viewport suffix inconsistency, budget waste on ghost copies,
 * and side effects from scroll (lazy-load triggers, IntersectionObserver).
 */
export async function collectElements(page: Page): Promise<RawElement[]> {
  const browserElements = await collectInteractiveElements(page)
  return assignIds(browserElements, 1).slice(0, MAX_ELEMENTS)
}

/**
 * Check if viewport center is blocked by an overlay/backdrop/modal.
 */
export async function isViewportCenterBlocked(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const cx = window.innerWidth / 2
    const cy = window.innerHeight / 2
    const el = document.elementFromPoint(cx, cy)
    if (!el) return false
    const tag = el.tagName.toLowerCase()
    const role = el.getAttribute("role") || ""
    const cls = el.className || ""
    const id = el.getAttribute("id") || ""
    // Check class or id for backdrop/overlay patterns
    if (/backdrop|overlay|cdk-overlay|modal-backdrop/i.test(String(cls))) return true
    if (/backdrop|overlay/i.test(id)) return true
    if (role === "dialog" || role === "alertdialog") return true
    if (tag === "mat-dialog-container") return true
    // Detect full-viewport semi-transparent overlay divs (inline style backdrop)
    const style = window.getComputedStyle(el)
    if (style.position === "fixed" && parseFloat(style.opacity) > 0) {
      const rect = el.getBoundingClientRect()
      if (rect.width >= window.innerWidth * 0.9 && rect.height >= window.innerHeight * 0.9) {
        const bg = style.backgroundColor
        if (bg && bg.startsWith("rgba") && !bg.endsWith(", 0)")) return true
      }
    }
    // Walk up ancestors: if center element is inside a modal/dialog container
    let ancestor: Element | null = el.parentElement
    while (ancestor && ancestor !== document.documentElement) {
      const aCls = typeof ancestor.className === "string" ? ancestor.className : ""
      const aId = ancestor.getAttribute("id") || ""
      const aRole = ancestor.getAttribute("role") || ""
      if (/modal|dialog|overlay|backdrop/i.test(aCls)) return true
      if (/modal|dialog|overlay|backdrop/i.test(aId)) return true
      if (aRole === "dialog" || aRole === "alertdialog") return true
      ancestor = ancestor.parentElement
    }
    // Scan for any visible full-viewport fixed overlay element (e.g. modal backdrop not at center)
    const candidates = document.querySelectorAll<HTMLElement>(
      '[class*="overlay"],[class*="backdrop"],[class*="modal"],[role="dialog"],[role="alertdialog"]'
    )
    for (const c of candidates) {
      const s = window.getComputedStyle(c)
      if (s.display === "none" || s.visibility === "hidden") continue
      if (parseFloat(s.opacity) === 0) continue
      const r = c.getBoundingClientRect()
      if (r.width >= window.innerWidth * 0.8 && r.height >= window.innerHeight * 0.8) return true
    }
    return false
  })
}

/**
 * Filter out links that point to already-visited pages or the current page.
 */
export function filterVisitedLinks(
  elements: RawElement[],
  currentUrl: string,
  visitedPages: Set<string>,
): RawElement[] {
  let currentPath: string
  try {
    const u = new URL(currentUrl)
    currentPath = u.pathname + u.hash
  } catch {
    currentPath = currentUrl
  }

  return elements.filter((el) => {
    if (el.role !== "link" || !el.href) return true // keep non-links
    try {
      const u = new URL(el.href)
      const path = u.pathname + u.hash
      // Skip self-referential links
      if (path === currentPath) return false
      // Skip already-visited pages (normalize to match how URLs are stored)
      if (visitedPages.has(el.href) || visitedPages.has(normalizeUrl(el.href))) return false
      return true
    } catch {
      return true
    }
  })
}
