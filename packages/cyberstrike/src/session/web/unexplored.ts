// Unexplored tier (U1) — a second look at what the deterministic ranker deliberately leaves
// behind. Rank only surfaces nav/query links + forms; genuinely-interactive `other` elements
// (custom menus, tabs, accordions, "Show more" openers made clickable by JS) are never acted
// on, so content behind them is missed. When a page is otherwise exhausted, this picks the
// leftovers that LOOK like openers by deterministic signals — aria-haspopup / aria-expanded=
// false / aria-controls, an expander role, or a detected listener — and lets the loop click
// the best one to reveal more. No LLM (that is U3). Cursor-only, signalless elements are
// skipped here on purpose (too noisy without effect-tracking, which is U2).
import { PageState } from "./page-state"
import { Crawl } from "./crawl"

export namespace Unexplored {
  const EXPANDER_ROLES: ReadonlySet<string> = new Set([
    "tab", "menuitem", "menuitemcheckbox", "menuitemradio", "treeitem", "combobox", "listbox",
  ])
  // Single source for the expander scoring weights.
  const SCORE = { haspopup: 4, collapsed: 4, controls: 3, role: 3, listener: 2, button: 1, viewport: 1 }

  export interface Candidate {
    id: string
    label: string
    actionKey: string
    score: number
  }

  // Un-acted `other`-kind interactives that carry a real "this opens something" signal,
  // best first. Empty ⇒ no opener worth trying (the loop falls through to the frontier).
  export function expanders(sessionID: string, state: PageState.StatePayload): Candidate[] {
    const out: Candidate[] = []
    const seen = new Set<string>()
    for (const c of state.clickables) {
      if (c.kind !== "other") continue // nav/query/forms handled elsewhere; auth/logout/destructive never here
      if (c.policy !== "allow") continue
      const key = Crawl.actionKey(state.url, c)
      if (Crawl.isActed(sessionID, key)) continue
      if (seen.has(key)) continue
      const aria = c.aria ?? {}
      const why = c.why ?? ""
      const role = (c.role ?? "").toLowerCase()
      let score = 0
      let signal = false
      if (aria.haspopup) {
        score += SCORE.haspopup
        signal = true
      }
      if (aria.expanded === "false") {
        score += SCORE.collapsed
        signal = true
      }
      if (aria.controls) {
        score += SCORE.controls
        signal = true
      }
      if (EXPANDER_ROLES.has(role)) {
        score += SCORE.role
        signal = true
      }
      if (why.includes("listener") || why.includes("onclick")) {
        score += SCORE.listener
        signal = true
      }
      if (!signal) continue // cursor-only / no real opener signal → skip in U1
      if (role === "button") score += SCORE.button
      if (c.in_viewport === true) score += SCORE.viewport
      seen.add(key)
      out.push({ id: c.id, label: c.label, actionKey: key, score })
    }
    return out.sort((a, b) => b.score - a.score)
  }
}
