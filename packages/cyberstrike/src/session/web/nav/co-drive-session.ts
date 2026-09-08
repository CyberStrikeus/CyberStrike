// CoDriveSession — the OO orchestrator (design §2.3). observe → (re)plan on material change →
// execute each planned action through the guarded executor → backtrack via the frontier → stop.
// It owns NO policy and NO decision: the Navigator decides, the Guardrails bound, the Executor
// acts. Collaborators are injected (DI) so every LLM/browser touch is stubbable in tests.
//
// Driven in production by LlmNavigator (withLlm) via the CoDrive runner, which the /web/driver
// route starts/stops; DeterministicNavigator (withDefaults) is the no-model fallback + test brain.
import type { Observer, Navigator, Executor, Plan, StopReason, ActionResult, PageSnapshot } from "./types"
import { snapshotSignature } from "./types"
import { Guardrails } from "./guardrails"
import { PageStateObserver } from "./guardrails"
import { WebControl } from "../control"
import { DeterministicNavigator } from "./deterministic-navigator"
import { LlmNavigator } from "./llm-navigator"
import { ExhaustiveNavigator } from "./exhaustive-navigator"
import { WebActExecutor } from "./web-act-executor"
import { Crawl } from "../crawl"
import { WebScope } from "../scope"
import { WebHold } from "../hold"
import { HBLog } from "../hblog"
import { Log } from "../../../util/log"

const log = Log.create({ service: "co-drive" })
const STOP_EFFECT: Record<string, StopReason> = {
  "human-driving": "human-took-over",
  "no-extension": "no-extension-connected",
  budget: "budget-exhausted",
}

export interface CoDriveDeps {
  observer: Observer
  navigator: Navigator
  executor: Executor
  guardrails: Guardrails
}
export interface CoDriveConfig {
  pollMs: number
  maxIdle: number
}

export class CoDriveSession {
  // `revisitOnNavAway`: when a mid-plan action navigates away, re-queue the page we left so the
  // loop returns to exercise its remaining un-acted controls (SPA list→detail→back→next-row).
  // Only safe when the navigator tracks acted controls and re-plans deterministically on return
  // (ExhaustiveNavigator) — off for the LLM brain, which decides for itself when a page is done.
  constructor(
    private readonly deps: CoDriveDeps,
    private readonly cfg: CoDriveConfig,
    private readonly revisitOnNavAway = false,
  ) {}

  // Wire the DETERMINISTIC collaborators — the no-model brain. This is the safe default used as
  // the fallback shape and in tests (fast, no live model). Production uses withLlm().
  static withDefaults(cfg?: Partial<CoDriveConfig> & { settleMs?: number }): CoDriveSession {
    return CoDriveSession.build(new DeterministicNavigator(), cfg)
  }

  // Wire the LLM brain (P3) — the MAIN model plans over the full rich observation, with the
  // deterministic navigator as its own internal fallback. This is what production runs.
  static withLlm(cfg?: Partial<CoDriveConfig> & { settleMs?: number }): CoDriveSession {
    return CoDriveSession.build(new LlmNavigator(), cfg)
  }

  // 1.1.16-style EXHAUSTIVE breadth: deterministically exercise EVERY interactive control on every
  // page so the browser triggers each endpoint and the capture layer records its REAL request body
  // (the only way to get a POST's payload — JS mining gives shape, not body). `aggressive` also
  // fires destructive controls (reset/delete/bulk-action) to capture their bodies — it MUTATES the
  // target, so it is an explicit opt-in, never the default. Logout is always skipped.
  static withExhaustive(aggressive: boolean, cfg?: Partial<CoDriveConfig> & { settleMs?: number }): CoDriveSession {
    // Exhaustive breadth is the one mode that wants revisit-on-nav-away: its deterministic
    // navigator re-plans each returned-to page and skips acted controls, so the list→detail→back
    // loop terminates cleanly (one more row per return) instead of the LLM re-deciding each time.
    return CoDriveSession.build(new ExhaustiveNavigator(aggressive), cfg, aggressive, true)
  }

