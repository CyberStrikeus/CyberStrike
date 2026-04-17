import type { RawElement, GlobalState, PageState, ActionRecord, ActionResult, DeferredAuthPage } from "./types.ts"

// ============================================================
// Constants
// ============================================================

const MAX_ACTIONS_IN_PROMPT = 10
const MAX_FAILED_ELEMENTS = 20

// ============================================================
// State factories
// ============================================================

export function createGlobalState(): GlobalState {
  return {
    visitedPages: new Set(),
    capturedEndpoints: new Set(),
    pageFingerprints: new Map(),
    authPhase: "anonymous",
    totalSteps: 0,
    pageQueue: [],
    deferredAuthPages: [],
    pendingReDiscovery: false,
    pathPatternCounts: new Map(),
  }
}

// ============================================================
// Auth URL classification — Phase-Based Exploration (Aşama 7)
// ============================================================

const AUTH_PATTERNS: { type: DeferredAuthPage["type"]; pattern: RegExp }[] = [
  { type: "register", pattern: /\/(register|signup|sign-up|create-account|join)/i },
  { type: "login",    pattern: /\/(login|signin|sign-in|authenticate|auth\/login)/i },
  { type: "logout",   pattern: /\/(logout|signout|sign-out|auth\/logout)/i },
]

/**
 * Classify a URL as an auth page (register/login/logout) or null if not auth-related.
 * Uses pathname-based heuristics — works across real-world apps.
 */
export function classifyAuthUrl(url: string): DeferredAuthPage["type"] | null {
  try {
    const u = new URL(url)
    const path = u.pathname + u.hash
    for (const { type, pattern } of AUTH_PATTERNS) {
      if (pattern.test(path)) return type
    }
  } catch {}
  return null
}

/**
 * Generate a structural fingerprint from page elements.
 * Only includes INPUT roles — form fields that matter for security testing.
 * Buttons, links, info elements excluded — they change site-wide (navbar/toolbar)
 * and cause false positives during post-login re-discovery.
 * Sorted for deterministic comparison.
 */
export const INPUT_ROLES = new Set(["textbox", "combobox", "checkbox", "radio", "slider"])

export function generateFingerprint(elements: RawElement[]): string {
  return elements
    .filter((e) => INPUT_ROLES.has(e.role))
    .map((e) => `${e.role}:${e.label}:${e.type}:${e.enabled}`)
    .sort()
    .join("|")
}

// ============================================================
// Full Fingerprint — Multi-Credential Element Diff (Aşama 12)
// ============================================================

/**
 * Generate a full structural fingerprint for page CONTENT elements.
 * Used for multi-credential comparison (admin vs user element diff).
 *
 * Unlike generateFingerprint (input-only, for re-discovery), this includes buttons
 * and all interactive roles — button differences are critical for privilege escalation.
 *
 * Excludes: link role — navigation links are handled by BFS discovery and differ
 * per role due to sidebar/navbar. Including them would make "same fingerprint"
 * optimization useless since sidebar always differs between roles.
 * Includes: role, label, type, enabled, options, placeholder.
 * Excludes: value (user-specific data, false positives), href (only links have it),
 *           link role (sidebar/navbar, handled by BFS),
 *           info role (contextual/informational, not actionable — doesn't change
 *           what actions LLM plans, only provides context for value decisions.
 *           Structural containers like <nav aria-label>, <section aria-label> are
 *           collected as info and vary per role due to different content, causing
 *           false fingerprint mismatches. page-diff still includes info elements.)
 */
export function generateFullFingerprint(elements: RawElement[]): string {
  return elements
    .filter((e) => e.label && e.role !== "link" && e.role !== "info")
    .map((e) => [
      e.role,
      e.label,
      e.type,
      e.enabled,
      e.options || "",
      e.placeholder || "",
    ].join(":"))
    .sort()
    .join("|")
}

/**
 * Compute element availability across N contexts.
 * Returns a map: semantic key → list of context IDs that have this element.
 *
 * Example output:
 *   "button::Delete User" → ["admin"]
 *   "button::Edit"        → ["admin", "manager", "editor"]
 *   "textbox::Search"     → ["admin", "manager", "editor", "user", "viewer"]
 */
export function computeElementAvailability(
  elementsByContext: Map<string, RawElement[]>,
): Map<string, string[]> {
  const availability = new Map<string, string[]>()
  for (const [ctxId, elements] of elementsByContext) {
    for (const el of elements) {
      const key = `${el.role}::${el.label}`
      if (!availability.has(key)) availability.set(key, [])
      availability.get(key)!.push(ctxId)
    }
  }
  return availability
}

/**
 * Convert element availability map to a serializable record for CyberStrike page-diff.
 * Keys: "role:label" (single colon for readability), values: context ID arrays.
 */
export function availabilityToRecord(
  availability: Map<string, string[]>,
): Record<string, string[]> {
  const record: Record<string, string[]> = {}
  for (const [key, contexts] of availability) {
    // Convert "role::label" to "role:label" for readability
    record[key.replace("::", ":")] = contexts
  }
  return record
}

