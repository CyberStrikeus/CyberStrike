// Signal fabric — shared types (Web Workflow 2.0, plan §06/§03B).
//
// The signal fabric is the deterministic (code, not LLM) layer that scans every
// response — captured OR replay-elicited — for cross-cutting evidence, correlates
// injected canaries across pages, and routes each finding to its owning specialist.
// These types are the contract; detectors are PURE (no I/O) so they unit-test
// trivially. Nothing here decides "vulnerable" — a signal is a routed LEAD the
// owning specialist then confirms.

// The WSTG-aligned specialist agents a signal can be routed to (plan §04).
export type SpecialistClass =
  | "injection"
  | "access-control"
  | "auth-session"
  | "server-side-request"
  | "business-logic"
  | "misconfiguration"
  | "recon"
  | "client-side"
  | "llm"

// Every cross-cutting signal the passive detectors can emit (plan §06).
export type SignalType =
  | "full_path_disclosure"
  | "stack_trace"
  | "sql_error"
  | "server_banner"
  | "directory_listing"
  | "missing_security_headers"
  | "cors_misconfig"
  | "weak_cookie_flags"
  | "sensitive_data_exposure"
  | "open_redirect"
  | "graphql_introspection"
  | "exposed_artifact"
  | "jwt_leak"
  | "reflected_input"
  | "stored_reflection"

// One response header. A DTO decoupled from the DB row shape — the ingest/replay
// wiring adapts stored responses into this before running detectors.
export interface Header {
  name: string
  value: string
}

// A response the fabric inspects. Built the same way from captured traffic and
// from replay-elicited responses, so both paths run identical detection.
export interface ObservedResponse {
  requestId: string
  // Absolute request URL (scheme://host/path?query) — carries the query for
  // request-vs-response detectors (e.g. open_redirect).
  url: string
  method: string
  status: number
  headers: Header[]
  // Raw body text (latin1-decoded). Scanned BEFORE any HTML stub replaces it.
  body: string
}

// A routed lead. `owner` is deterministic (one specialist per SignalType) so the
// router never guesses. `evidence` is a short human-readable snippet; `meta`
// carries structured detail (e.g. inject/render sites for stored_reflection).
export interface Signal {
  type: SignalType
  owner: SpecialistClass
  requestId: string
  evidence: string
  meta?: Record<string, unknown>
}

// A passive detector. PURE: given one response, returns zero or more signals.
// No network, no DB, no shared state — the property the validation gate rests on.
export interface Detector {
  readonly signalType: SignalType
  readonly owner: SpecialistClass
  detect(res: ObservedResponse): Signal[]
}

// ── Header helpers (case-insensitive; a response may repeat set-cookie) ────────

export function headerValue(headers: Header[], name: string): string | undefined {
  const want = name.toLowerCase()
  for (const h of headers) if (h.name.toLowerCase() === want) return h.value
  return undefined
}

export function headerValues(headers: Header[], name: string): string[] {
  const want = name.toLowerCase()
  const out: string[] = []
  for (const h of headers) if (h.name.toLowerCase() === want) out.push(h.value)
  return out
}

export function hasHeader(headers: Header[], name: string): boolean {
  return headerValue(headers, name) !== undefined
}
