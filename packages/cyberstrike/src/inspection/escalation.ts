import { Bus } from "@/bus"
import { Log } from "@/util/log"
import { withTimeout } from "@/util/timeout"
import { Session } from "@/session"
import { SessionPrompt } from "@/session/prompt"
import { Vulnerability } from "@/session/vulnerability"
import { Instance } from "@/project/instance"
import { InspectionTranscript } from "./transcript"
import { EscalationFrontier } from "./escalation-frontier"
import { EscalationCatalog } from "./escalation-catalog"

const log = Log.create({ service: "escalation-runner" })

// Debounce window: findings arrive in bursts (specialists reporting), so wait this long after the last
// one before running a pass — one pass covers the batch instead of one per finding.
const DEBOUNCE_MS = Math.max(0, Number(process.env.CYBERSTRIKE_ESCALATION_DEBOUNCE_MS) || 6000)
// Per-hunt ceiling — a hunt pass that hasn't finished in this long is cancelled; its seeds stay
// un-examined and are re-hunted next pass (the coverage guarantee holds through a stalled hunt).
const HUNT_TIMEOUT_MS = Math.max(0, Number(process.env.CYBERSTRIKE_ESCALATION_TIMEOUT_MS) || 1_800_000)
const HUNTER_AGENT = "escalation-hunter"

// Code-enforced escalation coverage (#84). The hunter reasons with its prompt, but the GUARANTEE that
// every finding enters a pass lives HERE, not in the prompt:
//   - pendingEscalation() returns findings not yet escalation-examined (a DB column).
//   - a pass dispatches the hunter with EXACTLY those findings as seeds.
//   - markEscalationExamined() is called ONLY after the pass completes — so a finding is marked covered
//     only once a hunt that actually had it in scope finished. A crash/timeout leaves it pending ⇒ re-hunted.
//   - findings that arrive mid-pass re-arm the runner, so none is ever silently skipped.
export class EscalationRunner {
  readonly sessionID: string
  private running = false
  private dirty = false
  private timer: ReturnType<typeof setTimeout> | undefined

  constructor(sessionID: string) {
    this.sessionID = sessionID
  }

  get active(): boolean {
    return this.running
  }

