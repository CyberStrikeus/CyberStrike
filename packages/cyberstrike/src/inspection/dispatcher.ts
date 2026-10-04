import { Bus } from "@/bus"
import { Log } from "@/util/log"
import { withTimeout } from "@/util/timeout"
import { Session } from "@/session"
import { SessionPrompt } from "@/session/prompt"
import { Instance } from "@/project/instance"
import type { InspectionRouter } from "@cyberstrike-io/plugin"
import { InspectionQueue } from "./queue"
import { InspectionActivity } from "./activity"
import { InspectionTranscript } from "./transcript"

const log = Log.create({ service: "inspection-dispatcher" })

const CONCURRENCY = Math.max(1, Number(process.env.CYBERSTRIKE_INSPECTION_CONCURRENCY) || 3)
// Per-dispatch ceiling: a specialist child-session that hasn't finished in this long is treated as
// hung (same no-timeout stall as the parent loop) — it's cancelled and the item retried. Enabled by
// default now (was 0/disabled) so a hung child can't park the drain loop forever (issue #38).
const DISPATCH_TIMEOUT_MS = Math.max(0, Number(process.env.CYBERSTRIKE_INSPECTION_DISPATCH_TIMEOUT_MS) || 1_200_000)
// Lease TTL for the in-flight "dispatched" state. An item still dispatched past this — because the
// dispatcher crashed/restarted mid-flight, so no runItem is around to resolve it — is reclaimed to
// pending and re-driven. Kept longer than the dispatch timeout so a live dispatch is never yanked.
const DISPATCH_LEASE_MS = Math.max(0, Number(process.env.CYBERSTRIKE_INSPECTION_DISPATCH_LEASE_MS) || 1_800_000)
// After this many all-specialists-failed attempts, give up on a target (mark examined) so a
// permanently failing endpoint can't retry-loop forever.
const MAX_DISPATCH_ATTEMPTS = Math.max(1, Number(process.env.CYBERSTRIKE_INSPECTION_MAX_ATTEMPTS) || 2)
// Backstop poll for the drain loop. New work is normally picked up by push (wake → notify) the instant
// it is flagged, and a freed slot by the in-flight task resolving; this interval is only a safety net
// so the loop can never wedge on a missed signal. Kept long because it is not the primary trigger.
const DRAIN_POLL_MS = Math.max(50, Number(process.env.CYBERSTRIKE_INSPECTION_DRAIN_POLL_MS) || 2000)

export class InspectionDispatcher {
  private readonly queue: InspectionQueue
  private readonly router: InspectionRouter
  private running = false
  // Called once the queue has fully drained (no pending items, loop finished) — the seam the auto-triage
  // runner hooks so it can finalize draft findings before the lifecycle reaches "complete" (#41).
  onDrain: (() => void) | undefined
  // Per-target failed-attempt counter (in-memory; a restart resets it, which is fine — worst case a
  // target gets a couple extra retries after a restart). Bounds the retry loop (issue #38).
  private readonly attempts = new Map<string, number>()
  // Event-driven wake plumbing (#80): `notify` resolves the drain loop's wait the instant a new item is
  // flagged while it is already running (push, not a 500ms poll); `dirty` captures a flag that lands
  // between the loop's top-up and the point it starts waiting, so no wakeup is ever lost.
  private notify: (() => void) | null = null
  private dirty = false

  constructor(queue: InspectionQueue, router: InspectionRouter) {
    this.queue = queue
    this.router = router
  }

  // True while a drain loop is in flight — it stays true for the WHOLE duration that dispatched
  // specialist child-sessions are running (the loop only returns once nothing is in flight and nothing
  // is pending). Fed to the SessionLifecycle as an activity source so "complete" waits for the
  // specialists to finish, not merely for the queue to be dispatched (#19).
  get active(): boolean {
    return this.running
  }

  wake(): void {
    // Dry-run (the ingest test flag) means "don't actually run agents" — leave the queue pending so
    // coverage/assertions see it, and never spawn a child session (no live LLM calls in tests).
    if (process.env.CYBERSTRIKE_INGEST_DRY_RUN === "true") return
    if (this.running) {
      // The loop is already draining — a new item was just flagged. Push it through immediately:
      // mark dirty (so a flag that lands mid-top-up isn't lost) and resolve the loop's wait so it
      // re-reads and claims the new item into any free slot NOW, without waiting on the backstop poll.
      this.dirty = true
      this.notify?.()
      return
    }
    this.running = true
    void this.loop()
      .catch((e) => log.error("inspection loop crashed", { sessionID: this.queue.sessionID, domain: this.queue.domain, err: String(e) }))
      .finally(() => {
        this.running = false
        // Re-arm against a lost wakeup: an item flagged in the window between the loop's last
        // empty-check and here hit `if (this.running) return` above and was dropped. If anything is
        // still pending, drain again. Safe from looping — every drained item is marked examined.
        if (this.queue.pending().length > 0) this.wake()
        // Fully drained → let the auto-triage runner finalize any draft findings (#41). Synchronous, so
        // its `active` flag is set before the lifecycle next evaluates "complete".
        else this.onDrain?.()
      })
  }

