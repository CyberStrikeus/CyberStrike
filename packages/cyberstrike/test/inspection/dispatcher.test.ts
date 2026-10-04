import { describe, test, expect } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { InspectionQueue } from "../../src/inspection/queue"
import { InspectionDispatcher } from "../../src/inspection/dispatcher"
import { InspectionActivity } from "../../src/inspection/activity"
import { Bus } from "../../src/bus"
import { Log } from "../../src/util/log"

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

describe("InspectionDispatcher", () => {
  // The old loop did `if (agents.length === 0) continue` BEFORE markExamined, so an endpoint that maps
  // to no specialist stayed pending forever — the queue never drained and the lifecycle never reached
  // "complete" (webhook never fired). resolve() → [] never calls dispatch(), so there is no LLM here.
  test("item with no routable agent is still marked examined (queue drains, #19)", () =>
    run(async (sid) => {
      const q = new InspectionQueue(sid, "web")
      q.flag({ key: "orphan", label: "orphan", meta: {} }, { type: "s", value: "v", priority: "medium" })
      const router = { resolve: async () => [], prompt: () => "" } as any
      const d = new InspectionDispatcher(q, router)
      await (d as any).loop()
      const counts = q.count()
      expect(counts.pending).toBe(0)
      expect(counts.examined).toBe(1)
    }))

  // ── Lease-based recovery (issue #38) — dispatch() stubbed so there are no live LLM calls ──────────

  test("successful dispatch marks the item examined exactly once", () =>
    run(async (sid) => {
      const q = new InspectionQueue(sid, "web")
      q.flag({ key: "ep", label: "ep", meta: {} }, { type: "s", value: "v", priority: "medium" })
      const router = { resolve: async () => ["specialist"], prompt: () => "" } as any
      const d = new InspectionDispatcher(q, router)
      let calls = 0
      ;(d as any).dispatch = async () => {
        calls++
      }
      await (d as any).loop()
      expect(calls).toBe(1)
      expect(q.count().examined).toBe(1)
      expect(q.count().pending).toBe(0)
    }))

  test("all-specialists-failed dispatch retries, then gives up (examined) — never skipped, never looping", () =>
    run(async (sid) => {
      const q = new InspectionQueue(sid, "web")
      q.flag({ key: "ep", label: "ep", meta: {} }, { type: "s", value: "v", priority: "medium" })
      const router = { resolve: async () => ["specialist"], prompt: () => "" } as any
      const d = new InspectionDispatcher(q, router)
      let calls = 0
      ;(d as any).dispatch = async () => {
        calls++
        throw new Error("boom") // every specialist fails (stall/timeout stand-in)
      }
      await (d as any).loop()
      // MAX_DISPATCH_ATTEMPTS default 2: dispatched → fail → retry → fail → give up. Item is drained
      // (examined) so the queue reaches "complete", and the loop terminates (no infinite retry).
      expect(calls).toBe(2)
      expect(q.count().pending).toBe(0)
      expect(q.count().examined).toBe(1)
    }))

  test("a partial success (one of two specialists ran) still drains the item", () =>
    run(async (sid) => {
      const q = new InspectionQueue(sid, "web")
      q.flag({ key: "ep", label: "ep", meta: {} }, { type: "s", value: "v", priority: "medium" })
      const router = { resolve: async () => ["a", "b"], prompt: () => "" } as any
      const d = new InspectionDispatcher(q, router)
      ;(d as any).dispatch = async (_item: any, agent: string) => {
        if (agent === "b") throw new Error("b failed")
      }
      await (d as any).loop()
      expect(q.count().examined).toBe(1)
      expect(q.count().pending).toBe(0)
    }))

  // #80 — the worker pool caps concurrent specialists at CONCURRENCY and actually runs them in parallel
  // (the old per-pass batch barrier would too for an up-front batch; the trickle test below is what it
  // failed). dispatch() is stubbed, so there are no live LLM calls.
  test("runs up to CONCURRENCY specialists in parallel and drains all (#80)", () =>
    run(async (sid) => {
      const q = new InspectionQueue(sid, "web")
      for (let i = 0; i < 6; i++)
        q.flag({ key: "ep" + i, label: "ep" + i, meta: {} }, { type: "s", value: "v", priority: "medium" })
      const router = { resolve: async () => ["spec"], prompt: () => "" } as any
      const d = new InspectionDispatcher(q, router)
      let concurrent = 0
      let max = 0
      let done = 0
      ;(d as any).dispatch = async () => {
        concurrent++
        max = Math.max(max, concurrent)
        await new Promise((r) => setTimeout(r, 15))
        concurrent--
        done++
      }
      await (d as any).loop()
      expect(done).toBe(6)
      expect(max).toBeGreaterThan(1) // genuinely parallel
      expect(max).toBeLessThanOrEqual(3) // CONCURRENCY default
      expect(q.count().examined).toBe(6)
    }))

  // The regression #80 actually fixes: items that arrive ONE AT A TIME while specialists are already
  // running must still parallelize. The old loop snapshotted pending() once per pass and barriered on
  // the whole batch, so a trickle serialized behind the first slow specialist (max === 1). Here each
  // dispatch flags the next item + wakes — the pool must pick them up into free slots immediately.
  test("trickle-flagged items still parallelize, not serialize behind the running one (#80)", () =>
    run(async (sid) => {
      const q = new InspectionQueue(sid, "web")
      q.flag({ key: "ep0", label: "ep0", meta: {} }, { type: "s", value: "v", priority: "medium" })
      const router = { resolve: async () => ["spec"], prompt: () => "" } as any
      const d = new InspectionDispatcher(q, router)
      ;(d as any).running = true // loop() is called directly; running must be set so wake() nudges it
      const total = 6
      let next = 1
      let concurrent = 0
      let max = 0
      let done = 0
      ;(d as any).dispatch = async () => {
        concurrent++
        max = Math.max(max, concurrent)
        if (next < total) {
          const k = "ep" + next++
          q.flag({ key: k, label: k, meta: {} }, { type: "s", value: "v", priority: "medium" })
          d.wake()
        }
        await new Promise((r) => setTimeout(r, 20))
        concurrent--
        done++
      }
      await (d as any).loop()
      expect(done).toBe(total)
      expect(max).toBeGreaterThan(1) // old batch loop would be 1 here (serialized)
      expect(q.count().examined).toBe(total)
      expect(q.count().pending).toBe(0)
    }))

  // #81 — the dispatcher publishes an `inspection.activity` event as endpoints are examined, so the TUI
  // can render a live feed in the root session. (dispatch() stubbed, so the "dispatched" emit inside it
  // is bypassed here; this covers the examined emit + the event plumbing/shape.)
  test("emits an 'examined' activity event when an endpoint finishes (#81)", () =>
    run(async (sid) => {
      const q = new InspectionQueue(sid, "web")
      q.flag({ key: "ep", label: "GET /x", meta: {} }, { type: "s", value: "v", priority: "medium" })
      const router = { resolve: async () => ["spec"], prompt: () => "" } as any
      const d = new InspectionDispatcher(q, router)
      ;(d as any).dispatch = async () => {}
      const seen: any[] = []
      const unsub = Bus.subscribe(InspectionActivity.Event, (e) => seen.push(e.properties))
      await (d as any).loop()
      unsub()
      const examined = seen.filter((e) => e.kind === "examined")
      expect(examined.length).toBe(1)
      expect(examined[0].target).toBe("ep")
      expect(examined[0].outcome).toBe("done")
      expect(examined[0].sessionID).toBe(sid)
      expect(examined[0].domain).toBe("web")
    }))
})
