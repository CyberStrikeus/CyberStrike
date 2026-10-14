import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { IngestQueue } from "../../src/session/ingest-queue"
import { tmpdir } from "../fixture/fixture"

async function withInstance(fn: () => Promise<void>) {
  await using dir = await tmpdir()
  await Instance.provide({
    directory: dir.path,
    fn: async () => {
      try {
        await fn()
      } finally {
        await Instance.dispose()
      }
    },
  })
}

describe("IngestQueue retest drain", () => {
  test("serializes a drain follow-up before reporting an empty queue", async () => {
    await withInstance(async () => {
      const sessionID = "retest-drain"
      const order: string[] = []
      let scheduled = false

      IngestQueue.enqueue(sessionID, async () => {
        order.push("ingest")
      })
      IngestQueue.setDrainHandler(sessionID, () => {
        if (scheduled) return
        scheduled = true
        IngestQueue.enqueue(sessionID, async () => {
          order.push("retest")
        })
      })

      await Bun.sleep(20)
      expect(order).toEqual(["ingest", "retest"])
      expect(IngestQueue.pendingCount(sessionID)).toBe(0)
    })
  })

  test("waits for resume before draining retests", async () => {
    await withInstance(async () => {
      const sessionID = "retest-paused"
      const order: string[] = []
      let scheduled = false

      IngestQueue.pause(sessionID)
      IngestQueue.setDrainHandler(sessionID, () => {
        if (scheduled) return
        scheduled = true
        IngestQueue.enqueue(sessionID, async () => {
          order.push("retest")
        })
      })
      IngestQueue.enqueue(sessionID, async () => {
        order.push("ingest")
      })

      await Bun.sleep(20)
      expect(order).toEqual([])
      IngestQueue.resume(sessionID)
      await Bun.sleep(20)
      expect(order).toEqual(["ingest", "retest"])
      expect(IngestQueue.pendingCount(sessionID)).toBe(0)
    })
  })
})
