// WebActExecutor — runs an Action through the shared guarded path (WebAct), waits for the page
// to settle, and reports the effect (navigated / revealed / no-op / blocked) via the snapshot
// signature diff (design §3.4). This is the forward single-source for execution + effect; the
// old WebCoDrive loop keeps its own inline settle/executeForm until it is retired in P3
// (FLAG: intentional temporary parallel during the additive migration — do not extend the old one).
import type { Executor, Action, ActionResult, PageSnapshot } from "./types"
import { snapshotSignature } from "./types"
import { WebAct } from "../act"
import { WebFormFill } from "../formfill"
import { PageState } from "../page-state"
import { Crawl } from "../crawl"

const STOP_STATUSES = new Set(["human-driving", "no-extension", "budget"])

export class WebActExecutor implements Executor {
  constructor(private readonly cfg: { settleMs: number; pollMs: number }) {}

  async run(sessionID: string, action: Action, before: PageSnapshot): Promise<ActionResult> {
    if (action.kind === "done") return { ok: true, status: "done", effect: "noop" }
    const beforeSig = snapshotSignature(before)

    if (action.kind === "navigate") {
      const r = await WebAct.perform(sessionID, { op: "navigate", url: action.url })
      if (!r.ok) return { ok: false, status: r.status, effect: STOP_STATUSES.has(r.status) ? "blocked" : "noop" }
      return this.settleAndEffect(sessionID, before.url, beforeSig, "ok")
    }

    if (action.kind === "form") {
      const st = await this.executeForm(sessionID, before.url, action.form)
      if (st === "stop") return { ok: false, status: "blocked", effect: "blocked" }
      return this.settleAndEffect(sessionID, before.url, beforeSig, "ok")
    }

    // click
    const r = await WebAct.perform(sessionID, { op: "click", url: before.url, elementId: action.elementId })
    if (!r.ok) {
      // Guard-blocked / stale element: mark it acted so the loop can't re-pick and spin.
      if (!STOP_STATUSES.has(r.status)) Crawl.record(sessionID, Crawl.actionKey(before.url, findEl(before, action.elementId)))
      return { ok: false, status: r.status, effect: STOP_STATUSES.has(r.status) ? "blocked" : "noop" }
    }
    return this.settleAndEffect(sessionID, before.url, beforeSig, "ok")
  }

  // Fill a form's typeable fields (human-like keystrokes via WebAct) then click submit. Returns
  // "stop" only when the whole loop should end. Recorded so it is not refilled.
  private async executeForm(sessionID: string, url: string, form: WebFormFill.FormCandidate): Promise<"ok" | "stop"> {
    for (const fill of form.fills) {
      const r = await WebAct.perform(sessionID, { op: "type", url, elementId: fill.id, text: fill.value })
      if (!r.ok && STOP_STATUSES.has(r.status)) return "stop"
    }
    const submit = await WebAct.perform(sessionID, { op: "click", url, elementId: form.submitId })
    Crawl.record(sessionID, form.actionKey)
    return !submit.ok && STOP_STATUSES.has(submit.status) ? "stop" : "ok"
  }

  private async settleAndEffect(sessionID: string, prevUrl: string, beforeSig: string, status: string): Promise<ActionResult> {
    await this.settle(sessionID, prevUrl, beforeSig)
    const after = PageState.current(sessionID)
    if (!after) return { ok: true, status, effect: "noop" }
    if (after.url !== prevUrl) return { ok: true, status, effect: "navigated" }
    return { ok: true, status, effect: snapshotSignature(after) !== beforeSig ? "revealed" : "noop" }
  }

  // Wait until the page's signature changes (new content / navigation) or the timeout elapses.
  private async settle(sessionID: string, prevUrl: string, beforeSig: string): Promise<void> {
    const started = Date.now()
    while (Date.now() - started < this.cfg.settleMs) {
      const now = PageState.current(sessionID)
      if (now && (now.url !== prevUrl || snapshotSignature(now) !== beforeSig)) return
      await new Promise((r) => setTimeout(r, this.cfg.pollMs))
    }
  }
}

// Element lookup used only for the failed-click record; returns a minimal shape when absent.
function findEl(snapshot: PageSnapshot, id: string): { role: string; label: string; href: string } {
  const el = snapshot.clickables.find((c) => c.id === id)
  return { role: el?.role ?? "", label: el?.label ?? "", href: el?.href ?? "" }
}
