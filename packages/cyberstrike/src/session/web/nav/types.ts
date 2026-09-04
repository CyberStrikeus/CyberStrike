// AI-driven navigator (P1 scaffold) — value objects + service interfaces.
//
// See docs/AI-NAVIGATOR-DESIGN.md. The OO layer wraps the existing single-source modules
// (Rank / WebAct / WebFormFill / Crawl / scope / guard) behind clean interfaces so the loop's
// brain (Navigator) can be swapped from deterministic (P1) to LLM (P3) without touching the
// orchestrator or the guardrails. Nothing here duplicates logic — impls delegate.
import { PageState } from "../page-state"
import { Crawl } from "../crawl"
import type { WebAct } from "../act"
import type { WebFormFill } from "../formfill"

// The rich observation IS the snapshot — no parallel duplicate type. Tech stack lands here in P2.
export type PageSnapshot = PageState.StatePayload

// One thing the loop can do next. Kept minimal for P1 (parity with today's capabilities);
// Type/Submit-with-values/Scroll/Back are added with the framework strategies (P5).
export type Action =
  | { kind: "click"; elementId: string; label?: string }
  | { kind: "navigate"; url: string }
  | { kind: "form"; form: WebFormFill.FormCandidate }
  | { kind: "done"; reason: string }

// The Navigator's output: an ordered, bounded plan + why (logged so the operator sees reasoning).
export interface Plan {
  rationale: string
  actions: Action[]
}

// What an executed action DID — drives the re-plan decision (§3.4).
export type ActionEffect = "navigated" | "revealed" | "noop" | "blocked"
export interface ActionResult {
  ok: boolean
  status: string // WebAct.Status, or "form"/"done"/"blocked"
  effect: ActionEffect
}

export type StopReason =
  | "coverage-complete"
  | "budget-exhausted"
  | "human-took-over"
  | "no-extension-connected"
  | "no-page-observed"
  | "no-plan"
  | "stopped"

// --- service interfaces (DI seams; every LLM / browser touch is behind one) ---------------
export interface Observer {
  observe(sessionID: string): PageSnapshot | null
}
export interface Navigator {
  // The ONLY LLM decision. Returns a Plan; a `done` action ends the crawl.
  plan(sessionID: string, snapshot: PageSnapshot): Promise<Plan>
}
export interface Executor {
  // Perform the action through the shared guarded path, wait for the page to settle, and report
  // the effect (navigated / revealed new content / no-op / blocked by guard). `intent` is the
  // plan's rationale (the "why"), narrated to the browser overlay before acting (optional).
  run(sessionID: string, action: Action, before: PageSnapshot, intent?: string): Promise<ActionResult>
}

// Material-change signature (§3.4): url + the set of ALL interactive-element action-keys on the
// page + form count. Stable across a no-op action (same DOM → same keys); changes on navigation
// (url) or when new interactive content appears (new keys). Objective, not a fuzzy threshold.
export function snapshotSignature(snapshot: PageSnapshot): string {
  const keys = snapshot.clickables.map((c) => Crawl.actionKey(snapshot.url, c)).sort()
  return `${snapshot.url}\n${snapshot.forms.length}\n${keys.join("|")}`
}

// Re-export the executor status type location for impls without a runtime import cycle.
export type { WebAct }
