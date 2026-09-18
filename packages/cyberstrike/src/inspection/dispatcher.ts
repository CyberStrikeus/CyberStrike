import { Bus } from "@/bus"
import { Log } from "@/util/log"
import { Semaphore } from "@/util/semaphore"
import { withTimeout } from "@/util/timeout"
import { Session } from "@/session"
import { SessionPrompt } from "@/session/prompt"
import { Instance } from "@/project/instance"
import type { InspectionRouter } from "@cyberstrike-io/plugin"
import { InspectionQueue } from "./queue"

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

export class InspectionDispatcher {
  private readonly queue: InspectionQueue
  private readonly router: InspectionRouter
  private running = false
  // Per-target failed-attempt counter (in-memory; a restart resets it, which is fine — worst case a
  // target gets a couple extra retries after a restart). Bounds the retry loop (issue #38).
  private readonly attempts = new Map<string, number>()

  constructor(queue: InspectionQueue, router: InspectionRouter) {
    this.queue = queue
    this.router = router
  }

  // True while a drain loop is in flight — which, because loop() awaits Promise.allSettled(tasks) each
  // pass, stays true for the WHOLE duration that dispatched specialist child-sessions are running. Fed
  // to the SessionLifecycle as an activity source so "complete" waits for the specialists to finish,
  // not merely for the queue to be dispatched (#19).
  get active(): boolean {
    return this.running
  }

  wake(): void {
    // Dry-run (the ingest test flag) means "don't actually run agents" — leave the queue pending so
    // coverage/assertions see it, and never spawn a child session (no live LLM calls in tests).
    if (process.env.CYBERSTRIKE_INGEST_DRY_RUN === "true") return
    // Re-open stale in-flight leases even when a drain is already running: a mid-flight crash/restart
    // can leave items "dispatched" with no runItem to resolve them; a fresh wake (e.g. new ingest) is
    // our chance to reclaim them. Idempotent — only reclaims items past the lease TTL (issue #38).
    this.queue.reclaimStale(DISPATCH_LEASE_MS)
    if (this.running) return
    this.running = true
    void this.loop()
      .catch((e) => log.error("inspection loop crashed", { sessionID: this.queue.sessionID, domain: this.queue.domain, err: String(e) }))
      .finally(() => {
        this.running = false
        // Re-arm against a lost wakeup: an item flagged in the window between the loop's last
        // empty-check and here hit `if (this.running) return` above and was dropped. If anything is
        // still pending, drain again. Safe from looping — every drained item is marked examined.
        if (this.queue.pending().length > 0) this.wake()
      })
  }

  private async loop(): Promise<void> {
    const sem = new Semaphore(CONCURRENCY)
    const model = await SessionPrompt.lastModel(this.queue.sessionID)
    while (true) {
      // Re-open any lease left dangling by a crashed/restarted drain before reading pending, so a
      // stalled item from a previous run is re-inspected rather than skipped (issue #38).
      this.queue.reclaimStale(DISPATCH_LEASE_MS)
      const pending = this.queue.pending()
      if (pending.length === 0) return
      const tasks: Promise<void>[] = []
      for (const item of pending) {
        const target = { key: item.target_key, label: item.target_label ?? item.target_key, meta: item.target_meta ?? {} }
        const evidence = this.queue.evidenceFor(item.target_key)
        const agents = await this.router.resolve(target, evidence)
        // No applicable specialist → nothing to inspect; drain it so it doesn't park the queue in
        // "draining" forever (which would mean "complete" — and its webhook — never fires). #19.
        if (agents.length === 0) {
          this.queue.markExamined(item.target_key)
          continue
        }
        // Claim as in-flight (pending → dispatched) BEFORE running: it leaves pending() so a
        // concurrent pass / re-wake can't dispatch it twice, but stays outstanding in count() so the
        // lifecycle won't report "complete" mid-flight. Marked examined only once its specialists
        // actually finish (runItem) — never at triage — so a stall/failure is recoverable (#38).
        this.queue.markDispatched(item.target_key)
        tasks.push(this.runItem(item, agents, model, sem))
      }
      if (tasks.length === 0) return
      await Promise.allSettled(tasks)
    }
  }

  // Run every specialist for one claimed (dispatched) item, then resolve its lease: examined on any
  // success; a bounded retry (reset to pending) when all failed; give up (examined) past the attempt
  // cap so a permanently-failing target can't retry-loop forever (issue #38).
  private async runItem(
    item: InspectionQueue.Info,
    agents: string[],
    model: { providerID: string; modelID: string },
    sem: Semaphore,
  ): Promise<void> {
    const results = await Promise.allSettled(agents.map((agent) => this.runOne(item, agent, model, sem)))
    const anyOk = results.some((r) => r.status === "fulfilled")
    if (anyOk) {
      this.attempts.delete(item.target_key)
      this.queue.markExamined(item.target_key)
      return
    }
    const n = (this.attempts.get(item.target_key) ?? 0) + 1
    this.attempts.set(item.target_key, n)
    if (n >= MAX_DISPATCH_ATTEMPTS) {
      this.attempts.delete(item.target_key)
      log.warn("inspection dispatch giving up after retries — marking examined", { target: item.target_key, attempts: n })
      this.queue.markExamined(item.target_key)
      return
    }
    log.warn("inspection dispatch failed — re-queueing for retry", { target: item.target_key, attempt: n })
    this.queue.resetToPending(item.target_key)
  }

  // One specialist dispatch under the concurrency semaphore. Throws on failure/timeout so runItem's
  // allSettled sees a rejection (which is how "all failed → retry" is detected).
  private async runOne(
    item: InspectionQueue.Info,
    agent: string,
    model: { providerID: string; modelID: string },
    sem: Semaphore,
  ): Promise<void> {
    await sem.acquire()
    try {
      await this.dispatch(item, agent, model)
    } finally {
      sem.release()
    }
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
    const parts = await SessionPrompt.resolvePromptParts(promptText)
    const run = SessionPrompt.prompt({ sessionID: child.id, agent: agentName, model, parts })
    // On timeout, cancel the hung child (withTimeout only rejects the wrapper — it does NOT abort the
    // underlying run), so a stalled specialist is actually stopped before the item is retried (#38).
    await (DISPATCH_TIMEOUT_MS > 0
      ? withTimeout(run, DISPATCH_TIMEOUT_MS, () => {
          log.warn("inspection dispatch timed out — cancelling child", {
            child: child.id,
            target: item.target_key,
            agent: agentName,
            ms: DISPATCH_TIMEOUT_MS,
          })
          SessionPrompt.cancel(child.id)
        })
      : run)
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
