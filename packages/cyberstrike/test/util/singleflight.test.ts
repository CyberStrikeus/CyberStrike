import { describe, expect, test } from "bun:test"
import { singleflight } from "../../src/util/singleflight"

function tick() {
  return new Promise<void>((r) => queueMicrotask(r))
}

describe("util.singleflight", () => {
  test("concurrent calls share one execution", async () => {
    let count = 0
    const run = singleflight(async () => {
      count++
      await tick()
      return { value: Math.random() }
    })

    const [a, b] = await Promise.all([run(), run()])
    expect(count).toBe(1)
    expect(a).toBe(b)
  })

  test("executes again after the promise settles", async () => {
    let count = 0
    const run = singleflight(async () => {
      count++
      await tick()
    })

    await run()
    await run()
    expect(count).toBe(2)
  })

  test("rejection propagates to all callers and the guard clears", async () => {
    let fail = true
    let count = 0
    const run = singleflight(async () => {
      count++
      await tick()
      if (fail) throw new Error("boom")
      return "ok"
    })

    const results = await Promise.allSettled([run(), run(), run()])
    expect(count).toBe(1)
    for (const result of results) {
      expect(result.status).toBe("rejected")
      if (result.status === "rejected") expect(result.reason.message).toBe("boom")
    }

    fail = false
    expect(await run()).toBe("ok")
    expect(count).toBe(2)
  })

  test("sequential non-overlapping calls each execute", async () => {
    let count = 0
    const run = singleflight(async () => {
      count++
      await tick()
      return count
    })

    expect(await run()).toBe(1)
    expect(await run()).toBe(2)
    expect(await run()).toBe(3)
    expect(count).toBe(3)
  })
})
