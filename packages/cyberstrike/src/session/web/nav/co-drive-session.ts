// CoDriveSession — the OO orchestrator (design §2.3). observe → (re)plan on material change →
// execute each planned action through the guarded executor → backtrack via the frontier → stop.
// It owns NO policy and NO decision: the Navigator decides, the Guardrails bound, the Executor
// acts. Collaborators are injected (DI) so every LLM/browser touch is stubbable in tests.
//
// Driven in production by LlmNavigator (withLlm) via the CoDrive runner, which the /web/driver
// route starts/stops; DeterministicNavigator (withDefaults) is the no-model fallback + test brain.
import type { Observer, Navigator, Executor, Plan, StopReason, ActionResult } from "./types"
import { Guardrails } from "./guardrails"
import { PageStateObserver } from "./guardrails"
import { DeterministicNavigator } from "./deterministic-navigator"
import { LlmNavigator } from "./llm-navigator"
import { WebActExecutor } from "./web-act-executor"
import { Crawl } from "../crawl"
import { WebScope } from "../scope"
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
  constructor(private readonly deps: CoDriveDeps, private readonly cfg: CoDriveConfig) {}

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

  private static build(navigator: Navigator, cfg?: Partial<CoDriveConfig> & { settleMs?: number }): CoDriveSession {
    const settleMs = cfg?.settleMs ?? 1500
    const pollMs = cfg?.pollMs ?? 400
    return new CoDriveSession(
      {
        observer: new PageStateObserver(),
        navigator,
        executor: new WebActExecutor({ settleMs, pollMs }),
        guardrails: new Guardrails(),
      },
      { pollMs, maxIdle: cfg?.maxIdle ?? 8 },
    )
  }

  // Runs until a terminal condition; returns why it stopped. `alive` lets a caller cancel
  // (e.g. the driver toggled to human) between steps.
  async run(sessionID: string, alive: () => boolean = () => true): Promise<StopReason> {
    let idle = 0
    let plan: Plan | null = null
    let planIdx = 0
    let reason: StopReason = "stopped"

    while (alive()) {
      const term = this.deps.guardrails.terminal(sessionID)
      if (term) {
        reason = term
        break
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

      // (Re)plan when there is no live plan or the current one is spent (§3.4 folds in via effect).
      if (!plan || planIdx >= plan.actions.length) {
        plan = await this.deps.navigator.plan(sessionID, snapshot)
        planIdx = 0
        HBLog.record(sessionID, "codrive", "plan", { rationale: plan.rationale, actions: plan.actions.length })
        if (plan.actions.length === 0) {
          const next = Crawl.takeFrontier(sessionID)
          if (!next) {
            reason = "coverage-complete"
            break
          }
          const nav = await this.deps.executor.run(sessionID, { kind: "navigate", url: next }, snapshot)
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
        reason = "coverage-complete"
        break
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
      const result = await this.deps.executor.run(sessionID, action, snapshot)
      const stop = terminalFrom(result)
      if (stop) {
        reason = stop
        break
      }
      // Material change (navigation / new content) ⇒ re-plan next iteration; a no-op just advances
      // to the next action already queued in the current plan.
      if (result.effect === "navigated" || result.effect === "revealed") plan = null
    }

    HBLog.record(sessionID, "codrive", "stop", { reason, actions: Crawl.summary(sessionID).actions, pages: Crawl.summary(sessionID).pages_visited })
    log.info("stop", { sessionID, reason })
    return reason
  }
}

function terminalFrom(result: ActionResult): StopReason | null {
  if (result.ok) return null
  return STOP_EFFECT[result.status] ?? null
}
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
