// WebActExecutor — runs an Action through the shared guarded path (WebAct), waits for the page
// to settle, and reports the effect (navigated / revealed / no-op / blocked) via the snapshot
// signature diff (design §3.4). This is the single source for execution + effect (the old
// WebCoDrive loop that had its own inline settle/executeForm was retired in P3).
import type { Executor, Action, ActionResult, PageSnapshot } from "./types"
import { snapshotSignature } from "./types"
import { WebAct } from "../act"
import { WebControl } from "../control"
import { WebFormFill } from "../formfill"
import { PageState } from "../page-state"
import { Crawl } from "../crawl"
import { ExecStrategy } from "../exec-strategy"

const STOP_STATUSES = new Set(["human-driving", "no-extension", "budget"])
const DEFAULT_HYDRATE_MS = 4000

export class WebActExecutor implements Executor {
  private readonly hydrated = new Set<string>() // `${sessionID}\n${url}` already hydration-waited
  constructor(private readonly cfg: { settleMs: number; pollMs: number; hydrateMs?: number }) {}

  async run(sessionID: string, action: Action, before: PageSnapshot, intent?: string): Promise<ActionResult> {
    if (action.kind === "done") return { ok: true, status: "done", effect: "noop" }
    // Narrate what/why to the in-browser overlay BEFORE acting (fire-and-forget; the panel/hue
    // reflect the AI's reasoning). Best-effort — a browser without the overlay just ignores it.
    this.narrate(sessionID, action, intent)
    // Framework-adaptive (P5, §6.4): before acting on a meta-framework page, wait for hydration —
    // its SSR HTML is inert until JS hydrates. navigate loads a NEW page, so it is exempt.
    if (action.kind !== "navigate") await this.ensureHydrated(sessionID, before)
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

    if (action.kind === "type") {
      // Human-like keystrokes into any typeable field (native-setter path handles React/Vue/
      // Angular controlled inputs — same op the form filler uses). Mark acted so the loop can't
      // re-type the same field and spin; a submit is a separate click action the model plans next.
      const r = await WebAct.perform(sessionID, { op: "type", url: before.url, elementId: action.elementId, text: action.text })
      if (!r.ok) {
        if (!STOP_STATUSES.has(r.status)) Crawl.record(sessionID, Crawl.actionKey(before.url, findEl(before, action.elementId)))
        return { ok: false, status: r.status, effect: STOP_STATUSES.has(r.status) ? "blocked" : "noop" }
      }
      return this.settleAndEffect(sessionID, before.url, beforeSig, "ok")
    }

    // The rest of the human-interaction set — one gated path each (WebAct guards + budgets them).
    if (action.kind === "select" || action.kind === "check" || action.kind === "hover" || action.kind === "scroll" || action.kind === "press") {
      const r = await WebAct.perform(sessionID, {
        op: action.kind,
        url: before.url,
        elementId: "elementId" in action ? action.elementId : undefined,
        value: action.kind === "select" ? action.value : undefined,
        checked: action.kind === "check" ? action.checked : undefined,
        key: action.kind === "press" ? action.key : undefined,
      })
      if (!r.ok) {
        if (!STOP_STATUSES.has(r.status) && "elementId" in action && action.elementId)
          Crawl.record(sessionID, Crawl.actionKey(before.url, findEl(before, action.elementId)))
        return { ok: false, status: r.status, effect: STOP_STATUSES.has(r.status) ? "blocked" : "noop" }
      }
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
      // Each field is filled by the op its control needs — type text, select a dropdown option,
      // toggle a checkbox/radio — so a real form (not just a search box) actually completes.
      const r =
        fill.op === "select"
          ? await WebAct.perform(sessionID, { op: "select", url, elementId: fill.id, value: fill.value })
          : fill.op === "check"
            ? await WebAct.perform(sessionID, { op: "check", url, elementId: fill.id, checked: fill.value !== "false" })
            : await WebAct.perform(sessionID, { op: "type", url, elementId: fill.id, text: fill.value })
      if (!r.ok && STOP_STATUSES.has(r.status)) return "stop"
    }
    const submit = await WebAct.perform(sessionID, { op: "click", url, elementId: form.submitId })
    Crawl.record(sessionID, form.actionKey)
    return !submit.ok && STOP_STATUSES.has(submit.status) ? "stop" : "ok"
  }

  // Push a narration of the next action to the browser overlay (in-page hue/bubble + panel log).
  // Fire-and-forget — never awaited, never throws. `elementId` (for click) lets the overlay
  // highlight the exact target; `intent` is the plan's rationale (the "why").
  private narrate(sessionID: string, action: Action, intent?: string): void {
    const label =
      action.kind === "click"
        ? action.label ?? ""
        : action.kind === "type"
          ? `${action.label ? action.label + ": " : ""}${action.text}`
          : action.kind === "form"
            ? action.form.label
            : action.kind === "navigate"
              ? action.url
              : ""
    const elementId = "elementId" in action ? action.elementId : undefined
    // Cap the rationale so a verbose model can't flood the overlay/panel — one short line is enough.
    const short = (intent ?? "").trim().slice(0, 140)
    void WebControl.send(sessionID, { op: "narrate", act: action.kind, label, elementId, intent: short }, 2000).catch(() => {})
  }

  // Best-effort hydration wait for meta-framework pages, ONCE per page url. A browser that doesn't
  // understand the op, or a timeout, just proceeds — acting slightly early is recoverable (the
  // material-change re-plan catches the post-hydration DOM). Never throws.
  private async ensureHydrated(sessionID: string, snapshot: PageSnapshot): Promise<void> {
    if (!ExecStrategy.forTech(snapshot.tech).waitHydrated) return
    const key = `${sessionID}\n${snapshot.url}`
    if (this.hydrated.has(key)) return
    this.hydrated.add(key)
    const ms = this.cfg.hydrateMs ?? DEFAULT_HYDRATE_MS
    await WebControl.send(sessionID, { op: "wait", until: "hydrated", timeoutMs: ms }, ms + 500).catch(() => {})
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
