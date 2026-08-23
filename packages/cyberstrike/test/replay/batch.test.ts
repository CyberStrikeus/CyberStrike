import { describe, test, expect } from "bun:test"
import { Batch } from "../../src/replay/batch"
import { Governor } from "../../src/replay/governor"

const tick = () => new Promise<void>((r) => setTimeout(r, 5))

describe("Batch.run", () => {
  test("runs all items and returns results in input order", async () => {
    const items = [1, 2, 3, 4, 5]
    const out = await Batch.run(items, async (n) => n * 10, { concurrency: 2 })
    expect(out).toEqual([10, 20, 30, 40, 50])
  })

  test("never exceeds the concurrency cap", async () => {
    let active = 0
    let maxSeen = 0
    const worker = async () => {
      active++
      maxSeen = Math.max(maxSeen, active)
      await tick()
      active--
      return true
    }
    await Batch.run(Array.from({ length: 20 }), worker, { concurrency: 3 })
    expect(maxSeen).toBeLessThanOrEqual(3)
  })

  test("a throwing worker yields undefined without failing the batch", async () => {
    const out = await Batch.run([1, 2, 3], async (n) => {
      if (n === 2) throw new Error("boom")
      return n
    }, { concurrency: 3 })
    expect(out).toEqual([1, undefined, 3])
  })

  test("adapts to a dynamic (AIMD) concurrency cap", async () => {
    const limiter = new Governor.AimdLimiter(1, 10)
    let active = 0
    let maxSeen = 0
    const worker = async () => {
      active++
      maxSeen = Math.max(maxSeen, active)
      await tick()
      active--
      limiter.onSuccess() // cap grows as work succeeds
      return true
    }
    await Batch.run(Array.from({ length: 30 }), worker, { concurrency: () => limiter.value })
    // started at 1, grew over time — so it should have exceeded 1 but never the max
    expect(maxSeen).toBeGreaterThan(1)
    expect(maxSeen).toBeLessThanOrEqual(10)
  })

  test("stops launching new work once aborted", async () => {
    const ctrl = new AbortController()
    let launched = 0
    const worker = async () => {
      launched++
      if (launched === 3) ctrl.abort()
      await tick()
      return true
    }
    await Batch.run(Array.from({ length: 50 }), worker, { concurrency: 2, signal: ctrl.signal })
    // A couple more may be in flight when abort fires, but nowhere near all 50.
    expect(launched).toBeLessThan(10)
  })

  test("token bucket paces requests per second", async () => {
    // capacity 2, refill 0 within the test window → only 2 ever launch.
    let launched = 0
    const bucket = new Governor.TokenBucket(0, 2, 0)
    const worker = async () => {
      launched++
      await tick()
      return true
    }
    // Abort after a short spin so the (rate-starved) loop can't run forever.
    const ctrl = new AbortController()
    setTimeout(() => ctrl.abort(), 60)
    await Batch.run(Array.from({ length: 10 }), worker, {
      concurrency: 5,
      bucket,
      now: () => 0,
      rateWaitMs: 5,
      signal: ctrl.signal,
    })
    expect(launched).toBe(2) // only the 2 initial tokens
  })
})
