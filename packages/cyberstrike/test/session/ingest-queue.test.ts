import { describe, expect, test } from "bun:test"
import { IngestQueue } from "../../src/session/ingest-queue"
import { SessionQueueStatus } from "../../src/session/queue-status"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

function defer<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

async function withInstance(fn: () => Promise<void>) {
  await using dir = await tmpdir({ git: true })
  await Instance.provide({
    directory: dir.path,
    fn: async () => {
      await fn()
      await Instance.dispose()
    },
  })
}

describe("IngestQueue.enqueue", () => {
  test("runs a single task and updates pending count", async () => {
    await withInstance(async () => {
      const sid = "s1"
      const order: string[] = []
      IngestQueue.enqueue(sid, async () => {
        order.push("ran")
      })
      expect(IngestQueue.pendingCount(sid)).toBe(1)
      await new Promise((r) => setTimeout(r, 10))
      expect(order).toEqual(["ran"])
      expect(IngestQueue.pendingCount(sid)).toBe(0)
      expect(IngestQueue.isPaused(sid)).toBe(false)
    })
  })

  test("runs tasks sequentially in enqueue order", async () => {
    await withInstance(async () => {
      const sid = "s2"
      const order: number[] = []
      const a = defer()
      const b = defer()
      IngestQueue.enqueue(sid, async () => {
        await a.promise
        order.push(1)
      })
      IngestQueue.enqueue(sid, async () => {
        await b.promise
        order.push(2)
      })
      expect(IngestQueue.pendingCount(sid)).toBe(2)
      b.resolve() // even if b ready first, must wait for a
      await new Promise((r) => setTimeout(r, 5))
      expect(order).toEqual([])
      a.resolve()
      await new Promise((r) => setTimeout(r, 10))
      expect(order).toEqual([1, 2])
      expect(IngestQueue.pendingCount(sid)).toBe(0)
    })
  })

  test("task error does not break the chain or pending count", async () => {
    await withInstance(async () => {
      const sid = "s3"
      const order: string[] = []
      IngestQueue.enqueue(sid, async () => {
        throw new Error("boom")
      })
      IngestQueue.enqueue(sid, async () => {
        order.push("after-error")
      })
      await new Promise((r) => setTimeout(r, 10))
      expect(order).toEqual(["after-error"])
      expect(IngestQueue.pendingCount(sid)).toBe(0)
    })
  })
})

describe("IngestQueue.pause / resume", () => {
  test("pause defers the next task until resume", async () => {
    await withInstance(async () => {
      const sid = "p1"
      const order: number[] = []
      const t1 = defer()
      const started = defer()
      IngestQueue.enqueue(sid, async () => {
        started.resolve()
        await t1.promise
        order.push(1)
      })
      // Wait until task 1 is actually in-flight before pausing
      await started.promise
      IngestQueue.pause(sid)
      IngestQueue.enqueue(sid, async () => {
        order.push(2)
      })
      // Finish task 1; task 2 should NOT run because we are paused
      t1.resolve()
      await new Promise((r) => setTimeout(r, 20))
      expect(order).toEqual([1])
      expect(IngestQueue.isPaused(sid)).toBe(true)
      expect(IngestQueue.pendingCount(sid)).toBe(1)

      // Resume → task 2 runs
      IngestQueue.resume(sid)
      await new Promise((r) => setTimeout(r, 10))
      expect(order).toEqual([1, 2])
      expect(IngestQueue.pendingCount(sid)).toBe(0)
      expect(IngestQueue.isPaused(sid)).toBe(false)
    })
  })

  test("pause is idempotent", async () => {
    await withInstance(async () => {
      const sid = "p2"
      IngestQueue.pause(sid)
      IngestQueue.pause(sid)
      IngestQueue.pause(sid)
      expect(IngestQueue.isPaused(sid)).toBe(true)
    })
  })

  test("resume without pause is no-op", async () => {
    await withInstance(async () => {
      const sid = "p3"
      IngestQueue.resume(sid)
      expect(IngestQueue.isPaused(sid)).toBe(false)
    })
  })

  test("enqueue while already paused waits at start", async () => {
    await withInstance(async () => {
      const sid = "p4"
      const order: string[] = []
      IngestQueue.pause(sid)
      IngestQueue.enqueue(sid, async () => {
        order.push("ran")
      })
      await new Promise((r) => setTimeout(r, 20))
      expect(order).toEqual([])
      expect(IngestQueue.pendingCount(sid)).toBe(1)
      IngestQueue.resume(sid)
      await new Promise((r) => setTimeout(r, 10))
      expect(order).toEqual(["ran"])
    })
  })
})

describe("IngestQueue isolation", () => {
  test("two sessions are independent", async () => {
    await withInstance(async () => {
      const sa = "iso-a"
      const sb = "iso-b"
      const order: string[] = []
      IngestQueue.pause(sa)
      IngestQueue.enqueue(sa, async () => {
        order.push("a")
      })
      IngestQueue.enqueue(sb, async () => {
        order.push("b")
      })
      await new Promise((r) => setTimeout(r, 20))
      // sb should run, sa should be paused
      expect(order).toEqual(["b"])
      expect(IngestQueue.isPaused(sa)).toBe(true)
      expect(IngestQueue.isPaused(sb)).toBe(false)
      IngestQueue.resume(sa)
      await new Promise((r) => setTimeout(r, 10))
      expect(order).toEqual(["b", "a"])
    })
  })
})

describe("SessionQueueStatus", () => {
  test("get returns default when nothing set", async () => {
    await withInstance(async () => {
      const got = SessionQueueStatus.get("none")
      expect(got).toEqual({ paused: false, pending: 0 })
    })
  })

  test("status reflects enqueue and drain", async () => {
    await withInstance(async () => {
      const sid = "qs1"
      IngestQueue.enqueue(sid, async () => {})
      // Right after enqueue, pending is 1
      expect(SessionQueueStatus.get(sid).pending).toBe(1)
      await new Promise((r) => setTimeout(r, 10))
      // Drained → defaults
      expect(SessionQueueStatus.get(sid)).toEqual({ paused: false, pending: 0 })
    })
  })

  test("status reflects pause", async () => {
    await withInstance(async () => {
      const sid = "qs2"
      IngestQueue.pause(sid)
      expect(SessionQueueStatus.get(sid).paused).toBe(true)
      IngestQueue.resume(sid)
      expect(SessionQueueStatus.get(sid).paused).toBe(false)
    })
  })
})
