// ============================================================
// v2 Architecture Types (see ARCHITECTURE.md)
// ============================================================

/** Raw element collected from DOM by Scanner. LLM sees id/role/label/value but NOT selector. */
export interface RawElement {
  id: string           // "E1", "E2", ... (system-generated)
  tag: string          // "button", "input", "a", "select", "textarea", ...
  role: string         // ARIA role or implicit role
  label: string        // aria-label || label[for] || innerText || placeholder || name
  value: string        // input value, select value, aria-valuenow (slider)
  enabled: boolean     // !disabled
  href: string         // only for links
  type: string         // input type (text, email, password, range, checkbox, ...)
  placeholder: string  // input placeholder
  options: string      // comma-separated option values for <select> elements
  constraints: string  // HTML5 validation meta: "min:0 max:1000 step:10", "maxlength:160", ...
  selector: string     // Playwright selector — LLM never sees this
}

/** Deferred auth page — discovered during anonymous phase, processed later */
export interface DeferredAuthPage {
  url: string
  type: "register" | "login" | "logout"
}

/**
 * Intelligence Layer state (Aşama 13 §3.3.1, §3.5.1) — CREDENTIAL-SCOPED.
 * Each credential in multi-credential mode owns its own instance so that
 * empty-state signals, revisit counters, and DOM fingerprints from one
 * credential cannot leak into another's journey. Single-credential mode
 * uses SINGLE_CRED sentinel (see state.ts).
 */
export interface IntelligenceState {
  // url → mutation keyword to match. "*" means any-mutation (legacy/fallback).
  emptyStateQueue: Map<string, string>
  // url → revisit count (hard limit: 2 per URL per credential)
  revisitCount: Map<string, number>
  // url → element fingerprint for re-visit comparison
  pageFingerprints: Map<string, string>
}

/** Global state: lives across entire crawl */
export interface GlobalState {
  // Shared across credentials
  visitedPages: Set<string>
  capturedEndpoints: Set<string>  // "METHOD /path" format
  authPhase: "anonymous" | "registered" | "authenticated"
  totalSteps: number
  pageQueue: string[]
  deferredAuthPages: DeferredAuthPage[]
  pendingReDiscovery: boolean
  pathPatternCounts: Map<string, number>  // template key → enqueued count (path pattern limiting)
  outOfScope: readonly string[]          // labels the planner must never plan (config snapshot)
  // Credential-scoped intelligence (Aşama 13) — keyed by credential id or SINGLE_CRED
  intelligenceByCredential: Map<string, IntelligenceState>
}

/** Page state: resets on every page transition */
export interface PageState {
  currentUrl: string
  elements: RawElement[]
  viewportCenterBlocked: boolean
  actionsThisPage: ActionRecord[]
  failedElementIds: Set<string>
  lastActionResult: ActionResult | null
  step: number
}

/** Record of an action taken on the current page */
export interface ActionRecord {
  elementId: string
  action: string
  value?: string
  success: boolean
  httpSideEffects?: string[]  // ["POST /api/Users [201]"]
}

/** Result of the last executed action — fed back to LLM */
export interface ActionResult {
  success: boolean
  error?: string
  navigated?: boolean
  newUrl?: string
  httpRequests?: string[]  // ["POST /api/Users [201]"]
  domChanged?: boolean
}

/** LLM response format — legacy, kept for reference */
export interface LLMDecision {
  elementId?: string    // undefined only for "done"
  action: "fill" | "click" | "select" | "navigate" | "done"
  value?: string        // for fill/select
  reason: string
}

// ============================================================
// Planner Architecture Types (Aşama 9)
// ============================================================

/** A single form field to fill — role+label identifies the element, value is what to write */
export interface FormFieldPlan {
  role: string    // "textbox" | "combobox" | "checkbox" | "radio" | "slider"
  label: string   // semantic key — system resolves to current element
  value: string   // fill/select value (computed by LLM, e.g. CAPTCHA answer)
}

/** Fill a form completely and submit it */
export interface FormTask {
  type: "form"
  fields: FormFieldPlan[]
  submit: { role: string; label: string }
  /** Aşama 13: LLM-predicted mutation keyword this task will trigger on success.
   *  Matched against empty pages' revisitOn to drain selectively. */
  triggersMutation?: string
}

