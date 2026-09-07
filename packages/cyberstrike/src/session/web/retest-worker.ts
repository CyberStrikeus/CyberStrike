// Parallel consumer of the scenario (retest) queue. The orchestrator LLM sees the queue in
// its prompt and MAY dispatch specialists, but that is sequential and best-effort, so the
// queue grew far faster than it drained. This worker drains it DETERMINISTICALLY: it pops
// pending endpoint scenarios, resolves each to the specialist(s) that should test it, and
// spawns them CONCURRENTLY under a Semaphore sized to the LLM rate limit — including multiple
// of the SAME specialist on different endpoints at once. Each spawn is an independent child
// session, so same-type parallelism is free; specialists test via http_replay (server-side,
// stateless — no live-browser contention), so no per-credential serialization is needed.
//
// Mirrors the cloud fan-out pattern (orchestrate.ts): Semaphore + Session.create +
// SessionPrompt.prompt + withTimeout + Promise.allSettled.
import { Bus } from "@/bus"
import { Log } from "@/util/log"
import { Semaphore } from "@/util/semaphore"
import { withTimeout } from "@/util/timeout"
import { Session } from "@/session"
import { SessionPrompt } from "@/session/prompt"
import { WebRetest } from "./web-retest"
import { WebProvider } from "@/cloud/provider-web"
import { Instance } from "@/project/instance"
import type { SpecialistClass } from "./signal/types"
import { TechPlaybook } from "./signal/tech-playbook"

export namespace RetestWorker {
  const log = Log.create({ service: "retest-worker" })
  // Concurrent specialist spawns. Separate pool from IngestQueue (new-endpoint triage); both
  // share the LLM rate limit, so this defaults small and is env-tunable.
  const CONCURRENCY = Math.max(1, Number(process.env.CYBERSTRIKE_RETEST_CONCURRENCY) || 3)
  const DISPATCH_TIMEOUT_MS = 180_000

  // One loop per session at a time (a running loop re-reads getPending until empty, so a wake
  // during a run is absorbed by the next iteration rather than starting a second loop).
  const running = new Set<string>()

  // WebProvider carries the SpecialistClass→agent map; build it once, lazily.
  let providerPromise: Promise<WebProvider> | undefined
  function provider(): Promise<WebProvider> {
    if (!providerPromise) providerPromise = WebProvider.create()
    return providerPromise
  }

  async function agentForClass(cls: SpecialistClass): Promise<string | undefined> {
    return (await provider()).agentForClass(cls)
  }

  /** Which specialist(s) should test this endpoint scenario, from its accumulated flags. @internal */
  export async function resolveAgents(s: WebRetest.Info): Promise<string[]> {
    const agents = new Set<string>()
    // Signal flags carry "signalType:ownerClass" → route to the owning specialist.
    for (const sig of s.flags.signal ?? []) {
      const owner = sig.includes(":") ? (sig.split(":")[1] as SpecialistClass) : undefined
      const a = owner ? await agentForClass(owner) : undefined
      if (a) agents.add(a)
    }
    // A new credential or role = a new identity to test access control with → authz + idor.
    if ((s.flags.credential?.length ?? 0) > 0 || (s.flags.role?.length ?? 0) > 0) {
      const authz = await agentForClass("access-control")
      if (authz) agents.add(authz)
      agents.add("hunt-idor")
    }
    // A new object value = IDOR fuel.
    if ((s.flags.object_value?.length ?? 0) > 0) agents.add("hunt-idor")
    return [...agents]
  }

  /** @internal */
  export function buildPrompt(s: WebRetest.Info): string {
    const ep = s.method ? `${s.method} ${s.endpoint}` : s.key_hash
    const lines = [`Retest the endpoint \`${ep}\` using the newly-discovered context below.`, ""]
    if (s.flags.credential?.length) lines.push(`- Credentials now available: ${s.flags.credential.join(", ")}`)
    if (s.flags.role?.length) lines.push(`- Roles discovered: ${s.flags.role.join(", ")}`)
    if (s.flags.object_value?.length) lines.push(`- Object values to try: ${s.flags.object_value.join(", ")}`)
    if (s.flags.signal?.length) lines.push(`- Signals: ${s.flags.signal.join(", ")}`)
    // A technology signal carries its stack slug as a 3rd ":"-segment. Turn detected stacks into
    // concrete, stack-specific test cases by injecting their TechPlaybook — so a fingerprint always
    // drives real tests here, not just an agent readout.
    const techSlugs = (s.flags.signal ?? [])
      .filter((v) => v.startsWith("technology:"))
      .map((v) => v.split(":")[2])
      .filter((t): t is string => !!t)
    const playbook = techSlugs.length ? TechPlaybook.render(techSlugs) : ""
    if (playbook) {
      lines.push("", "## Detected stack — run these stack-specific test cases:", playbook)
    }
    lines.push(
      "",
      "Call web_get_session_context first for the full credential/observation context, then use http_replay (compare / sweep) to test. Record a coverage note or report a finding when done.",
    )
    return lines.join("\n")
  }

  async function dispatch(sessionID: string, s: WebRetest.Info, agentName: string, model: { providerID: string; modelID: string }): Promise<void> {
    const child = await Session.create({
      parentID: sessionID,
      title: `Retest ${s.method ?? ""} ${s.endpoint ?? s.key_hash} (@${agentName} subagent)`.trim(),
    })
    const parts = await SessionPrompt.resolvePromptParts(buildPrompt(s))
    await withTimeout(SessionPrompt.prompt({ sessionID: child.id, agent: agentName, model, parts }), DISPATCH_TIMEOUT_MS)
  }

  async function loop(sessionID: string): Promise<void> {
    const sem = new Semaphore(CONCURRENCY)
    const model = await SessionPrompt.lastModel(sessionID)
    while (true) {
      const pending = WebRetest.getPending(sessionID)
      if (pending.length === 0) return
      const tasks: Promise<void>[] = []
      for (const s of pending) {
        const agents = await resolveAgents(s)
        if (agents.length === 0) continue
        // Pickup: mark examined so neither this loop nor the orchestrator re-dispatches it.
        // If a genuinely new flag value arrives later, WebRetest.flag re-opens it.
        WebRetest.markExamined(sessionID, s.key_hash)
        for (const agentName of agents) {
          tasks.push(
            (async () => {
              await sem.acquire()
              try {
                await dispatch(sessionID, s, agentName, model)
              } catch (e) {
                log.warn("retest dispatch failed", { endpoint: s.endpoint ?? s.key_hash, agent: agentName, err: String(e) })
              } finally {
                sem.release()
              }
            })(),
          )
        }
      }
      if (tasks.length === 0) return // nothing routable (e.g. flags with no owning agent)
      await Promise.allSettled(tasks)
    }
  }

  /** Wake the per-session drain loop (idempotent while one is already running). */
  export function wake(sessionID: string): void {
    if (running.has(sessionID)) return
    running.add(sessionID)
    void loop(sessionID)
      .catch((e) => log.error("retest loop crashed", { sessionID, err: String(e) }))
      .finally(() => running.delete(sessionID))
  }

  // Subscribe once per instance: a new/re-opened scenario (WebRetest.flag publishes
  // Event.Updated) wakes the per-session drain loop. Instance.state makes this idempotent —
  // repeated start() calls reuse the single subscription.
  const subscription = Instance.state(() => {
    Bus.subscribe(WebRetest.Event.Updated, (e) => {
      if (e.properties.queue.length > 0) wake(e.properties.sessionID)
    })
    return {}
  })

  /** Ensure the queue-growth subscription is active for this instance (idempotent). */
  export function start(): void {
    subscription()
  }
}
