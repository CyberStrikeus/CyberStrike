import { describe, test, expect } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { InspectionQueue } from "../../src/inspection/queue"
import { InspectionDispatcher } from "../../src/inspection/dispatcher"
import { SessionLifecycle } from "../../src/inspection/lifecycle"
import { Log } from "../../src/util/log"
import type { ActivitySource } from "@cyberstrike-io/plugin"

const projectRoot = path.join(__dirname, "../..")
Log.init({ print: false })

function run(fn: (sessionID: string) => void | Promise<void>) {
  return Instance.provide({
    directory: projectRoot,
    fn: async () => {
      const session = await Session.create({})
      try {
        await fn(session.id)
      } finally {
        await Session.remove(session.id)
      }
    },
  })
}

function makeSource(name: string, active: boolean): ActivitySource {
  return { name, isActive: () => active }
}

describe("SessionLifecycle", () => {
  test("starts idle with no sources and no queue items", () =>
    run((sid) => {
      const q = new InspectionQueue(sid, "web")
      const lc = new SessionLifecycle(sid, "web", q)
      expect(lc.phase).toBe("idle")
    }))

  test("discovering when source active but queue empty", () =>
    run((sid) => {
      const q = new InspectionQueue(sid, "web")
      const lc = new SessionLifecycle(sid, "web", q)
      lc.addSource(makeSource("crawler", true))
      // Force a tick without starting the interval
      ;(lc as any).tick()
      expect(lc.phase).toBe("discovering")
    }))

  test("inspecting when source active and queue has items", () =>
    run((sid) => {
      const q = new InspectionQueue(sid, "web")
      q.flag({ key: "ep1", label: "ep1", meta: {} }, { type: "s", value: "v", priority: "medium" })
      const lc = new SessionLifecycle(sid, "web", q)
      lc.addSource(makeSource("crawler", true))
      ;(lc as any).tick()
      expect(lc.phase).toBe("inspecting")
    }))

  test("draining when no sources active but queue has pending", () =>
    run((sid) => {
      const q = new InspectionQueue(sid, "web")
      q.flag({ key: "ep1", label: "ep1", meta: {} }, { type: "s", value: "v", priority: "medium" })
      const lc = new SessionLifecycle(sid, "web", q)
      ;(lc as any).tick()
      expect(lc.phase).toBe("draining")
    }))

  test("complete when no sources active and all examined", () =>
    run((sid) => {
      const q = new InspectionQueue(sid, "web")
      q.flag({ key: "ep1", label: "ep1", meta: {} }, { type: "s", value: "v", priority: "medium" })
      q.markExamined("ep1")
      const lc = new SessionLifecycle(sid, "web", q)
      ;(lc as any).tick()
      expect(lc.phase).toBe("complete")
    }))

  test("all examined BUT a source still active → NOT complete (premature-completion guard)", () =>
    run((sid) => {
      const q = new InspectionQueue(sid, "web")
      q.flag({ key: "ep1", label: "ep1", meta: {} }, { type: "s", value: "v", priority: "medium" })
      q.markExamined("ep1") // queue momentarily drained…
      let active = true
      const lc = new SessionLifecycle(sid, "web", q)
      lc.addSource({ name: "crawler", isActive: () => active }) // …but the crawler is still discovering
      ;(lc as any).tick()
      expect(lc.phase).not.toBe("complete") // must HOLD — a premature complete would stop() the lifecycle
      active = false // crawler settles
      ;(lc as any).tick()
      expect(lc.phase).toBe("complete") // now genuinely done
    }))

  test("dispatcher.active source holds off complete while specialists run (#19)", () =>
    run((sid) => {
      const q = new InspectionQueue(sid, "web")
      q.flag({ key: "ep1", label: "ep1", meta: {} }, { type: "s", value: "v", priority: "medium" })
      q.markExamined("ep1") // queue dispatched + drained — the old bug fired "complete" right here…
      const router = { resolve: async () => [], prompt: () => "" } as any
      const dispatcher = new InspectionDispatcher(q, router)
      ;(dispatcher as any).running = true // …but a spawned specialist child-session is still running
      const lc = new SessionLifecycle(sid, "web", q)
      lc.addSource({ name: "specialist", isActive: () => dispatcher.active }) // exact web-bridge wiring
      ;(lc as any).tick()
      expect(lc.phase).not.toBe("complete") // HOLD — specialist in flight
      ;(dispatcher as any).running = false // specialist finishes, loop's finally clears running
      ;(lc as any).tick()
      expect(lc.phase).toBe("complete") // now the assessment is genuinely done
    }))

  test("addSource is idempotent by name (re-registered every ingest)", () =>
    run((sid) => {
      const q = new InspectionQueue(sid, "web")
      q.flag({ key: "a", label: "a", meta: {} }, { type: "s", value: "v", priority: "medium" })
      const lc = new SessionLifecycle(sid, "web", q)
      lc.addSource(makeSource("crawler", true))
      lc.addSource(makeSource("crawler", true))
      lc.addSource(makeSource("crawler", true))
      ;(lc as any).tick()
      expect(lc.snapshot().sources).toHaveLength(1)
    }))

  test("snapshot returns correct structure", () =>
    run((sid) => {
      const q = new InspectionQueue(sid, "web")
      q.flag({ key: "a", label: "a", meta: {} }, { type: "s", value: "v", priority: "medium" })
      const lc = new SessionLifecycle(sid, "web", q)
      lc.addSource(makeSource("crawler", true))
      ;(lc as any).tick()
      const snap = lc.snapshot()
      expect(snap.phase).toBe("inspecting")
      expect(snap.sources).toHaveLength(1)
      expect(snap.sources[0].name).toBe("crawler")
      expect(snap.sources[0].active).toBe(true)
      expect(snap.counts.pending).toBe(1)
      expect(snap.counts.total).toBe(1)
    }))

  test("removeSource works correctly", () =>
    run((sid) => {
      const q = new InspectionQueue(sid, "web")
      q.flag({ key: "a", label: "a", meta: {} }, { type: "s", value: "v", priority: "medium" })
      const lc = new SessionLifecycle(sid, "web", q)
      lc.addSource(makeSource("crawler", true))
      ;(lc as any).tick()
      expect(lc.phase).toBe("inspecting")
      lc.removeSource("crawler")
      ;(lc as any).tick()
      expect(lc.phase).toBe("draining")
    }))
})
