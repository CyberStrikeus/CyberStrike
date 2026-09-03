// Deterministic candidate ranking for the co-driving loop — the "deterministic feeds the
// AI" half. From a page's annotated clickables it produces a short, ordered shortlist of
// what is worth doing next, with NO LLM: skip visited / non-allow / non-navigable, dedupe
// by action-key, then score for coverage. The loop either auto-advances on the top pick
// (no LLM call) or hands this shortlist to the planner. Pure — fully testable.
import { PageState } from "./page-state"
import { Crawl } from "./crawl"
import { Effect } from "./effect"
import { WebScope } from "./scope"

export namespace Rank {
  // Only navigation/lookup elements are auto-drivable. mutating/auth/destructive/logout are
  // deliberately excluded here (the guard would block the dangerous ones anyway; mutating
  // needs intent we don't infer deterministically).
  const NAVIGABLE = new Set(["nav", "query"])
  // Single source for the scoring weights.
  const SCORE = { nav: 2, query: 1, newTarget: 3, inViewport: 1, testid: 1, offscreen: -1, priority: 4 }

  export interface Candidate {
    id: string
    label: string
    kind: string
    actionKey: string
    href: string
    targetUrl?: string
    score: number
  }

  function resolve(href: string, base: string): string | undefined {
    if (!href) return undefined
    try {
      return new URL(href, base).href
    } catch {
      return undefined
    }
  }

  // Does this candidate match any strategy priority (business-logic steer from the main model)?
  function prioritized(c: { label: string; section?: string; targetUrl?: string }, priorities: string[]): boolean {
    if (priorities.length === 0) return false
    const hay = `${c.label} ${c.section ?? ""} ${c.targetUrl ?? ""}`.toLowerCase()
    return priorities.some((p) => p && hay.includes(p.toLowerCase()))
  }

  // Ordered shortlist (highest score first; stable on ties). Empty ⇒ nothing left to do on
  // this page (coverage for the loop's terminate check). `priorities` (from WebStrategy, the
  // main model) boosts business-logic-relevant candidates so the crawl explores them first.
  export function candidates(sessionID: string, state: PageState.StatePayload, priorities: string[] = []): Candidate[] {
    const out: Candidate[] = []
    const seen = new Set<string>()
    for (const c of state.clickables) {
      if (c.policy !== "allow") continue
      if (!c.kind || !NAVIGABLE.has(c.kind)) continue
      const key = Crawl.actionKey(state.url, c)
      // Acted excludes it — UNLESS effect-tracking found it productive (Load-more/paginator).
      if (Crawl.isActed(sessionID, key) && !Effect.eligible(sessionID, key)) continue
      if (seen.has(key)) continue
      const target = resolve(c.href, state.url)
      // Stay on-target: drop links that navigate out of scope (external hosts) so the loop
      // doesn't wander off the app into e.g. a footer "source on GitHub" link.
      if (target && !WebScope.allowed(sessionID, target)) continue
      seen.add(key)
      let score = SCORE[c.kind as "nav" | "query"] ?? 0
      if (target && !Crawl.isPageVisited(sessionID, target)) score += SCORE.newTarget
      if (c.in_viewport === true) score += SCORE.inViewport
      if (c.in_viewport === false) score += SCORE.offscreen
      if (c.testid) score += SCORE.testid
      if (prioritized({ label: c.label, section: c.section, targetUrl: target }, priorities)) score += SCORE.priority
      out.push({ id: c.id, label: c.label, kind: c.kind, actionKey: key, href: c.href, targetUrl: target, score })
    }
    return out
      .map((c, i) => ({ c, i }))
      .sort((a, b) => b.c.score - a.c.score || a.i - b.i)
      .map((x) => x.c)
  }
}
