import { describe, expect, test } from "bun:test"
import { RepeatDetector } from "../../../src/session/stuck/repeat-detector"

describe("RepeatDetector — cross-turn identical-call loop", () => {
  test("same signature reaching the limit across steps → nudge, then abort", () => {
    const d = new RepeatDetector(3)
    expect(d.observe(["a"])).toBe("ok") // count 1
    expect(d.observe(["a"])).toBe("ok") // count 2
    expect(d.observe(["a"])).toBe("nudge") // count 3 → first strike
    expect(d.observe(["a"])).toBe("abort") // count 4 → second strike
  })

  test("different args never collide (legitimate probing unaffected)", () => {
    const d = new RepeatDetector(3)
    expect(d.observe(["read::1"])).toBe("ok")
    expect(d.observe(["read::2"])).toBe("ok")
    expect(d.observe(["read::3"])).toBe("ok")
    expect(d.observe(["read::4"])).toBe("ok")
  })

  test("a within-step burst of identical sigs counts ONCE (cross-turn, not within-turn)", () => {
    const d = new RepeatDetector(3)
    expect(d.observe(["x", "x", "x"])).toBe("ok") // deduped → count 1 this step
    expect(d.observe(["x"])).toBe("ok") // count 2
    expect(d.observe(["x", "x"])).toBe("nudge") // count 3 across three STEPS → nudge
  })

  test("interleaved distinct signatures still count per-signature", () => {
    const d = new RepeatDetector(3)
    d.observe(["a", "b"]) // a=1 b=1
    d.observe(["a", "b"]) // a=2 b=2
    expect(d.observe(["a"])).toBe("nudge") // a=3
  })

  test("empty step is ok", () => {
    const d = new RepeatDetector(3)
    expect(d.observe([])).toBe("ok")
  })

  test("reset clears counts and the nudged latch", () => {
    const d = new RepeatDetector(3)
    d.observe(["a"])
    d.observe(["a"])
    expect(d.observe(["a"])).toBe("nudge")
    d.reset()
    expect(d.observe(["a"])).toBe("ok") // fresh
    expect(d.observe(["a"])).toBe("ok")
    expect(d.observe(["a"])).toBe("nudge") // nudge again (latch cleared), not abort
  })

  test("custom limit of 2", () => {
    const d = new RepeatDetector(2)
    expect(d.observe(["a"])).toBe("ok")
    expect(d.observe(["a"])).toBe("nudge")
    expect(d.observe(["a"])).toBe("abort")
  })
})
