// Deterministic form-fill planning for the co-driving crawl.
//
// Forms are how a crawler reaches behind search boxes, filters and multi-step flows — so the
// loop fills and submits them, not just clicks links. This module decides, with NO LLM:
//   - WHICH forms are safe to submit (skip login/logout/destructive — see SKIP),
//   - WHAT benign value each field gets (by type/name),
//   - and packages it as a candidate the loop executes via the shared WebAct (type each field
//     with human-like keystrokes, then click submit — guarded like any other action).
// The LLM value tier (business-specific fields) is a later seam; deterministic covers the
// common search/filter/simple-form cases that unlock the most pages.
import { PageState } from "./page-state"
import { Crawl } from "./crawl"
import type { ElementKind } from "./classify"

export namespace WebFormFill {
  // Submit kinds we never autonomously trigger: login (the human logs in), logout (guard
  // denies it anyway), destructive (guard confirms it anyway) — skipped proactively so we
  // don't fill a form we won't submit.
  const SKIP: ReadonlySet<ElementKind> = new Set<ElementKind>(["auth", "logout", "destructive"])

  // How a single field is filled: type text, select a dropdown option, or toggle a box.
  export interface Fill {
    id: string
    value: string
    op: "type" | "select" | "check"
  }

  export interface FormCandidate {
    actionKey: string
    submitId: string
    label: string
    kind?: ElementKind
    fills: Fill[]
    score: number
  }

  // Benign, human-plausible TEXT value for a field, or null for a non-text-typeable field
  // (structural controls). Select / checkbox / radio are NOT text — they go through fillFor's
  // dedicated ops, so they are excluded here.
  export function valueFor(field: { name: string; type: string }): string | null {
    const type = (field.type || "text").toLowerCase()
    const name = (field.name || "").toLowerCase()
    if (
      ["hidden", "submit", "button", "reset", "image", "file", "color", "checkbox", "radio", "select", "select-one", "select-multiple"].includes(type)
    )
      return null
    // Substring matching (not \b) — real field names glue words with underscores/camelCase
    // (user_email, firstName), where a word boundary would miss.
    if (type === "password" || name.includes("password") || name.includes("passwd")) return "Test1234!Aa"
    if (type === "email" || name.includes("email")) return "test@example.com"
    if (type === "tel" || name.includes("phone") || name.includes("mobile")) return "5551234567"
    if (type === "url" || name.includes("website")) return "https://example.com"
    if (type === "number" || type === "range") return "1"
    if (type === "date") return "2020-01-01"
    if (type === "month") return "2020-01"
    if (type === "week") return "2020-W01"
    if (type === "time") return "12:00"
    if (type === "search" || name.includes("search") || name === "q") return "test"
    if (name.includes("name")) return "Test User"
    return "test" // text / textarea / anything else typeable
  }

  // The complete fill for a field — op + value — or null to leave it (structural controls). This
  // is what lets a deterministic form fill complete a REAL form: dropdowns get an option, required
  // checkboxes/radios get toggled, password/text get values. A select value of "" tells the
  // extension to pick the first valid option (we don't know the option list server-side).
  export function fillFor(field: { name: string; type: string }): { op: Fill["op"]; value: string } | null {
    const type = (field.type || "text").toLowerCase()
    if (["hidden", "submit", "button", "reset", "image", "file", "color"].includes(type)) return null
    if (type === "checkbox" || type === "radio") return { op: "check", value: "true" }
    if (type === "select" || type === "select-one" || type === "select-multiple") return { op: "select", value: "" }
    const v = valueFor(field)
    return v === null ? null : { op: "type", value: v }
  }

  function prioritized(label: string, action: string, priorities: string[]): boolean {
    if (priorities.length === 0) return false
    const hay = `${label} ${action}`.toLowerCase()
    return priorities.some((p) => p && hay.includes(p.toLowerCase()))
  }

  // Fillable, not-yet-submitted forms on the page, best first. A form with no typeable field
  // is omitted (a plain submit click, if any, is handled by the click ranker instead).
  export function candidates(sessionID: string, state: PageState.StatePayload, priorities: string[] = []): FormCandidate[] {
    const out: FormCandidate[] = []
    for (const form of state.forms ?? []) {
      if (!form.submit_id) continue
      const submit = state.clickables.find((c) => c.id === form.submit_id)
      if (!submit) continue
      if (submit.kind && SKIP.has(submit.kind)) continue // login/logout/destructive → never auto-submit
      const label = submit.label || "submit"
      const key = Crawl.actionKey(state.url, { role: "form", label, href: form.action })
      if (Crawl.isActed(sessionID, key)) continue
      const fills: Fill[] = []
      for (const f of form.fields) {
        if (!f.id) continue
        const ff = fillFor(f)
        if (!ff) continue
        fills.push({ id: f.id, value: ff.value, op: ff.op })
      }
      if (fills.length === 0) continue
      let score = submit.kind === "query" ? 4 : submit.kind === "mutating" ? 3 : 2
      if (prioritized(label, form.action, priorities)) score += 4
      out.push({ actionKey: key, submitId: form.submit_id, label, kind: submit.kind, fills, score })
    }
    return out.sort((a, b) => b.score - a.score)
  }
}
