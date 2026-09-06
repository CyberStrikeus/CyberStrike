import { describe, expect, test } from "bun:test"
import { RaceEngine, type RaceReport } from "../../src/tool/webhook/business/race"
import type { HttpSender, ProbeRequest } from "../../src/tool/webhook/transport"

const req = (): ProbeRequest => ({
  method: "POST",
  url: "https://app.example.com/api/apply-coupon",
  headers: { "Content-Type": "application/json" },
  body: '{"coupon":"SAVE50"}',
})

// A server that accepts the first N requests, then rejects the rest —
// simulates a once-only operation with a TOCTOU race window.
function racyServer(acceptCount: number): HttpSender {
  let accepted = 0
  return {
    async send() {
      if (accepted < acceptCount) {
        accepted++
        return { status: 200, headers: {}, body: '{"ok":true,"discount":"50%"}' }
      }
      return { status: 409, headers: {}, body: '{"error":"coupon already used"}' }
    },
  }
}

// A server that always succeeds (no race guard).
function alwaysOkServer(): HttpSender {
  return {
    async send() {
      return { status: 200, headers: {}, body: '{"ok":true,"discount":"50%"}' }
    },
  }
}

// A server that always rejects (not vulnerable).
function alwaysRejectServer(): HttpSender {
  return {
    async send() {
      return { status: 403, headers: {}, body: '{"error":"forbidden"}' }
    },
  }
}

// A server where some requests error at transport level.
function flakyServer(): HttpSender {
  let i = 0
  return {
    async send() {
      return ++i % 3 === 0 ? { error: "connection reset" } : { status: 200, headers: {}, body: "ok" }
    },
  }
}

describe("RaceEngine", () => {
  test("detects TOCTOU: mixed 200+409 on a once-only endpoint", async () => {
    const engine = new RaceEngine(racyServer(3))
    const report = await engine.run({ request: req(), count: 10, concurrency: 10 })

    expect(report.count).toBe(10)
    expect(report.inconsistent).toBe(true)
    expect(report.statusDistribution[200]).toBe(3)
    expect(report.statusDistribution[409]).toBe(7)
    expect(report.signals.some((s) => s.includes("mixed-status"))).toBe(true)
    expect(report.signals.some((s) => s.includes("multiple-success"))).toBe(true)
    expect(report.results).toHaveLength(10)
  })

  test("detects missing race guard: all requests succeed", async () => {
    const engine = new RaceEngine(alwaysOkServer())
    const report = await engine.run({ request: req(), count: 5, concurrency: 5 })

    expect(report.inconsistent).toBe(true)
    expect(report.successCount).toBe(5)
    expect(report.signals.some((s) => s.includes("multiple-success"))).toBe(true)
    expect(report.signals.some((s) => s.includes("mixed-status"))).toBe(false)
    expect(report.uniqueBodyLengths).toHaveLength(1)
  })

  test("no false positive: all requests rejected", async () => {
    const engine = new RaceEngine(alwaysRejectServer())
    const report = await engine.run({ request: req(), count: 5, concurrency: 5 })

    expect(report.inconsistent).toBe(false)
    expect(report.successCount).toBe(0)
    expect(report.statusDistribution[403]).toBe(5)
    expect(report.signals).toHaveLength(0)
  })

  test("handles transport errors without throwing", async () => {
    const engine = new RaceEngine(flakyServer())
    const report = await engine.run({ request: req(), count: 9, concurrency: 9 })

    const errors = report.results.filter((r) => r.error)
    expect(errors.length).toBe(3) // every 3rd request errors
    expect(report.signals.some((s) => s.includes("partial-error"))).toBe(true)
    expect(report.results).toHaveLength(9)
  })

  test("timing stats are computed correctly", async () => {
    const engine = new RaceEngine(alwaysOkServer())
    const report = await engine.run({ request: req(), count: 3, concurrency: 3 })

    expect(report.timingRange.minMs).toBeGreaterThanOrEqual(0)
    expect(report.timingRange.maxMs).toBeGreaterThanOrEqual(report.timingRange.minMs)
    expect(report.timingRange.medianMs).toBeGreaterThanOrEqual(report.timingRange.minMs)
    expect(report.timingRange.medianMs).toBeLessThanOrEqual(report.timingRange.maxMs)
  })

  test("defaults count and concurrency when not specified", async () => {
    const engine = new RaceEngine(alwaysRejectServer())
    const report = await engine.run({ request: req() })

    expect(report.count).toBe(20) // DEFAULT_COUNT
    expect(report.concurrency).toBe(20) // DEFAULT_CONCURRENCY
    expect(report.results).toHaveLength(20)
  })

  test("body preview is truncated to 200 chars", async () => {
    const longBody = "x".repeat(500)
    const server: HttpSender = { async send() { return { status: 200, headers: {}, body: longBody } } }
    const report = await new RaceEngine(server).run({ request: req(), count: 1, concurrency: 1 })

    expect(report.results[0].bodyPreview).toHaveLength(200)
    expect(report.results[0].bodyLength).toBe(500)
  })
})

describe("RaceEngine — rateLimitAbsent", () => {
  test("flags rate_limit_absent when all requests succeed with no 429", async () => {
    const engine = new RaceEngine(alwaysOkServer())
    const report = await engine.run({ request: req(), count: 5, concurrency: 5 })

    expect(report.rateLimitAbsent).toBe(true)
    expect(report.signals.some((s) => s.includes("rate-limit-absent"))).toBe(true)
  })

  test("does NOT flag rate_limit_absent when server returns 429", async () => {
    let i = 0
    const server: HttpSender = {
      async send() {
        return ++i <= 3
          ? { status: 200, headers: {}, body: "ok" }
          : { status: 429, headers: {}, body: "rate limited" }
      },
    }
    const engine = new RaceEngine(server)
    const report = await engine.run({ request: req(), count: 5, concurrency: 1 })

    expect(report.rateLimitAbsent).toBe(false)
    expect(report.signals.some((s) => s.includes("rate-limit-absent"))).toBe(false)
  })

  test("does NOT flag rate_limit_absent when all requests are rejected (403)", async () => {
    const engine = new RaceEngine(alwaysRejectServer())
    const report = await engine.run({ request: req(), count: 5, concurrency: 5 })

    expect(report.rateLimitAbsent).toBe(false)
    expect(report.signals.some((s) => s.includes("rate-limit-absent"))).toBe(false)
  })

  test("does NOT flag rate_limit_absent when only 1 success (needs >= 2)", async () => {
    let sent = false
    const server: HttpSender = {
      async send() {
        if (!sent) { sent = true; return { status: 200, headers: {}, body: "ok" } }
        return { error: "connection reset" }
      },
    }
    const report = await new RaceEngine(server).run({ request: req(), count: 3, concurrency: 1 })

    expect(report.rateLimitAbsent).toBe(false)
  })

  test("flags on TOCTOU scenario (mixed 200+409 but no 429)", async () => {
    const engine = new RaceEngine(racyServer(3))
    const report = await engine.run({ request: req(), count: 10, concurrency: 10 })

    expect(report.rateLimitAbsent).toBe(true)
    expect(report.inconsistent).toBe(true)
  })
})