/** Click a button/tab/accordion/interactive element */
export interface ClickTask {
  type: "click"
  role: string
  label: string
  reason?: string
  /** Aşama 13: LLM-predicted mutation keyword this task will trigger on success. */
  triggersMutation?: string
}

export type PageTask = FormTask | ClickTask

/** Page state classification — used for journey awareness (Aşama 13 §3.3.1) */
export type PageStateKind = "populated" | "empty" | "unknown"

/** Revisit trigger — when the orchestrator should re-queue this URL */
export type RevisitTrigger = "any-mutation"

/** LLM's analysis of a page — what to do (PagePlan v2, Aşama 13) */
export interface PagePlan {
  tasks: PageTask[]
  /** Page content classification. Default "unknown" if missing — safe, no revisit. */
  pageState?: PageStateKind
  /** When to revisit this URL. null (default) means no revisit planned. */
  revisitAfter?: RevisitTrigger | null
  /** Short explanation (required when pageState==="empty"). */
  revisitReason?: string
  /** Aşama 13 Mutation Matching — keyword the LLM expects will populate this page.
   *  e.g. "cart-item-added", "user-created". Matched against PageTask.triggersMutation.
   *  When omitted, URL drains on ANY successful mutation (backward-compat fallback). */
  revisitOn?: string
}

// ============================================================
// Legacy Types (used by capture/ingest/auth — unchanged)
// ============================================================

export interface UIField {
  name: string          // input name / id / aria-label
  label: string         // visible label text
  value: string         // current value (checked radio's value, selected option, input value)
  type: string          // text, hidden, select, checkbox, radio, textarea, display
  options?: string      // radio/select/listbox — "A, B, C" or "A, B, C, ..." (first 3 + ellipsis)
  isReadOnly: boolean
  isDisabled: boolean
  isHidden: boolean     // type=hidden or any ancestor display:none/visibility:hidden/opacity:0
  hiddenReason?: "type=hidden" | "display:none" | "visibility:hidden" | "opacity:0"  // why isHidden is true
  isDisplayOnly: boolean // span/div/p showing a value (not an input)
  validation: {
    min?: string
    max?: string
    maxLength?: string
    pattern?: string
    required?: boolean
  }
}

export interface UIContext {
  pageUrl: string
  pageTitle: string
  // Human-readable path through the UI, e.g. "Settings > Profile > Edit Form"
  componentPath: string
  formName: string
  fields: UIField[]
  // Fields present in the HTTP request but NOT found in the UI
  hiddenParams: string[]
}

export interface CapturedRequest {
  // Raw HTTP request string (same format as Firefox ext sends)
  raw: string
  // URL scheme captured at request time. Forwarded to CyberStrike so the
  // server-side normalizer can build a stable origin identity without having
  // to guess (request-target on the wire is path-only).
  scheme: "http" | "https"
  response: {
    status: number
    headers: Record<string, string>
    body: string
  } | null
  uiContext: UIContext | null
  // Which UI element triggered this request — "role:label" format (e.g. "button:Delete User")
  // Set for all requests (GET included) during an action window. Null for page-load/background requests.
  triggerElement: string | null
  // Which roles can see the trigger element — derived from page_diff availability Map at drain time.
  // Only set in multi-credential mode. Null when trigger is missing or availability lookup fails.
  elementRoles: string[] | null
  // Which page was being explored when this request was captured (e.g. "/users")
  pageUrl: string | null
  // Which roles could visit that page — from page_diff visited_by. Multi-credential only.
  pageVisitedBy: string[] | null
  timestamp: number
}

export interface IngestPayload {
  text: string
  sessionID?: string
  credential_id?: string
  // URL scheme of the captured request. Optional for backward compat with
  // older browser-agent / Firefox extension builds; CyberStrike falls back
  // to a Host-header heuristic when absent.
  scheme?: "http" | "https"
  response?: {
    status: number
    headers: Record<string, string>
    body: string
  }
  ui_context?: UIContext
  access_context?: AccessContext | PageDiffContext
  // Which UI element triggered this request — "role:label" format
  // CyberStrike uses this with element_roles to determine available_roles per endpoint
  trigger_element?: string
  // Which roles can see the trigger element — derived from page_diff availability Map
  // CyberStrike proxy-analyzer uses this to set available_roles on web_function
  element_roles?: string[]
  // Which page was being explored when this request was captured
  page_url?: string
  // Which roles could visit that page — page-level access signal
  page_visited_by?: string[]
}