  private async loop(): Promise<void> {
    const model = await SessionPrompt.lastModel(this.queue.sessionID)
    // Continuous, EVENT-DRIVEN worker pool (#80): keep up to CONCURRENCY specialists IN FLIGHT and claim
    // the next pending item the instant a slot frees OR a new item is flagged (wake → notify) — not a
    // per-pass batch barrier, and not a bare poll. A slow specialist (e.g. an injection run doing active
    // probing) must never park newly-flagged endpoints or leave slots idle, which matters now that this
    // dispatcher is the SOLE trigger for specialists (#78). `inflight.size` is the concurrency gate.
    const inflight = new Set<Promise<void>>()
    while (true) {
      // Clear the dirty flag BEFORE reading the queue: any wake() from here until we start waiting sets
      // it again, so a flag that lands during the (async) top-up is never lost.
      this.dirty = false
      // Re-open any lease left dangling by a crashed/restarted drain before reading pending (issue #38).
      this.queue.reclaimStale(DISPATCH_LEASE_MS)
      // Top up to CONCURRENCY in flight. markDispatched removes a claimed item from pending(), so this
      // never re-claims one already running; no-agent items are drained immediately so they don't park
      // the queue. Claims are bounded to CONCURRENCY, so a huge backlog never balloons the lease set.
      while (inflight.size < CONCURRENCY) {
        const item = this.queue.pending()[0]
        if (!item) break
        const target = { key: item.target_key, label: item.target_label ?? item.target_key, meta: item.target_meta ?? {} }
        const agents = await this.router.resolve(target, this.queue.evidenceFor(item.target_key))
        // No applicable specialist → nothing to inspect; drain it so it doesn't park the queue in
        // "draining" forever (which would mean "complete" — and its webhook — never fires). #19.
        if (agents.length === 0) {
          this.queue.markExamined(item.target_key)
          continue
        }
        // Claim as in-flight (pending → dispatched) BEFORE running: it leaves pending() so a concurrent
        // re-read can't dispatch it twice, but stays outstanding in count() so the lifecycle won't
        // report "complete" mid-flight. Marked examined only once its specialists actually finish
        // (runItem) — never at triage — so a stall/failure is recoverable (#38).
        this.queue.markDispatched(item.target_key)
        const task = this.runItem(item, agents, model)
        inflight.add(task)
        void task.finally(() => inflight.delete(task))
      }
      if (inflight.size === 0) {
        // Nothing running; a flag may have landed during top-up (dirty) or between the read and here.
        if (this.dirty || this.queue.pending().length > 0) continue
        return // clean drain → onDrain/auto-triage fires
      }
      // A flag arrived during top-up and there is still a free slot → re-read NOW, don't wait.
      if (this.dirty && inflight.size < CONCURRENCY) continue
      // Otherwise wait until a specialist finishes (a slot frees) OR a new item is flagged (wake resolves
      // `notify`, so a free slot picks it up immediately — no poll latency). DRAIN_POLL_MS is only a
      // backstop safety net against a missed signal, not the primary trigger.
      await Promise.race([
        ...inflight,
        new Promise<void>((resolve) => {
          this.notify = resolve
        }),
        new Promise<void>((resolve) => setTimeout(resolve, DRAIN_POLL_MS)),
      ])
      this.notify = null
    }
  }

  // Run every specialist for one claimed (dispatched) item, then resolve its lease: examined on any
  // success; a bounded retry (reset to pending) when all failed; give up (examined) past the attempt
  // cap so a permanently-failing target can't retry-loop forever (issue #38).
  private async runItem(
    item: InspectionQueue.Info,
    agents: string[],
    model: { providerID: string; modelID: string },
  ): Promise<void> {
    const results = await Promise.allSettled(agents.map((agent) => this.runOne(item, agent, model)))
    const anyOk = results.some((r) => r.status === "fulfilled")
    if (anyOk) {
      this.attempts.delete(item.target_key)
      this.queue.markExamined(item.target_key)
      this.emitExamined(item, "done")
      return
    }
    const n = (this.attempts.get(item.target_key) ?? 0) + 1
    this.attempts.set(item.target_key, n)
    if (n >= MAX_DISPATCH_ATTEMPTS) {
      this.attempts.delete(item.target_key)
      log.warn("inspection dispatch giving up after retries — marking examined", { target: item.target_key, attempts: n })
      this.queue.markExamined(item.target_key)
      this.emitExamined(item, "gave-up")
      return
    }
    log.warn("inspection dispatch failed — re-queueing for retry", { target: item.target_key, attempt: n })
    this.queue.resetToPending(item.target_key)
  }