  // Debounced wake: a new finding (or drain) nudges a pass. Coalesces a burst into one scheduled pass.
  wake(): void {
    if (process.env.CYBERSTRIKE_INGEST_DRY_RUN === "true") return
    if (this.running) {
      this.dirty = true
      return
    }
    if (this.timer) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      void this.run()
    }, DEBOUNCE_MS)
  }

  private async run(): Promise<void> {
    if (this.running) {
      this.dirty = true
      return
    }
    this.running = true
    try {
      while (true) {
        this.dirty = false
        const pending = Vulnerability.pendingEscalation(this.sessionID)
        const seedIDs = pending.map((v) => v.id).filter((id): id is string => !!id)
        if (seedIDs.length === 0) return
        const before = seedIDs.join(",")
        await this.hunt(seedIDs).catch((e) =>
          // Only a PRE-dispatch failure (Session.create / recordDispatch) throws here; the seeds stay
          // pending so the next wake retries. A dispatched hunt marks its seeds in hunt()'s finally.
          log.warn("escalation hunt could not dispatch (seeds stay pending)", { sessionID: this.sessionID, err: String(e) }),
        )
        // No-progress guard: if the same seeds are STILL pending and nothing new arrived, stop this run
        // — a persistent pre-dispatch failure must not tight-loop. The next external wake (a new finding
        // or the inspection drain) retries. Progress (seeds cleared) or new findings → keep going.
        const after = Vulnerability.pendingEscalation(this.sessionID).map((v) => v.id).filter((id): id is string => !!id).join(",")
        if (!this.dirty && (after === "" || after === before)) return
      }
    } finally {
      this.running = false
      // A finding that arrived in the narrow race between the last dirty check and here → one more pass.
      // (Stuck seeds are NOT re-armed here — they wait for an external wake — so there is no tight loop.)
      if (this.dirty) this.wake()
    }
  }

  // One hunt pass over a fixed seed set. Runs the escalation-hunter as a child session so it is
  // inline-navigable in the root transcript (post-#78) and the root agent is aware of it. CODE-ENFORCED
  // coverage: the seeds are marked examined in the `finally` — i.e. once the hunter has been DISPATCHED
  // and run (success OR error), the findings have "entered a pass". A PRE-dispatch failure (Session
  // create / recordDispatch) throws out before the finally, leaving the seeds pending for a retry.
  private async hunt(seedIDs: string[]): Promise<void> {
    const model = await SessionPrompt.lastModel(this.sessionID)
    const child = await Session.create({
      parentID: this.sessionID,
      title: `Escalation hunt (${seedIDs.length} finding${seedIDs.length === 1 ? "" : "s"})`,
    })
    await InspectionTranscript.recordDispatch({
      sessionID: this.sessionID,
      childSessionID: child.id,
      agent: HUNTER_AGENT,
      label: `Escalation hunt · ${seedIDs.length} finding${seedIDs.length === 1 ? "" : "s"}`,
      model,
    })
    // Code-seed the hunt's frontier from the escalation catalog × the session's findings (P2): the
    // obvious chains are enqueued (deduped, budget-bounded) BEFORE the model starts, so none is missed;
    // the model then works them via propose_escalation and extends with its own.
    const seeded = EscalationFrontier.seed(child.id, EscalationCatalog.seeds(Vulnerability.get(this.sessionID)))
    const run = SessionPrompt.prompt({ sessionID: child.id, agent: HUNTER_AGENT, model, parts: [{ type: "text", text: this.brief(seedIDs, seeded) }] })
    run.catch(() => {})
    try {
      if (HUNT_TIMEOUT_MS <= 0) await run
      else
        await withTimeout(run, HUNT_TIMEOUT_MS, () => {
          log.warn("escalation hunt timed out — cancelling child", { child: child.id, sessionID: this.sessionID })
          SessionPrompt.cancel(child.id)
        })
      void InspectionTranscript.completeDispatch(child.id, "hunted")
    } catch (e) {
      void InspectionTranscript.completeDispatch(child.id, "failed")
      log.warn("escalation hunt errored — seeds still counted (the pass ran)", { sessionID: this.sessionID, err: String(e) })
    } finally {
      Vulnerability.markEscalationExamined(this.sessionID, seedIDs)
      EscalationFrontier.clear(child.id)
    }
  }

  // The seed brief: the findings this pass MUST consider, with the context the hunter needs to chain +
  // escalate. The prompt holds the methodology; this gives it the concrete substrate.
  private brief(seedIDs: string[], seeded: number): string {
    const seeds = new Set(seedIDs)
    const all = Vulnerability.get(this.sessionID)
    const target = all.filter((v) => !!v.id && seeds.has(v.id))
    const lines: string[] = [
      "# Escalation hunt — seeds",
      "",
      "These confirmed findings have NOT yet been through an escalation pass. Consider EVERY one: chain it,",
      "escalate its impact toward crown-jewel outcomes, and construct+verify new attacks across the corpus.",
      "You also have the full finding set + the whole traffic corpus (vortex_query/where_value/cross_role).",
      "",
    ]
    for (const v of target) {
      lines.push(
        `- ${v.ref ?? ""} [${v.severity}] ${v.title}` +
          (v.endpoint ? ` — ${v.endpoint}` : "") +
          (v.evidence_request_ids?.length ? ` (evidence: ${v.evidence_request_ids.join(", ")})` : "") +
          `  {id: ${v.id}}`,
      )
    }
    if (seeded > 0) {
      lines.push(
        "",
        `The frontier is PRE-SEEDED with ${seeded} candidate chain(s) the catalog matched from these findings.`,
        "Start by calling propose_escalation (with your own best idea) — it will hand you the highest-impact",
        "item to work (a pre-seed or yours). Work each, confirm by replay, and propose follow-ups.",
      )
    }
    lines.push("", `Total findings in session: ${all.length}. Report each CONFIRMED escalation with its full chain + impact delta.`)
    return lines.join("\n")
  }

  // ── Registry + static trigger ────────────────────────────────────────────────────────────────────
  private static runners = new Map<string, EscalationRunner>()

  static register(runner: EscalationRunner): void {
    EscalationRunner.runners.set(runner.sessionID, runner)
  }
  static unregister(sessionID: string): void {
    const r = EscalationRunner.runners.get(sessionID)
    if (r?.timer) clearTimeout(r.timer)
    EscalationRunner.runners.delete(sessionID)
  }

  // Wake the right session's runner whenever findings change (findings arrive ⇒ escalate). Scoped to
  // registered runners so it is a no-op for sessions without inspection running.
  private static subscription = Instance.state(() => {
    Bus.subscribe(Vulnerability.Event.Updated, (e) => {
      EscalationRunner.runners.get(e.properties.sessionID)?.wake()
    })
    return {}
  })

  static start(): void {
    EscalationRunner.subscription()
  }
}
