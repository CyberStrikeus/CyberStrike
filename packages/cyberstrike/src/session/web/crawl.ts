// Crawl state for the HackBrowser 2.0 co-driving loop (§ Phase D).
//
// The two tools (web_get_page_state = eyes, web_action = hands) are stateless per call;
// this store is the loop's memory: which pages have been visited, which actions have been
// taken (so the AI doesn't re-click into a cycle), and a hard action budget so an
// autonomous run can never loop forever. In-memory, server-lifetime — mirrors
// page-state.ts / ui-observation.ts / role-queue.ts. Single source for the budget default
// and for the action-key shape (shared by both tools, so "recorded" and "annotated as
// visited" can never drift).
import type { Clickable } from "./classify"

export namespace Crawl {
  // One place defines "how many actions before we stop". Change here, not in a tool.
  export const DEFAULT_BUDGET = 200

  interface State {
    budget: number
    actions: number
    pages: Set<string> // urls the crawl has observed / landed on
    acted: Set<string> // action keys already performed (cycle guard)
    frontier: Set<string> // discovered-but-not-yet-visited urls (dead-end backtrack target)
  }

  const bySession = new Map<string, State>()
  function state(sessionID: string): State {
    let s = bySession.get(sessionID)
    if (!s) {
      s = { budget: DEFAULT_BUDGET, actions: 0, pages: new Set(), acted: new Set(), frontier: new Set() }
      bySession.set(sessionID, s)
    }
    return s
  }

  // Stable identity for an action, independent of the volatile element id (E0..EN gets
  // renumbered every observation). Keyed by page + role:label|href so the SAME control on
  // two different pages counts separately, but the same control across re-observations of
  // one page counts once. Used by BOTH tools — the DRY point.
  export function actionKey(url: string, el: Pick<Clickable, "role" | "label" | "href">): string {
    const label = (el.label || "").replace(/\s+/g, " ").trim().toLowerCase()
    const role = (el.role || "").toLowerCase()
    const href = el.href || ""
    return `${url}\n${role}:${label}|${href}`
  }
  // Navigation target has no element — its identity is just the destination url.
  export function navKey(url: string): string {
    return `nav\n${url}`
  }

  export function setBudget(sessionID: string, n: number): void {
    if (Number.isFinite(n) && n > 0) state(sessionID).budget = Math.floor(n)
  }
  export function markPage(sessionID: string, url: string): void {
    if (url) state(sessionID).pages.add(url)
  }
  export function isPageVisited(sessionID: string, url: string): boolean {
    return state(sessionID).pages.has(url)
  }
  export function isActed(sessionID: string, key: string): boolean {
    return state(sessionID).acted.has(key)
  }
  // Record discovered urls that have not been visited yet, for dead-end backtracking.
  export function discover(sessionID: string, urls: (string | undefined)[]): void {
    const s = state(sessionID)
    for (const u of urls) if (u && !s.pages.has(u)) s.frontier.add(u)
  }
  // Pop one still-unvisited discovered url (skipping any since-visited), or undefined when the
  // frontier is exhausted (true coverage). Drains, so each frontier url is tried at most once.
  export function takeFrontier(sessionID: string): string | undefined {
    const s = state(sessionID)
    for (const u of s.frontier) {
      s.frontier.delete(u)
      if (!s.pages.has(u)) return u
    }
    return undefined
  }
  // Over budget BEFORE the next action would run. record() is what consumes budget.
  export function overBudget(sessionID: string): boolean {
    const s = state(sessionID)
    return s.actions >= s.budget
  }
  // Consume one unit of budget and remember the action. Call ONLY after an action actually
  // happened (a blocked/denied action didn't occur, so it must not count).
  export function record(sessionID: string, key: string): void {
    const s = state(sessionID)
    s.acted.add(key)
    s.actions++
  }

  export interface Summary {
    actions: number
    budget: number
    remaining: number
    over_budget: boolean
    pages_visited: number
  }
  export function summary(sessionID: string): Summary {
    const s = state(sessionID)
    return {
      actions: s.actions,
      budget: s.budget,
      remaining: Math.max(0, s.budget - s.actions),
      over_budget: s.actions >= s.budget,
      pages_visited: s.pages.size,
    }
  }

  export function clearSession(sessionID: string): void {
    bySession.delete(sessionID)
  }
  export function _reset(): void {
    bySession.clear()
  }
}
