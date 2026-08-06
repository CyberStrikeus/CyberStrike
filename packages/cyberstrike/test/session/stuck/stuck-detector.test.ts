import { describe, expect, test } from "bun:test"
import { StuckDetector } from "../../../src/session/stuck/stuck-detector"

const cfg = { enabled: true, maxMonologue: 3 }
const readOnly = { toolCalls: [{ tool: "methodology_status" }] } // no-progress step
const progress = { toolCalls: [{ tool: "bash" }] } // progress step
const prose = { toolCalls: [] } // text-only step (also no-progress)

describe("StuckDetector — monologue rule", () => {
  test("3 consecutive no-progress steps → nudge on the 3rd, abort on the 4th (two-strike)", () => {
    const d = new StuckDetector(cfg)
    expect(d.observe(readOnly).kind).toBe("ok")
    expect(d.observe(readOnly).kind).toBe("ok")
    expect(d.observe(readOnly).kind).toBe("nudge")
    expect(d.observe(readOnly).kind).toBe("abort")
  })

  test("prose-only (0 tool calls) counts as no-progress", () => {
    const d = new StuckDetector(cfg)
    expect(d.observe(prose).kind).toBe("ok")
    expect(d.observe(prose).kind).toBe("ok")
    expect(d.observe(prose).kind).toBe("nudge")
  })

  test("progress resets the streak", () => {
    const d = new StuckDetector(cfg)
    d.observe(readOnly)
    d.observe(readOnly)
    expect(d.observe(progress).kind).toBe("ok") // reset
    expect(d.observe(readOnly).kind).toBe("ok") // streak back to 1
    expect(d.observe(readOnly).kind).toBe("ok") // 2
    expect(d.observe(readOnly).kind).toBe("nudge") // 3 → nudge again
  })

  test("a step mixing read-only AND a progress tool counts as progress", () => {
    const d = new StuckDetector(cfg)
    d.observe(readOnly)
    d.observe(readOnly)
    expect(d.observe({ toolCalls: [{ tool: "methodology_status" }, { tool: "bash" }] }).kind).toBe("ok")
  })

  test("nudged latch persists across an intervening progress step (2nd strike still aborts)", () => {
    const d = new StuckDetector(cfg)
    d.observe(readOnly)
    d.observe(readOnly)
    expect(d.observe(readOnly).kind).toBe("nudge") // 1st strike, nudged=true
    d.observe(progress) // streak resets, nudged stays
    d.observe(readOnly)
    d.observe(readOnly)
    expect(d.observe(readOnly).kind).toBe("abort") // reaches threshold again → abort
  })

  test("disabled → always ok", () => {
    const d = new StuckDetector({ enabled: false, maxMonologue: 3 })
    for (let i = 0; i < 10; i++) expect(d.observe(readOnly).kind).toBe("ok")
  })

  test("reset clears streak and nudged latch", () => {
    const d = new StuckDetector(cfg)
    d.observe(readOnly)
    d.observe(readOnly)
    expect(d.observe(readOnly).kind).toBe("nudge")
    d.reset()
    expect(d.observe(readOnly).kind).toBe("ok") // fresh
    expect(d.observe(readOnly).kind).toBe("ok")
    expect(d.observe(readOnly).kind).toBe("nudge") // nudge (not abort) → latch was cleared
  })
})
