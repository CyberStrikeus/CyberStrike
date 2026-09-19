import { InspectionQueue } from "./queue"
import { InspectionDispatcher } from "./dispatcher"
import { SessionLifecycle } from "./lifecycle"
import { WebInspectionRouter } from "./web-router"
import { TriageRunner } from "./triage"
import type { ActivitySource } from "@cyberstrike-io/plugin"

interface Inst {
  queue: InspectionQueue
  dispatcher: InspectionDispatcher
  lifecycle: SessionLifecycle
  triage: TriageRunner
  started: boolean
}
const instances = new Map<string, Inst>()

// Get-or-create the per-session instance WITHOUT starting the dispatcher/lifecycle. The queue is safe
// to flag + read from here; nothing dispatches. Used by the WebInspect facade so a flag stays passive
// (parity with the old WebRetest.flag) — dispatch only runs once the ingest bootstrap calls
// ensureWebInspection().
export function getWebInspection(sessionID: string): Inst {
  const existing = instances.get(sessionID)
  if (existing) return existing
  const queue = new InspectionQueue(sessionID, "web")
  const router = new WebInspectionRouter()
  const dispatcher = new InspectionDispatcher(queue, router)
  const lifecycle = new SessionLifecycle(sessionID, "web", queue)
  const triage = new TriageRunner(sessionID)
  const inst: Inst = { queue, dispatcher, lifecycle, triage, started: false }
  instances.set(sessionID, inst)
  return inst
}

// Production bootstrap: create + START the dispatcher (consumes the queue → spawns specialists) and the
// lifecycle (phase → …→ complete). Idempotent. Called once per session on the real ingest path.
export function ensureWebInspection(sessionID: string): Inst {
  const inst = getWebInspection(sessionID)
  if (!inst.started) {
    InspectionDispatcher.register(inst.dispatcher)
    InspectionDispatcher.start()
    // Specialist-in-flight source: while the dispatcher is draining the queue it is running spawned
    // WSTG child-sessions, so the lifecycle must not settle to "complete" yet. Registered here (not the
    // ingest bootstrap) so it is always present whenever inspection is actually started (#19).
    inst.lifecycle.addSource({ name: "specialist", isActive: () => inst.dispatcher.active })
    // Auto-triage (#41): when the queue drains, finalize draft findings; keep the lifecycle out of
    // "complete" while a triage pass is in flight, so "complete" means scanned AND triaged.
    inst.dispatcher.onDrain = () => inst.triage.wake()
    inst.lifecycle.addSource({ name: "triage", isActive: () => inst.triage.active })
    inst.lifecycle.start()
    inst.started = true
  }
  return inst
}

export function addWebActivitySource(sessionID: string, source: ActivitySource): void {
  const inst = instances.get(sessionID)
  if (inst) inst.lifecycle.addSource(source)
}

export function removeWebActivitySource(sessionID: string, name: string): void {
  const inst = instances.get(sessionID)
  if (inst) inst.lifecycle.removeSource(name)
}

export function destroyWebInspection(sessionID: string): void {
  const inst = instances.get(sessionID)
  if (!inst) return
  inst.lifecycle.stop()
  InspectionDispatcher.unregister(sessionID, "web")
  instances.delete(sessionID)
}