  private static build(
    navigator: Navigator,
    cfg?: Partial<CoDriveConfig> & { settleMs?: number },
    aggressive = false,
    revisitOnNavAway = false,
  ): CoDriveSession {
    const settleMs = cfg?.settleMs ?? 1500
    const pollMs = cfg?.pollMs ?? 400
    return new CoDriveSession(
      {
        observer: new PageStateObserver(),
        navigator,
        executor: new WebActExecutor({ settleMs, pollMs, aggressive }),
        guardrails: new Guardrails(),
      },
      // Be patient waiting for the FIRST observation: the browser + first page can take much
      // longer than a few polls to load, and if the loop gives up it does NOT auto-restart (only a
      // driver toggle does) — which is why "AI" felt dead until a Human→AI toggle. ~60s at 400ms.
      { pollMs, maxIdle: cfg?.maxIdle ?? 150 },
      revisitOnNavAway,
    )
  }

  // Runs until a terminal condition; returns why it stopped. `alive` lets a caller cancel
  // (e.g. the driver toggled to human) between steps.
  async run(sessionID: string, alive: () => boolean = () => true): Promise<StopReason> {
    let idle = 0
    let plan: Plan | null = null
    let planIdx = 0
    let reason: StopReason = "stopped"
    // Idle-watch: the page signature we had when we exhausted everything reachable. Non-null means
    // "nothing left to do — watch and wait". Cleared the instant the page changes materially (login
    // completes, a dashboard finishes loading, the user navigates) so the crawl resumes on its own
    // instead of dying on a transient login/no-access page and needing a manual restart. `quiet`
    // counts consecutive unchanged observations while watching; after maxIdle of them we accept a
    // genuine coverage-complete and end — so a finite site (and every test) still terminates.
    let exhaustedSig: string | null = null
    let quiet = 0

    while (alive()) {
      const term = this.deps.guardrails.terminal(sessionID)
      if (term) {
        reason = term
        break
      }
      // Transient pause while the user engages the panel — hold WITHOUT acting so the page stays
      // put (a full-page nav would wipe the panel out from under them). Non-terminal: resume when
      // released. Checked after the terminal guards so human/no-extension/budget still end the run.
      if (WebHold.held(sessionID)) {
        await sleep(this.cfg.pollMs)
        continue
      }
      const snapshot = this.deps.observer.observe(sessionID)
      if (!snapshot) {
        if (++idle > this.cfg.maxIdle) {
          reason = "no-page-observed"
          break
        }
        await sleep(this.cfg.pollMs)
        continue
      }
      idle = 0
      Crawl.markPage(sessionID, snapshot.url)
      WebScope.ensure(sessionID, snapshot.url)
      // Remember discovered in-scope targets so a dead end can backtrack.
      Crawl.discover(sessionID, snapshot.links.filter((u) => WebScope.allowed(sessionID, u)))

      // Idle-watch gate: if we already exhausted everything, keep observing WITHOUT acting until the
      // page changes. Same page/sig ⇒ still nothing to do; poll again, and after maxIdle unchanged
      // polls accept coverage-complete and end (so a finite site terminates). A material change (new
      // URL or new controls) ⇒ clear the flag and fall through to re-plan — the crawl resumes itself.
      if (exhaustedSig !== null) {
        if (exhaustedSig === sigOf(snapshot)) {
          if (++quiet > this.cfg.maxIdle) {
            reason = "coverage-complete"
            break
          }
          await sleep(this.cfg.pollMs)
          continue
        }
        exhaustedSig = null
        quiet = 0
        plan = null
      }

      // (Re)plan when there is no live plan or the current one is spent (§3.4 folds in via effect).
      if (!plan || planIdx >= plan.actions.length) {
        // Show a "thinking" cue on the browser overlay while the model plans (the biggest visible
        // gap) so the pause reads as deliberate, not frozen. Fire-and-forget; a fast/deterministic
        // navigator just replaces it immediately with the first action's narration.
        void WebControl.send(sessionID, { op: "narrate", act: "thinking", intent: "" }, 2000).catch(() => {})
        plan = await this.deps.navigator.plan(sessionID, snapshot)
        planIdx = 0
        HBLog.record(sessionID, "codrive", "plan", { rationale: plan.rationale, actions: plan.actions.length })
        if (plan.actions.length === 0) {
          const next = Crawl.takeFrontier(sessionID)
          if (!next) {
            // Nothing left to visit — but do NOT end. Enter idle-watch: remember what "done" looked
            // like and keep observing. If the page later changes (login lands, dashboard hydrates,
            // user navigates), the gate above resumes the crawl. Only human/no-extension/budget end.
            exhaustedSig = sigOf(snapshot)
            await sleep(this.cfg.pollMs)
            continue
          }
          // Mark the REQUESTED url visited now — a url that redirects (or client-routes) to a
          // different landed url would otherwise never be marked (only the landed url is), so
          // discover() would re-add it every observe and the frontier would spin forever
          // (exhaustive mode drains the frontier hard, which is what surfaced this).
          Crawl.markPage(sessionID, next)
          const nav = await this.deps.executor.run(sessionID, { kind: "navigate", url: next }, snapshot, "backtracking to an unexplored page")
          const stop = terminalFrom(nav)
          if (stop) {
            reason = stop
            break
          }
          plan = null
          continue
        }
      }

      const action = plan.actions[planIdx++]
      if (action.kind === "done") {
        // The LLM judges the app "fully explored" — but that judgment must not override the
        // deterministic frontier. Discovered-but-unvisited pages (Crawl.frontier) would be
        // silently dropped if we broke here, leaving endpoints never visited/tested. So treat
        // `done` exactly like an exhausted plan: drain the frontier first, and only accept
        // coverage-complete when there is genuinely nothing left to visit.
        const next = Crawl.takeFrontier(sessionID)
        if (!next) {
          // Like the empty-plan branch: nothing left, but don't end — idle-watch and resume on change.
          exhaustedSig = sigOf(snapshot)
          await sleep(this.cfg.pollMs)
          continue
        }
        Crawl.markPage(sessionID, next) // see the empty-plan branch: prevents a redirecting url re-entering the frontier
        const nav = await this.deps.executor.run(
          sessionID,
          { kind: "navigate", url: next },
          snapshot,
          "LLM signalled done, but unvisited pages remain — backtracking to cover them",
        )
        const stop = terminalFrom(nav)
        if (stop) {
          reason = stop
          break
        }
        plan = null
        continue
      }
      if (!alive()) {
        reason = "stopped"
        break
      }
      HBLog.record(sessionID, "codrive", "act", {
        kind: action.kind,
        label: action.kind === "click" ? action.label : action.kind === "form" ? action.form.label : action.kind === "navigate" ? action.url : "",
        url: snapshot.url,
      })
      const result = await this.deps.executor.run(sessionID, action, snapshot, plan.rationale)
      const stop = terminalFrom(result)
      if (stop) {
        reason = stop
        break
      }
      // Material change ⇒ re-plan next iteration; a no-op advances to the next queued action.
      // EXCEPTION: input actions (type/select/check/press) are the steps of a deliberate sequence
      // — fill email, fill password, submit. Typing mutates the DOM (validation UI, controlled-input
      // re-render) which reads as "revealed", but that must NOT abort the queued follow-up steps or
      // the crawler re-plans after every keystroke and re-fills the first field forever. Only a real
      // navigation re-plans an input action; click/hover keep re-planning on revealed (new UI opened).
      const inputAction =
        action.kind === "type" || action.kind === "select" || action.kind === "check" || action.kind === "press"
      if (result.effect === "navigated") {
        // We navigated away mid-plan — typically a SPA list row that client-routed to its detail
        // page. Every action still queued (planIdx..end) belongs to the page we just left and is
        // about to be dropped by the re-plan. Re-queue that page so, once the frontier drains, the
        // loop returns and the navigator picks the NEXT un-acted control: list → detail (capture
        // its deep GET/POST endpoints with real bodies) → back → next row, until the list is spent.
        if (this.revisitOnNavAway && planIdx < plan.actions.length) Crawl.revisit(sessionID, snapshot.url)
        plan = null
      } else if (result.effect === "revealed" && !inputAction) {
        // Same-URL reveal (a panel/modal opened in place, no route change): just re-plan the
        // current page — the navigator naturally moves to the next un-acted control there.
        plan = null
      }
    }

    HBLog.record(sessionID, "codrive", "stop", { reason, actions: Crawl.summary(sessionID).actions, pages: Crawl.summary(sessionID).pages_visited })
    log.info("stop", { sessionID, reason })
    return reason
  }
}

// Stable identity of a page for idle-watch change-detection: url + form count + sorted control
// keys (snapshotSignature already folds the url in). Deliberately NOT time-based, so re-observing
// an unchanged page yields the same string and idle-watch can tell "still nothing" from "changed".
function sigOf(snapshot: PageSnapshot): string {
  return snapshotSignature(snapshot)
}

function terminalFrom(result: ActionResult): StopReason | null {
  if (result.ok) return null
  return STOP_EFFECT[result.status] ?? null
}
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
