// ExhaustiveNavigator — 1.1.16-style breadth: on each page, act on EVERY interactive control
// (not just the LLM's or the ranker's top pick), so the browser TRIGGERS every endpoint and the
// capture layer records the REAL request WITH ITS BODY. This is the only way to get a POST
// endpoint's real payload — JS mining discovers the endpoint shape but never its body.
//
// Deterministic (no model): it plans all un-acted, in-scope, non-logout elements + every fillable
// form, then the co-drive loop backtracks through the frontier (BFS) to the next page. Logout is
// always skipped (it just ends the crawl). Destructive controls (reset/bulk-action/delete) are
// INCLUDED only when the executor is in aggressive mode — capturing their real bodies mutates the
// target, so that is a deliberate opt-in (CYBERSTRIKE_WEB_EXHAUSTIVE), not the silent default.
import type { Navigator, Plan, PageSnapshot, Action } from "./types"
import { WebFormFill } from "../formfill"
import { WebStrategy } from "../strategy"
import { WebScope } from "../scope"
import { Crawl } from "../crawl"

// How many actions one plan may carry. High, because the whole point is to exercise every control
// on the page in one sweep; the loop's acted-tracking + budget still bound the total.
const MAX_PLAN = 40

export class ExhaustiveNavigator implements Navigator {
  // `aggressive` mirrors the executor: when true, destructive (confirm-policy) controls are planned
  // too (their capture mutates the target). Logout (deny) is never planned. Default false = safe.
  constructor(private readonly aggressive = false) {}

  async plan(sessionID: string, snapshot: PageSnapshot): Promise<Plan> {
    const priorities = WebStrategy.get(sessionID)?.priorities ?? []
    const actions: Action[] = []

    // 1) Every fillable form first — filling + submitting captures the real request body.
    for (const form of WebFormFill.candidates(sessionID, snapshot, priorities)) {
      if (actions.length >= MAX_PLAN) break
      actions.push({ kind: "form", form })
    }

    // 2) Every interactive control that hasn't been acted on: buttons, links, menu items, tabs,
    //    script-driven widgets. NOT just the ranker's nav/query subset — the full surface, so an
    //    in-page action button (which fires a POST with a body) is exercised, not skipped.
    for (const c of snapshot.clickables) {
      if (actions.length >= MAX_PLAN) break
      if (c.disabled) continue
      // Policy: allow always; confirm (destructive) only in aggressive mode; deny (logout) never.
      if (c.policy === "deny") continue
      if (c.policy === "confirm" && !this.aggressive) continue
      if (Crawl.isActed(sessionID, Crawl.actionKey(snapshot.url, c))) continue
      // A link out of scope is not a click target (navigation is bounded to the target domain).
      if (c.href) {
        const target = WebScope.resolve(c.href, snapshot.url)
        if (target && !WebScope.allowed(sessionID, target)) continue
      }
      actions.push({ kind: "click", elementId: c.id, label: c.label })
    }

    if (actions.length === 0) {
      return { rationale: "exhaustive: page fully exercised (no un-acted control or form)", actions: [] }
    }
    return { rationale: `exhaustive: exercise ${actions.length} control(s)/form(s) on this page`, actions }
  }
}
