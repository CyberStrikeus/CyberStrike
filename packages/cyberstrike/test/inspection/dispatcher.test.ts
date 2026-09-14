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
})