  // Activity feed (#81): an endpoint finished being inspected — surface the outcome in the root session.
  private emitExamined(item: InspectionQueue.Info, outcome: "done" | "gave-up"): void {
    InspectionActivity.emit({
      sessionID: this.queue.sessionID,
      domain: this.queue.domain,
      kind: "examined",
      target: item.target_key,
      label: item.target_label ?? item.target_key,
      outcome,
    })
  }

  // One specialist dispatch under the concurrency semaphore. Throws on failure/timeout so runItem's
  // allSettled sees a rejection (which is how "all failed → retry" is detected).
  private async runOne(
    item: InspectionQueue.Info,
    agent: string,
    model: { providerID: string; modelID: string },
  ): Promise<void> {
    await this.dispatch(item, agent, model)
  }

  private async dispatch(
    item: InspectionQueue.Info,
    agentName: string,
    model: { providerID: string; modelID: string },
  ): Promise<void> {
    const target = { key: item.target_key, label: item.target_label ?? item.target_key, meta: item.target_meta ?? {} }
    const evidence = this.queue.evidenceFor(item.target_key)
    const promptText = this.router.prompt(target, evidence, agentName)
    const child = await Session.create({
      parentID: this.queue.sessionID,
      title: `Inspect ${item.target_label ?? item.target_key} (@${agentName})`.trim(),
    })
    // Inline navigable dispatch entry in the ROOT transcript (#78 follow-up): the specialist now shows
    // up in the root session as a `task` entry the user can ENTER, and the root agent sees what was
    // dispatched. Awaited (a quick DB write) so the entry exists before `complete` below; graceful — it
    // never throws, and the dispatch execution path is untouched (#80).
    await InspectionTranscript.recordDispatch({
      sessionID: this.queue.sessionID,
      childSessionID: child.id,
      agent: agentName,
      label: item.target_label ?? item.target_key,
      model,
    })
    const finish = (outcome: string) => void InspectionTranscript.completeDispatch(child.id, outcome)
    const parts = await SessionPrompt.resolvePromptParts(promptText)
    const run = SessionPrompt.prompt({ sessionID: child.id, agent: agentName, model, parts })
    if (DISPATCH_TIMEOUT_MS <= 0) {
      try {
        await run
        finish("examined")
      } catch (e) {
        finish("failed")
        throw e
      }
      return
    }
    // On timeout, cancel the hung child (withTimeout only rejects the wrapper — it does NOT abort the
    // underlying run), so a stalled specialist is actually stopped before the item is retried (#38).
    // withTimeout only wires a `.then` onto `run`, so once the wrapper has rejected on timeout the
    // orphaned `run` can still settle on its own — a post-cancel rejection would then be unhandled.
    // Attach a no-op catch to swallow that late settlement.
    run.catch(() => {})
    try {
      await withTimeout(run, DISPATCH_TIMEOUT_MS, () => {
        log.warn("inspection dispatch timed out — cancelling child", {
          child: child.id,
          target: item.target_key,
          agent: agentName,
          ms: DISPATCH_TIMEOUT_MS,
        })
        SessionPrompt.cancel(child.id)
      })
      finish("examined")
    } catch (e) {
      finish("timed out / failed")
      throw e
    }
  }

  // ── Static: auto-wake subscription ────────────────────────────────

  private static dispatchers = new Map<string, InspectionDispatcher>()

  static register(dispatcher: InspectionDispatcher): void {
    const key = `${dispatcher.queue.sessionID}:${dispatcher.queue.domain}`
    InspectionDispatcher.dispatchers.set(key, dispatcher)
  }

  static unregister(sessionID: string, domain: string): void {
    InspectionDispatcher.dispatchers.delete(`${sessionID}:${domain}`)
  }

  private static subscription = Instance.state(() => {
    Bus.subscribe(InspectionQueue.Event.Updated, (e) => {
      if (e.properties.queue.length === 0) return
      const key = `${e.properties.sessionID}:${e.properties.domain}`
      const d = InspectionDispatcher.dispatchers.get(key)
      if (d) d.wake()
    })
    return {}
  })

  static start(): void {
    InspectionDispatcher.subscription()
  }
}
