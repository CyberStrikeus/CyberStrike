import { InspectionQueue } from "./queue"
import { InspectionDispatcher } from "./dispatcher"
import { SessionLifecycle } from "./lifecycle"
import { WebInspectionRouter } from "./web-router"
import type { ActivitySource } from "@cyberstrike-io/plugin"

const instances = new Map<string, { queue: InspectionQueue; dispatcher: InspectionDispatcher; lifecycle: SessionLifecycle }>()

export function ensureWebInspection(sessionID: string): {
  queue: InspectionQueue
  dispatcher: InspectionDispatcher
  lifecycle: SessionLifecycle
} {
  const existing = instances.get(sessionID)
  if (existing) return existing

  const queue = new InspectionQueue(sessionID, "web")
  const router = new WebInspectionRouter()
  const dispatcher = new InspectionDispatcher(queue, router)
  const lifecycle = new SessionLifecycle(sessionID, "web", queue)

  InspectionDispatcher.register(dispatcher)
  InspectionDispatcher.start()
  lifecycle.start()

  const inst = { queue, dispatcher, lifecycle }
  instances.set(sessionID, inst)
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

export function getWebInspection(sessionID: string) {
  return instances.get(sessionID)
}

export function destroyWebInspection(sessionID: string): void {
  const inst = instances.get(sessionID)
  if (!inst) return
  inst.lifecycle.stop()
  InspectionDispatcher.unregister(sessionID, "web")
  instances.delete(sessionID)
}
