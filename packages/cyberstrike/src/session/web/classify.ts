// CyberStrike HackBrowser 2.0 — deterministic element classification.
//
// Turns a raw clickable (label/href/tag from the DOM) into a semantic kind with
// NO LLM — pure keyword/pattern heuristics. This is what makes the deterministic
// observation AI-usable: the AI sees "3 destructive, 2 auth, 45 nav" instead of a
// flat list it must interpret itself. The same tags feed the destructive/logout
// guard (risk #1) — one classification, two jobs.
//
// Single source of truth: only this module classifies. The page-state store imports it;
// nothing re-implements the rules.

export type ElementKind = "destructive" | "logout" | "auth" | "mutating" | "query" | "nav" | "other"

// Order matters: first match wins, most dangerous first.
// Unambiguous destructive verbs — irreversible / data-losing.
const DESTRUCTIVE = /\b(delete|remove|destroy|wipe|erase|terminate|deactivate|revoke|unsubscribe|drop)\b/
// "cancel"/"close" alone is often a harmless dialog dismiss — only destructive
// when paired with a real target (avoid over-flagging every Cancel button).
const DESTRUCTIVE_CTX = /\b(cancel|close|delete)\b.*\b(account|subscription|order|plan|membership|payment)\b|\b(account|subscription|order|plan|membership)\b.*\b(cancel|close|delete)\b/
// Session-ending — separate from auth because logout is what revokes tokens (risk #1).
const LOGOUT = /\b(log\s?out|sign\s?out|sign\s?off|end\s?session)\b/
const LOGOUT_HREF = /log[-_]?out|sign[-_]?out|logoff|\/logout\b/
// Auth entry (login) — distinct from logout.
const AUTH = /\b(log\s?in|sign\s?in|authenticate)\b/
const AUTH_HREF = /log[-_]?in|sign[-_]?in|\/auth(\b|\/)/
// State-changing writes (includes high-impact payment verbs).
const MUTATING = /\b(submit|save|create|add|update|edit|publish|send|apply|confirm|pay|checkout|order|purchase|buy|upload|import|export)\b/
// Read-only lookups.
const QUERY = /\b(search|filter|sort|find|query|lookup)\b/

export function classifyElement(label: string, href: string, tag: string): ElementKind {
  const text = (label || "").toLowerCase()
  const h = (href || "").toLowerCase()
  if (DESTRUCTIVE.test(text) || DESTRUCTIVE_CTX.test(text)) return "destructive"
  if (LOGOUT.test(text) || LOGOUT_HREF.test(h)) return "logout"
  if (AUTH.test(text) || AUTH_HREF.test(h)) return "auth"
  if (MUTATING.test(text)) return "mutating"
  if (QUERY.test(text)) return "query"
  if (tag === "a" && href) return "nav"
  return "other"
}

export interface Clickable {
  id: string
  tag: string
  role: string
  label: string
  href: string
  kind?: ElementKind
}

// Annotate every clickable in place; returns a kind-count summary for logging.
export function annotateClickables(clickables: Clickable[]): Record<ElementKind, number> {
  const counts: Record<ElementKind, number> = {
    destructive: 0, logout: 0, auth: 0, mutating: 0, query: 0, nav: 0, other: 0,
  }
  for (const c of clickables) {
    c.kind = classifyElement(c.label, c.href, c.tag)
    counts[c.kind]++
  }
  return counts
}