/** Access context for multi-credential crawling — sent with HTTP captures */
export interface AccessContext {
  fingerprint_match: boolean  // all contexts see the same page structure?
}

/** Page-diff payload — sent once per page, element-level availability for CyberStrike */
export interface PageDiffContext {
  type: "page_diff"
  page_url: string
  discovered_by: string[]    // which contexts found the link to this page
  visited_by: string[]       // which contexts actually visited this page
  fingerprint_match: boolean
  elements: Record<string, string[]>  // "button:Delete User" → ["admin"]
}

export interface AgentConfig {
  targetUrl: string
  cyberstrike: {
    serverUrl: string       // default: http://127.0.0.1:4096
    sessionID?: string
    credentialId?: string
    username?: string       // --cyberstrike-username (default: "cyberstrike")
    password?: string       // --cyberstrike-password or CYBERSTRIKE_SERVER_PASSWORD env var
  }
  auth: {
    // Path to a saved session file (cookies JSON)
    sessionFile?: string
    // If set, agent will auto-login with these credentials
    credentials?: { username: string; password: string; usernameSelector?: string; passwordSelector?: string }
    // If true, user logs in manually via browser button (Aşama 11)
    authenticated?: boolean
  }
  // Multi-credential config (Aşama 12) — overrides auth when set
  multiCredentials?: CredentialConfig[]
  // Out-of-scope labels (Aşama 13) — planner never plans tasks with these labels (semantic match).
  // Example: ["Delete Account", "Cancel Subscription"]
  outOfScope?: string[]
  // Network scope: hostnames whose requests get forwarded to CyberStrike.
  // Each entry is a bare host ("api.test.com") or wildcard ("*.test.com").
  // When omitted, scope is derived from targetUrl's eTLD+1 wildcard.
  // Distinct from outOfScope (which is a planner-side semantic filter).
  scope?: string[]
  // Max navigation steps before stopping
  maxSteps?: number
  // Show browser window
  headless?: boolean
  // Dry-run mode: crawl without LLM calls, print captures to console instead of sending to CyberStrike
  dryRun?: boolean
  // Inject the live telemetry panel into every page (PANEL_UI_BRIEF.md). Default: true.
  panel?: boolean
}

/** Single credential definition for multi-credential crawl */
export interface CredentialConfig {
  id: string  // "admin", "user", "manager", etc.
}

// ============================================================
// Panel UI Events (PANEL_UI_BRIEF.md §4)
// ============================================================

/**
 * Events emitted by the agent to the injected panel via window.__csEvent.
 * One-way (agent → panel). Panel is defensive: unknown kinds are ignored.
 */
export type CSEvent =
  | { type: "init"; target: string; credentials: string[]; maxPages: number; startedAt: number }
  | { type: "page-change"; url: string; pageNum: number; maxPages: number; credential: string }
  | {
      type: "plan-received"
      tasks: number
      pageState: "populated" | "empty" | "unknown"
      summary: Array<{ kind: "form" | "click"; label: string }>
      credential: string
    }
  | {
      type: "action-start"
      kind: "click" | "fill" | "select" | "submit"
      targetLabel: string
      targetSelector?: string   // best-effort — panel uses for Target Paint overlay
      value?: string
      credential: string
    }
  | { type: "action-end"; ok: boolean; mutation?: boolean; credential: string }
  | {
      type: "capture"
      method: string
      path: string
      status: number
      trigger?: string
      credential: string
      isMutation: boolean
    }
  | {
      type: "intelligence"
      kind: "mark-empty" | "drain" | "stale-prune" | "revisit"
      url: string
      credential: string
      note?: string
    }
  | {
      type: "llm-thinking"
      reason: "page-plan" | "unexplored" | "replan"
      elements: number
      credential: string
    }
  | { type: "credential-switch"; from: string | null; to: string }
  | {
      type: "crawl-done"
      summary: {
        pagesExplored: number
        capturedEndpoints: number
        mutations: number
        credentials: string[]
      }
    }

// ============================================================
// Multi-Credential Types (Aşama 12)
// ============================================================

/** BFS queue entry — tracks which contexts should visit this URL */
export interface QueueEntry {
  url: string
  contexts: string[]  // ["admin", "user"] or ["default"] for single-credential
}