export function createPageState(url: string): PageState {
  return {
    currentUrl: url,
    elements: [],
    viewportCenterBlocked: false,
    actionsThisPage: [],
    failedElementIds: new Set(),
    lastActionResult: null,
    step: 0,
  }
}

// ============================================================
// State mutations
// ============================================================

export function recordAction(
  pageState: PageState,
  elementId: string,
  action: string,
  value: string | undefined,
  result: ActionResult,
): void {
  const record: ActionRecord = {
    elementId,
    action,
    value,
    success: result.success,
    httpSideEffects: result.httpRequests,
  }
  pageState.actionsThisPage.push(record)

  if (!result.success) {
    pageState.failedElementIds.add(elementId)
  }

  pageState.lastActionResult = result
  pageState.step++
}

// ============================================================
// URL normalization
// ============================================================

export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url)
    u.searchParams.sort()
    let path = u.pathname.replace(/\/+$/, "") || "/"
    // Normalize hash path: #recycle → #/recycle (SPA routing consistency)
    let hash = u.hash
    if (hash && hash !== "#" && !hash.startsWith("#/")) {
      hash = "#/" + hash.slice(1)
    }
    return u.origin + path + u.search + hash
  } catch {
    return url
  }
}

// ============================================================
// Prompt builder — structured JSON for LLM
// ============================================================

/** Sliding window: first 3 + last 7 actions (preserves context + recent memory) */
function getActionsForPrompt(actions: ActionRecord[]): ActionRecord[] {
  if (actions.length <= MAX_ACTIONS_IN_PROMPT) return actions
  return [...actions.slice(0, 3), ...actions.slice(-7)]
}

/** Element format for LLM — excludes selector (system-internal) */
interface PromptElement {
  id: string
  role: string
  label: string
  type?: string
  value?: string
  placeholder?: string
  href?: string
  options?: string
  enabled?: boolean
}

function elementToPrompt(el: RawElement): PromptElement {
  const result: PromptElement = {
    id: el.id,
    role: el.role,
    label: el.label,
  }
  if (el.type) result.type = el.type
  if (el.value) result.value = el.value
  if (el.placeholder) result.placeholder = el.placeholder
  if (el.options) result.options = el.options
  if (!el.enabled) result.enabled = false  // only include when disabled (saves tokens)
  if (el.href) {
    // Show only path+hash, not full URL (saves tokens)
    try {
      const u = new URL(el.href)
      result.href = u.pathname + u.hash
    } catch {
      result.href = el.href
    }
  }
  return result
}

export interface PromptPayload {
  url: string
  viewportCenterBlocked: boolean
  totalPagesVisited: number
  unvisitedLinksOnPage: number
  lastAction: ActionRecord | null
  recentActions: ActionRecord[]
  failedElements: string[]
  elements: PromptElement[]
}

/**
 * Build the structured JSON payload that gets sent as the LLM user message.
 * All fields are bounded — total token count stays under ~3K.
 */
export function buildPromptPayload(
  pageState: PageState,
  globalState: GlobalState,
): PromptPayload {
  const recentActions = getActionsForPrompt(pageState.actionsThisPage)
  const failedElements = [...pageState.failedElementIds].slice(0, MAX_FAILED_ELEMENTS)

  // Count unvisited links among current elements (normalize href before comparing)
  const unvisitedLinksOnPage = pageState.elements.filter(
    (el) => el.role === "link" && el.href && !globalState.visitedPages.has(normalizeUrl(el.href))
  ).length

  const lastAction = pageState.actionsThisPage.length > 0
    ? pageState.actionsThisPage[pageState.actionsThisPage.length - 1]!
    : null

  return {
    url: pageState.currentUrl,
    viewportCenterBlocked: pageState.viewportCenterBlocked,
    totalPagesVisited: globalState.visitedPages.size,
    unvisitedLinksOnPage,
    lastAction,
    recentActions,
    failedElements,
    elements: pageState.elements.map(elementToPrompt),
  }
}

/**
 * Find element by ID in the current page state.
 */
export function findElement(pageState: PageState, elementId: string): RawElement | undefined {
  return pageState.elements.find((el) => el.id === elementId)
}

// ============================================================
// Planner Snapshot — Aşama 9
// ============================================================

/** Minimal snapshot sent to LLM planner — no action history, no failed elements */
export interface PlannerSnapshot {
  url: string
  viewportCenterBlocked: boolean
  totalPagesVisited: number
  elements: PromptElement[]
}

/**
 * Build the minimal snapshot for the LLM planner.
 * Only includes what the LLM needs to decide what to do — no state tracking fields.
 */
export function buildPlannerSnapshot(
  url: string,
  elements: RawElement[],
  globalState: GlobalState,
  viewportCenterBlocked: boolean,
): PlannerSnapshot {
  return {
    url,
    viewportCenterBlocked,
    totalPagesVisited: globalState.visitedPages.size,
    elements: elements.map(elementToPrompt),
  }
}
