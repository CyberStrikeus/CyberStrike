import type { Page } from "playwright"
import { Log } from "./log.ts"
import type { RawElement } from "./types.ts"
import { normalizeUrl } from "./state.ts"

const log = Log.create({ service: "hackbrowser:scanner" })

// ============================================================
// Constants
// ============================================================

const MAX_ELEMENTS = 50

// Representatives kept per templated (numbered) label cluster — mirrors the URL
// BFS policy (MAX_PER_PATH_PATTERN) and the action-dedup in agent.ts: a long
// list of "Item 1..55" is one endpoint template, so a handful of representatives
// covers the attack surface (IDOR across instances) without letting the list eat
// the MAX_ELEMENTS budget and crowd out unique, security-critical controls.
const MAX_PER_TEMPLATE = 5

// revealLazyContent scroll bounds. MAX_STEPS caps an infinite-scroll page so the
// reveal can't trap the crawler; STEP_WAIT lets lazy renders / IntersectionObserver
// callbacks fire between viewport-sized steps.
const REVEAL_MAX_STEPS = 10
const REVEAL_STEP_WAIT = 250

// Max disclosures expanded per page in expandDisclosures — bounds pages built from
// long lists of collapsibles so the reveal stays cheap and predictable.
const EXPAND_MAX = 20

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
  options: string // comma-separated option values for <select>
  constraints: string // HTML5 validation meta (min/max/step/maxlength/pattern/type)
  selectorRole: string // role=button[name="..."]
  selectorCSS: string // fallback CSS selector
  inChrome: boolean // inside a site-chrome landmark (nav/header/footer/aside)
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
    // Framework click bindings — strong, unambiguous interactivity signals used by
    // non-SPA / server-rendered stacks (Laravel/Livewire, htmx, Alpine, AngularJS,
    // Bootstrap, Rails UJS) on otherwise-plain div/span/a elements that have no
    // role, no onclick and often no cursor:pointer. Zero false-positive risk — these
    // attributes only ever mark interactive elements.
    const FRAMEWORK_CLICK_ATTRS = [
      "wire:click",
      "hx-get",
      "hx-post",
      "hx-put",
      "hx-patch",
      "hx-delete",
      "ng-click",
      "x-on:click",
      "@click",
      "data-toggle",
      "data-bs-toggle",
      // data-* prefixed variants (htmx and AngularJS both accept them for
      // HTML-validator-friendly markup).
      "data-hx-get",
      "data-hx-post",
      "data-hx-put",
      "data-hx-patch",
      "data-hx-delete",
      "data-ng-click",
    ]

    // ---- isStructurallyVisible: DOM-level visibility (not viewport) ----
    function isStructurallyVisible(el: Element): boolean {
      const rect = el.getBoundingClientRect()
      // Zero-size elements (display:none collapsed, a11y-hidden off-screen tricks)
      if (rect.width === 0 && rect.height === 0) return false
      const style = window.getComputedStyle(el)
      if (style.display === "none") return false
      if (style.visibility === "hidden") return false
      // Native form controls are routinely opacity:0 by design — Material Web, MUI,
      // Ant, Chakra hide the real input/checkbox/radio behind a styled visual, yet
      // the control is real and interactable (and Playwright can act on it). Keep
      // excluding opacity:0 for everything else (transition/decorative artifacts).
      const tag = el.tagName.toLowerCase()
      const isFormControl = tag === "input" || tag === "select" || tag === "textarea"
      if (parseFloat(style.opacity) === 0 && !isFormControl) return false
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
      // Submit/button/image inputs: the visible label is the value (or alt for an
      // image button) — NOT the field name, which is server-control noise like
      // "ctl00$btnSave" on ASP.NET WebForms. Only for these types — a text input's
      // value is user data, not a label.
      if (el.tagName.toLowerCase() === "input") {
        const itype = (el as HTMLInputElement).type?.toLowerCase()
        if (itype === "image") {
          const alt = el.getAttribute("alt")?.trim()
          if (alt) return alt
        }
        if (itype === "submit" || itype === "button" || itype === "image") {
          const val = (el as HTMLInputElement).value?.trim()
          if (val) return val
        }
      }
      // Web-component slotted-label fallback: a control inside an open shadow root
      // (Shoelace, Material Web, Ionic, Fast — i.e. most real design systems) gets
      // its visible text slotted from light DOM, so the shadow node's own innerText
      // is empty. The shadow HOST carries the accessible label. Without this, real
      // web-component buttons are collected but unlabeled — useless to the LLM.
      const root = el.getRootNode()
      if (root instanceof ShadowRoot && root.host) {
        const host = root.host as HTMLElement
        const hostAria = host.getAttribute("aria-label")?.trim()
        if (hostAria) return hostAria
        // WC form fields expose their label via a `label` attr/prop (sl-input,
        // md-outlined-text-field, etc.) rather than slotted text.
        const hostLabelAttr = host.getAttribute("label")?.trim()
        if (hostLabelAttr) return hostLabelAttr
        const hostText = host.innerText?.trim()
        if (hostText && hostText.length < 80) return hostText
      }
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
      if (tag === "summary") return "button" // <details> disclosure toggle — a real control
      if (tag === "a" && el.getAttribute("href")) return "link"
      if (tag === "input") {
        if (type === "submit" || type === "button" || type === "image") return "button"
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
      // Framework click bindings (Livewire/htmx/Alpine/AngularJS/Bootstrap/Rails UJS)
      // on otherwise-plain elements — unambiguous interactivity signal.
      for (const a of FRAMEWORK_CLICK_ATTRS) if (el.hasAttribute(a)) return "button"
      return ""
    }

    // Framework-generated ids (React useId `:r21:`, Radix, MUI) look like stable
    // `id` selectors but regenerate on every render/remount — a captured
    // `button#:r21:` is detached by click time → "click: Timeout exceeded". Reject
    // them so the selector falls through to a render-stable one (name/class/nth, or
    // the role + accessible-name selector built upstream).
    function isEphemeralId(id: string): boolean {
      // React/MUI/Radix `useId` ids are colon-WRAPPED (`:r21:`, `:R2lH1:`) or embed a
      // `:r…:` token. Authored ids never lead with a colon — so JSF/PrimeFaces ids
      // with a MID colon (`form:saveBtn`) are kept, only the framework-id shape is rejected.
      if (/^:/.test(id) || /:r[0-9a-z]+:/i.test(id)) return true
      // Known generated-id prefixes (older MUI numeric ids, component-lib auto ids).
      return /^(mui-\d|radix-|headlessui-|react-aria-|rc-_?\d|ember\d)/i.test(id)
    }

    function buildCSSSelectorCandidate(el: Element): string {
      const tag = el.tagName.toLowerCase()
      const id = el.getAttribute("id")
      if (id && !isEphemeralId(id)) return `${tag}#${CSS.escape(id)}`
      const name = el.getAttribute("name")
      if (name) return `${tag}[name="${CSS.escape(name)}"]`

      // Helper: find nearest identifiable ancestor for selector context
      function ancestorPrefix(el: Element): string {
        let current = el.parentElement
        while (current && current !== document.documentElement) {
          const aTag = current.tagName.toLowerCase()
          const aId = current.getAttribute("id")
          if (aId && !isEphemeralId(aId)) return `${aTag}#${CSS.escape(aId)} `
          const aCls =
            typeof current.className === "string"
              ? current.className
                  .trim()
                  .split(/\s+/)
                  .filter((c) => c.length > 2)[0]
              : undefined
          if (aCls) return `${aTag}.${CSS.escape(aCls)} `
          current = current.parentElement
        }
        return ""
      }

      // class-based selector with parent context
      const cls = el.className
      if (typeof cls === "string" && cls.trim()) {
        const classes = cls
          .trim()
          .split(/\s+/)
          .filter((c) => c.length > 2)
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

    // Guaranteed-unique positional path from a stable-id ancestor (or the root)
    // down to `el`, adding :nth-of-type only where same-tag siblings exist. Pure
    // CSS (querySelector- and Playwright-compatible), used only when the short
    // candidate is ambiguous.
    function uniquePositionalPath(el: Element): string {
      const segs: string[] = []
      let cur: Element | null = el
      while (cur && cur !== document.documentElement) {
        const tag = cur.tagName.toLowerCase()
        const id = cur.getAttribute("id")
        if (id && !isEphemeralId(id)) {
          segs.unshift(`${tag}#${CSS.escape(id)}`)
          break // an id anchors the path — everything below it is already unique
        }
        const parent: Element | null = cur.parentElement
        if (!parent) {
          segs.unshift(tag)
          break
        }
        const sameTag = Array.from(parent.children).filter((c) => c.tagName === cur!.tagName)
        segs.unshift(sameTag.length > 1 ? `${tag}:nth-of-type(${sameTag.indexOf(cur) + 1})` : tag)
        cur = parent
      }
      return segs.join(" > ")
    }

    // A selector must identify EXACTLY ONE element: page.click / querySelector on
    // an ambiguous selector silently hits the first match, so N distinct sibling
    // controls (toolbar buttons, table-row actions, menu items) that share a short
    // selector collapse to one — only the first is ever clicked, and dedup keyed on
    // the selector drops the rest. Verify uniqueness; fall back to a positional path.
    function buildCSSSelector(el: Element): string {
      const candidate = buildCSSSelectorCandidate(el)
      try {
        if (document.querySelectorAll(candidate).length === 1) return candidate
      } catch {
        // Malformed candidate (unescaped exotic chars) — fall through to the path.
      }
      return uniquePositionalPath(el)
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
      "summary", // <details> disclosure toggle
      // Framework click bindings (escaped — names contain : and @).
      ...FRAMEWORK_CLICK_ATTRS.map((a) => `[${CSS.escape(a)}]`),
    ].join(", ")

    // Deep query that pierces OPEN shadow roots — web-component SPAs (Lit/Stencil/
    // LWC etc.) put their real buttons/inputs inside shadow DOM, which a flat
    // document.querySelectorAll cannot see. We walk every element's open
    // shadowRoot recursively. CLOSED roots return null and stay unreachable (a
    // hard browser limit) — including the CyberStrike panel's own closed root, so
    // the LLM never sees its own UI. We also skip any data-cyberstrike-ui host
    // defensively. Document order is preserved per root; shadow matches append
    // after their host's light-DOM siblings.
    function queryAllDeep(selector: string): Element[] {
      const out: Element[] = []
      const walk = (root: Document | ShadowRoot) => {
        for (const el of root.querySelectorAll(selector)) out.push(el)
        for (const host of root.querySelectorAll("*")) {
          if (host.closest("[data-cyberstrike-ui]")) continue
          const sr = (host as HTMLElement).shadowRoot
          if (sr) walk(sr)
        }
      }
      walk(document)
      return out
    }

    // Serialize HTML5 validation attributes into a compact string the LLM can
    // interpret. Empty return = no constraints (saves tokens). Only meaningful
    // attributes emitted — range types get min/max/step, text/textarea get
    // maxlength, email/url/tel emit type hint, pattern forwarded when present.
    function serializeConstraints(el: Element, type: string): string {
      const tag = el.tagName.toLowerCase()
      if (tag !== "input" && tag !== "textarea") return ""
      const parts: string[] = []
      const getAttr = (name: string) => el.getAttribute(name)?.trim() ?? ""

      const min = getAttr("min")
      const max = getAttr("max")
      const step = getAttr("step")
      const maxlength = getAttr("maxlength")
      const minlength = getAttr("minlength")
      const pattern = getAttr("pattern")

      const isNumericRange = type === "range" || type === "number"
      const isDateTime =
        type === "date" || type === "time" || type === "datetime-local" || type === "month" || type === "week"

      if (isNumericRange || isDateTime) {
        if (min) parts.push(`min:${min}`)
        if (max) parts.push(`max:${max}`)
        if (isNumericRange && step && step !== "any") parts.push(`step:${step}`)
      }
      if ((tag === "textarea" || ["text", "email", "url", "tel", "password", "search"].includes(type)) && maxlength) {
        parts.push(`maxlength:${maxlength}`)
      }
      if (minlength) parts.push(`minlength:${minlength}`)
      if (pattern) parts.push(`pattern:${pattern}`)
      // Semantic type hint — lets LLM pick format-correct values for email/url/tel
      if (["email", "url", "tel"].includes(type)) parts.push(`type:${type}`)

      return parts.join(" ")
    }

    const elements: BrowserElement[] = []
    const seenCount = new Map<string, number>()
    const seenRoleSelectors = new Map<string, number>()

    // Build a BrowserElement from a DOM node with a known role — dedup,
    // disambiguation and selector resolution. Shared by the interactive sweep and
    // the heuristic clickable-container sweep so both stay consistent (DRY). The
    // caller is responsible for the visibility check (the slider exception lives
    // there). `syntheticRole` = the role is assigned by heuristic, not the
    // element's real ARIA role (a plain clickable div) — force the CSS selector
    // since Playwright's role=button engine would never resolve such a node.
    function addElement(el: Element, role: string, syntheticRole = false): void {
      const label = getLabel(el)
      const tag = el.tagName.toLowerCase()
      const type = (el as HTMLInputElement).type?.toLowerCase() || ""
      const href = (el as HTMLAnchorElement).href || ""
      const isSlider = role === "slider"
      const value = isSlider
        ? (el.getAttribute("aria-valuenow") ?? (el as HTMLInputElement).value ?? "")
        : (el as HTMLInputElement).value || ""
      const placeholder = (el as HTMLInputElement).placeholder || ""
      const enabled = !(el as HTMLInputElement).disabled

      // Collect <select> options (invisible in DOM but readable)
      const options =
        tag === "select"
          ? Array.from(el.querySelectorAll("option"))
              .map((o) => o.textContent?.trim() || "")
              .filter(Boolean)
              .slice(0, 10) // max 10 options to keep token budget
              .join(", ")
          : ""

      // HTML5 validation constraints for the LLM to honor
      const constraints = serializeConstraints(el, type)

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
      if (count > 3) return
      const disambiguatedLabel = count > 1 ? `${label} (${count})` : label

      // Selector always uses raw aria-label (stable for Playwright).
      // For duplicates (count > 1), the role-based selector is ambiguous —
      // Playwright's role=button[name=X] matches by accessible name, which is
      // identical across siblings by definition. Force CSS fallback so the
      // executor resolves to the exact DOM element.
      const ariaLabelRaw = (el.getAttribute("aria-label") || "").trim()
      const safeAriaLabel = ariaLabelRaw.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
      // A file input has no matching accessibility role — the scanner classifies it
      // as "textbox", but Playwright's role=textbox engine resolves to NOTHING (file
      // inputs are not textboxes), so a role selector would make setInputFiles time
      // out. Force the CSS selector, which resolves to the real <input type=file>.
      const isFileInput = el.matches("input[type=file]")
      const selectorRole =
        syntheticRole || count > 1 || isFileInput
          ? ""
          : safeAriaLabel
            ? `role=${role}[name="${safeAriaLabel}"]`
            : `role=${role}`
      const selectorCSS = buildCSSSelector(el)

      // Site-chrome detection: actions inside navigation/banner/footer/aside
      // landmarks (navbar Logout/Profile etc.) change site-wide after login and
      // must NOT flip a page's re-discovery fingerprint. Semantic landmarks only —
      // class-based guessing would wrongly exclude real content toolbars.
      const inChrome = !!el.closest(
        "nav, header, footer, aside, [role=navigation], [role=banner], [role=contentinfo], [role=complementary]",
      )

      // Track selectorRole usage — if duplicated, mark for CSS fallback
      const roleCount = (seenRoleSelectors.get(selectorRole) ?? 0) + 1
      seenRoleSelectors.set(selectorRole, roleCount)

      elements.push({
        tag,
        role,
        label: disambiguatedLabel,
        value,
        enabled,
        href,
        type,
        placeholder,
        options,
        constraints,
        selectorRole,
        selectorCSS,
        inChrome,
      })
    }

    // ---- Interactive sweep: native controls + ARIA roles + inline onclick ----
    for (const el of queryAllDeep(INTERACTIVE_SELECTORS)) {
      // Skip anything inside the injected CyberStrike telemetry panel — LLM
      // must never see its own UI. Shadow DOM normally hides it, but this is
      // a defensive guard for any panel DOM that leaks into the light tree.
      if (el.closest("[data-cyberstrike-ui]")) continue
      const role = getRole(el)
      if (!role) continue

      // Sliders (mat-slider, [role=slider]) often have pointer-events:none or opacity:0
      // on the container — skip visibility check, use input[type=range] as selector
      const isSlider = role === "slider"
      if (!isSlider && !isStructurallyVisible(el)) continue

      addElement(el, role)
    }

    // ---- Heuristic clickable containers (Case 2) ----
    // div/span/li wired up via addEventListener with NO role and NO inline onclick
    // — common in React/Vue, where onClick is event-delegated at the root and so
    // leaves no detectable attribute. Click listeners are NOT introspectable from
    // page JS (getEventListeners is devtools-only), so we fall back to
    // cursor:pointer (author intent) bounded by guards that suppress decorative
    // false positives. Cheap guards run before the costly getComputedStyle. The
    // truly bare clickable div (no cursor, no role, no tabindex) stays
    // undetectable — an accepted hard limit.
    for (const el of queryAllDeep("div, span, li")) {
      if (el.closest("[data-cyberstrike-ui]")) continue
      if (el.getAttribute("role")) continue // explicit role → handled by the sweep above
      if (el.hasAttribute("onclick")) continue // inline onclick → handled by the sweep above
      if (!isStructurallyVisible(el)) continue
      const text = (el as HTMLElement).innerText?.trim() || ""
      if (!text || text.length > 80) continue // no/over-long label → not a button
      if (el.querySelector(INTERACTIVE_SELECTORS)) continue // wraps a real control → click the inner one
      if (window.getComputedStyle(el).cursor !== "pointer") continue // the intent signal (costly — last)
      // cursor is inherited: every child of a clickable region reports pointer too.
      // Capture only the OUTERMOST element of a pointer chain (parent not pointer)
      // so a clickable card yields one button, not one per descendant span.
      const parent = el.parentElement
      if (parent && window.getComputedStyle(parent).cursor === "pointer") continue
      const rect = el.getBoundingClientRect() // near-viewport container → layout, not a button
      if (rect.width >= window.innerWidth * 0.9 && rect.height >= window.innerHeight * 0.5) continue
      addElement(el, "button", true)
    }

    // ---- Info elements (CAPTCHA, hints, contextual labels) ----
    const INTERACTIVE_TAGS = new Set(["input", "button", "a", "select", "textarea"])
    const INTERACTIVE_ROLES = new Set([
      "button",
      "link",
      "menuitem",
      "tab",
      "checkbox",
      "radio",
      "combobox",
      "option",
      "slider",
      "textbox",
    ])
    const infoSeen = new Set<string>()

    // Build set of labels already captured as interactive elements (avoid duplicating slider labels etc.)
    const interactiveLabels = new Set(elements.map((e) => e.label.toLowerCase()))

    for (const el of document.querySelectorAll<HTMLElement>("[aria-label]")) {
      if (el.closest("[data-cyberstrike-ui]")) continue // defensive: never leak panel UI into info elements
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
        tag,
        role: "info",
        label: ariaLabel,
        value: text,
        enabled: false,
        href: "",
        type: "",
        placeholder: "",
        options: "",
        constraints: "",
        selectorRole: "",
        selectorCSS: "",
        inChrome: false, // info elements are never actions — excluded from the fingerprint regardless
      })
    }

    // Replace ambiguous role selectors (duplicated) with CSS selectors
    for (const el of elements) {
      if (el.selectorRole && seenRoleSelectors.get(el.selectorRole)! > 1 && el.selectorCSS) {
        el.selectorRole = "" // force CSS fallback in assignIds
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
    constraints: el.constraints,
    // Prefer role+name selector (unique); bare role without name is ambiguous — use CSS instead
    selector: el.selectorRole.includes("[name=") ? el.selectorRole : el.selectorCSS || el.selectorRole,
    inChrome: el.inChrome,
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
  const sampled = capElements(sampleTemplates(browserElements))
  return assignIds(sampled, 1)
}

// Action-priority element cap. A plain first-N-in-DOM-order cut drops whatever sits
// LAST — and on a large form/modal that is the FOOTER, where the primary submit
// (Kaydet/Save/Submit) and Cancel live. Losing an input costs one field; losing the
// submit breaks the whole form (the planner then mis-picks a header close-X as submit).
// So keep the interactive ACTIONS (button/link/menuitem/tab) preferentially and fill
// the remaining budget with the other controls in DOM order, then restore DOM order.
const ACTION_ROLES_CAP = new Set(["button", "link", "menuitem", "tab"])
function capElements<T extends { role: string }>(els: T[]): T[] {
  if (els.length <= MAX_ELEMENTS) return els
  const actions = els.filter((e) => ACTION_ROLES_CAP.has(e.role))
  const rest = els.filter((e) => !ACTION_ROLES_CAP.has(e.role))
  const kept = new Set([...actions, ...rest].slice(0, MAX_ELEMENTS))
  return els.filter((e) => kept.has(e)) // preserve original DOM order
}

/**
 * Collapse templated (numbered) sibling clusters to a handful of representatives
 * BEFORE the MAX_ELEMENTS cap, so a long "Item 1..55" list cannot crowd out
 * unique, security-critical controls that sit later in the DOM.
 *
 * Clustering is digit-masked: "Item 1"/"Item 2" → "Item #" cluster, but a label
 * with NO digits ("Delete Account", "Delete User") masks to itself and stays a
 * singleton — so distinct controls are never merged. Exact duplicates are already
 * bounded upstream (seenCount > 3 in the collector). Order is preserved; the
 * first MAX_PER_TEMPLATE of each numbered cluster survive (IDOR-across-instances
 * coverage), the rest drop.
 */
function sampleTemplates(elements: BrowserElement[]): BrowserElement[] {
  const clusterCount = new Map<string, number>()
  const out: BrowserElement[] = []
  for (const el of elements) {
    const masked = el.label.replace(/\d+/g, "#")
    if (masked === el.label) {
      out.push(el) // no digits → unique control, never clustered
      continue
    }
    const key = `${el.role}::${masked}`
    const n = (clusterCount.get(key) ?? 0) + 1
    clusterCount.set(key, n)
    if (n <= MAX_PER_TEMPLATE) out.push(el)
  }
  return out
}

/**
 * Reveal lazily-rendered content before collection. Some apps only render
 * below-the-fold sections once scrolled near (IntersectionObserver, react-lazyload,
 * content-visibility:auto), so a non-scrolling scan misses unique sections lower on
 * the page. We step down ~one viewport at a time to trip those observers, then
 * return to the top. BOUNDED by REVEAL_MAX_STEPS so an infinite-scroll page cannot
 * trap us; the duplicate rows scrolling materializes are collapsed by template
 * sampling. Deterministic, no LLM — a sibling of dismissCookieBanner that keeps
 * collectElements itself a pure, scroll-free DOM observer. Mid-scroll navigation or
 * a destroyed context is non-fatal: collection proceeds on whatever rendered.
 */
export async function revealLazyContent(page: Page): Promise<void> {
  try {
    for (let i = 0; i < REVEAL_MAX_STEPS; i++) {
      const advanced = await page.evaluate(() => {
        const before = window.scrollY
        window.scrollBy(0, Math.round(window.innerHeight * 0.9))
        return window.scrollY > before
      })
      await page.waitForTimeout(REVEAL_STEP_WAIT)
      if (!advanced) break // reached the bottom — no further scroll possible
    }
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.waitForTimeout(REVEAL_STEP_WAIT)
  } catch {
    // page navigated/closed mid-scroll — non-fatal
  }
}

/**
 * Expand interaction-gated disclosures before collection so the hidden actions
 * behind accordions and <details> become real attack surface in the snapshot —
 * without spending LLM turns on them. SAFE SUBSET ONLY, by ARIA semantics:
 *   - Tier 1: native <details> → set `open` (no click, zero side effect).
 *   - Tier 2: [aria-expanded="false"] → click (the standardized disclosure
 *     contract — reveals a controlled region, does not mutate server state).
 * Tabs (role=tab) are excluded: selecting one mutates active-panel state, so they
 * stay with the LLM, which navigates them in context. Mutating actions (Delete,
 * submit) have no disclosure semantics and are never touched. BOUNDED by
 * EXPAND_MAX against pages built from long collapsible lists. A sibling of
 * revealLazyContent — collectElements stays a pure DOM observer. Non-fatal on
 * mid-expand navigation.
 */
export async function expandDisclosures(page: Page): Promise<void> {
  try {
    await page.evaluate((max: number) => {
      let budget = max
      // Tier 1 — native <details>: reveal via attribute, no event dispatch.
      for (const d of Array.from(document.querySelectorAll("details:not([open])"))) {
        if (budget <= 0) break
        if (d.closest("[data-cyberstrike-ui]")) continue
        ;(d as HTMLDetailsElement).open = true
        budget--
      }
      // Tier 2 — ARIA disclosures: click controls that semantically reveal a region.
      for (const c of Array.from(document.querySelectorAll('[aria-expanded="false"]'))) {
        if (budget <= 0) break
        if (c.closest("[data-cyberstrike-ui]")) continue
        if (c.getAttribute("role") === "tab") continue // tabs mutate state → left to the LLM
        // A real disclosure reveals INLINE content; an `aria-haspopup` control instead
        // opens a FLOATING overlay (menu/listbox/dialog) whose backdrop intercepts all
        // subsequent clicks — auto-triggering it (e.g. a nav/account/language menu) freezes
        // the whole page. Leave popup triggers to the LLM; only expand true disclosures.
        if (c.hasAttribute("aria-haspopup") && c.getAttribute("aria-haspopup") !== "false") continue
        ;(c as HTMLElement).click()
        budget--
      }
    }, EXPAND_MAX)
    await page.waitForTimeout(REVEAL_STEP_WAIT)
  } catch {
    // page navigated/closed mid-expand — non-fatal
  }
}

/**
 * Check if viewport center is blocked by an overlay/backdrop/modal.
 *
 * Returns `false` if the page's JS execution context has been destroyed by an
 * in-flight navigation — a new document will not be serving the same overlay.
 * Other evaluate errors (CSP blocks, in-page exceptions) still propagate so
 * genuine bugs stay visible.
 */
export async function isViewportCenterBlocked(page: Page): Promise<boolean> {
  try {
    return await evalIsViewportCenterBlocked(page)
  } catch (err: unknown) {
    const msg = String((err as Error)?.message ?? err)
    if (msg.includes("Execution context was destroyed") || msg.includes("Target closed")) {
      return false
    }
    throw err
  }
}

function evalIsViewportCenterBlocked(page: Page): Promise<boolean> {
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
      '[class*="overlay"],[class*="backdrop"],[class*="modal"],[role="dialog"],[role="alertdialog"]',
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

// ============================================================
// Per-target click-point occlusion probe (reactive, structural)
//
// Answers ONE question for ONE target: at the point Playwright would click
// (the element's bounding-box center), is the topmost element the target
// itself, something in its own DOM lineage (ancestor/descendant — the click
// still lands or retargets), or an UNRELATED element covering it?
//
// Reactive + SAFE-DEFAULT by design (see occlusion-fix-design): only reports
// "occluded" when confident an unrelated light-DOM element is on top. When the
// hit-test is ambiguous — shadow-DOM host, iframe, cross-root — it returns
// "clickable" so the normal click path (which Playwright resolves correctly for
// those cases) runs unchanged. This keeps the probe from inventing occlusion on
// tech it cannot hit-test cleanly: a false positive can never originate there.
// ============================================================

export interface OccluderInfo {
  tag: string
  role: string
  /** Short visible-text snippet — lets the LLM relate the occluder to its own dismiss controls. */
  text: string
}

export type ClickPointProbe =
  | { status: "clickable" }
  | { status: "offscreen" }
  | { status: "occluded"; occluder: OccluderInfo }

export async function probeClickPoint(page: Page, selector: string): Promise<ClickPointProbe> {
  try {
    return await page.evaluate((sel) => {
      const el = document.querySelector(sel) as HTMLElement | null
      // Not found / degenerate box → let the normal path handle it (safe default).
      if (!el) return { status: "clickable" as const }
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) return { status: "clickable" as const }
      const cx = r.left + r.width / 2
      const cy = r.top + r.height / 2
      // Click point outside the viewport → not an overlay, needs a scroll.
      if (cx < 0 || cy < 0 || cx > window.innerWidth || cy > window.innerHeight) {
        return { status: "offscreen" as const }
      }
      const top = document.elementFromPoint(cx, cy) as HTMLElement | null
      if (!top) return { status: "offscreen" as const }

      // Same element, or normal DOM lineage (a wrapper the click retargets to,
      // e.g. a pointer-events:none child inside its interactive parent) → fine.
      if (top === el || el.contains(top) || top.contains(el)) return { status: "clickable" as const }

      // SAFE-DEFAULT for tech we cannot hit-test across cleanly:
      //  - iframe: elementFromPoint returns the frame, not the in-frame target.
      //  - shadow DOM: contains() does not pierce shadow roots, so an element
      //    inside `top`'s shadow tree looks "unrelated". Walk el's shadow-host
      //    chain; if `top` hosts (or contains the host of) el, it is the same subtree.
      if (top.tagName === "IFRAME") return { status: "clickable" as const }
      let node: Node | null = el
      while (node) {
        const root = node.getRootNode()
        if (root instanceof ShadowRoot) {
          const host = root.host as HTMLElement
          if (host === top || top.contains(host)) return { status: "clickable" as const }
          node = host
        } else break
      }

      // Confident: an unrelated light-DOM element is on top of the target.
      const text = (top.innerText || top.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ").slice(0, 80)
      return {
        status: "occluded" as const,
        occluder: { tag: top.tagName.toLowerCase(), role: top.getAttribute("role") || "", text },
      }
    }, selector)
  } catch {
    // A probe is a best-effort occlusion HINT — it must NEVER crash the crawl.
    // Any failure to resolve/hit-test the target degrades to the "clickable" safe
    // default (proceed via the normal path), mirroring the shadow/iframe handling
    // above. Two known-benign causes:
    //  - in-flight navigation destroyed the context (page no longer exists);
    //  - a non-CSS Playwright engine selector (role=…/text=…) reached
    //    document.querySelector, which only parses CSS → "not a valid selector"
    //    SyntaxError. Such selectors are valid for page.click but cannot be
    //    hit-tested here, so we skip the probe rather than kill the whole crawl.
    return { status: "clickable" }
  }
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
