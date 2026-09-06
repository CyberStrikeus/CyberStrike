import { describe, test, expect } from "bun:test"
import { createBackoff, recordBlock, recordSuccess } from "../../../src/tool/inject-probe/probe/base"

describe("BackoffState", () => {
  test("createBackoff returns correct initial state", () => {
    const b = createBackoff(100)
    expect(b.delay).toBe(100)
    expect(b.consecutiveBlocks).toBe(0)
    expect(b.totalBlocks).toBe(0)
    expect(b.escalations).toEqual([])
  })

  test("first recordBlock escalates delay to 500ms and returns continue", () => {
    const b = createBackoff(0)
    const result = recordBlock(b)
    expect(result).toBe("continue")
    expect(b.delay).toBe(500)
    expect(b.consecutiveBlocks).toBe(1)
    expect(b.totalBlocks).toBe(1)
    expect(b.escalations).toHaveLength(1)
    expect(b.escalations[0]).toContain("500ms")
  })

  test("recordSuccess resets consecutiveBlocks to 0", () => {
    const b = createBackoff(0)
    recordBlock(b)
    expect(b.consecutiveBlocks).toBe(1)
    recordSuccess(b)
    expect(b.consecutiveBlocks).toBe(0)
    expect(b.totalBlocks).toBe(1)
  })

  test("3 consecutive blocks returns skip-point", () => {
    const b = createBackoff(0)
    recordBlock(b)
    recordBlock(b)
    const result = recordBlock(b)
    expect(result).toBe("skip-point")
    expect(b.consecutiveBlocks).toBe(3)
  })

  test("recordSuccess breaks consecutive streak — 3rd block after reset returns continue", () => {
    const b = createBackoff(0)
    recordBlock(b)
    recordBlock(b)
    recordSuccess(b)
    expect(b.consecutiveBlocks).toBe(0)
    const result = recordBlock(b)
    expect(result).toBe("continue")
    expect(b.consecutiveBlocks).toBe(1)
    expect(b.totalBlocks).toBe(3)
  })

  test("5 total blocks escalates delay to 2000ms", () => {
    const b = createBackoff(0)
    recordBlock(b)
    recordSuccess(b)
    recordBlock(b)
    recordSuccess(b)
    recordBlock(b)
    recordSuccess(b)
    recordBlock(b)
    recordSuccess(b)
    recordBlock(b)
    expect(b.totalBlocks).toBe(5)
    expect(b.delay).toBe(2000)
    expect(b.escalations.some((e) => e.includes("2000ms"))).toBe(true)
  })

  test("does not re-escalate if delay already >= 500", () => {
    const b = createBackoff(500)
    recordBlock(b)
    expect(b.delay).toBe(500)
    expect(b.escalations).toHaveLength(0)
  })

  test("does not re-escalate to 2000 if delay already >= 2000", () => {
    const b = createBackoff(2000)
    for (let i = 0; i < 6; i++) {
      recordBlock(b)
      if (i < 5) recordSuccess(b)
    }
    expect(b.delay).toBe(2000)
    expect(b.escalations).toHaveLength(0)
  })

  test("escalations array records each escalation message", () => {
    const b = createBackoff(0)
    recordBlock(b)
    expect(b.escalations).toHaveLength(1)
    recordSuccess(b)
    recordBlock(b)
    recordSuccess(b)
    recordBlock(b)
    recordSuccess(b)
    recordBlock(b)
    recordSuccess(b)
    recordBlock(b)
    expect(b.escalations).toHaveLength(2)
  })
})
