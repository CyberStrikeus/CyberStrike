import { describe, test, expect } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { InspectionQueue } from "../../src/inspection/queue"
import { InspectionDispatcher } from "../../src/inspection/dispatcher"
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
})
