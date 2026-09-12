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
const DISPATCH_TIMEOUT_MS = Math.max(0, Number(process.env.CYBERSTRIKE_INSPECTION_DISPATCH_TIMEOUT_MS) || 0)

export class InspectionDispatcher {
  private readonly queue: InspectionQueue
  private readonly router: InspectionRouter
  private running = false

  constructor(queue: InspectionQueue, router: InspectionRouter) {
    this.queue = queue
    this.router = router
  }

  wake(): void {
    if (this.running) return
    this.running = true
    void this.loop()
      .catch((e) => log.error("inspection loop crashed", { sessionID: this.queue.sessionID, domain: this.queue.domain, err: String(e) }))
      .finally(() => { this.running = false })
  }

  private async loop(): Promise<void> {
    const sem = new Semaphore(CONCURRENCY)
    const model = await SessionPrompt.lastModel(this.queue.sessionID)
    while (true) {
      const pending = this.queue.pending()
      if (pending.length === 0) return
      const tasks: Promise<void>[] = []
      for (const item of pending) {
        const target = { key: item.target_key, label: item.target_label ?? item.target_key, meta: item.target_meta ?? {} }
        const evidence = this.queue.evidenceFor(item.target_key)
        const agents = await this.router.resolve(target, evidence)
        if (agents.length === 0) continue
        this.queue.markExamined(item.target_key)
        for (const agent of agents) {
          tasks.push(
            (async () => {
              await sem.acquire()
              try {
                await this.dispatch(item, agent, model)
              } catch (e) {
                log.warn("inspection dispatch failed", { target: item.target_key, agent, err: String(e) })
              } finally {
                sem.release()
              }
            })(),
          )
        }
      }
      if (tasks.length === 0) return
      await Promise.allSettled(tasks)
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
    await (DISPATCH_TIMEOUT_MS > 0 ? withTimeout(run, DISPATCH_TIMEOUT_MS) : run)
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
