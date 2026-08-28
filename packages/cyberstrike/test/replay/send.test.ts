import { describe, test, expect } from "bun:test"
import { Send } from "../../src/replay/send"
import { Governor } from "../../src/replay/governor"
import type { ReplayResponse } from "../../src/replay/response"

const noSleep = async () => {}
const fixedNow = () => 0

function ok(status = 200, retryAfter = false): ReplayResponse.Result {
  return {
    response: {
      version: "HTTP/1.1",
      status,
      reason: "",
      headers: retryAfter ? [{ name: "Retry-After", value: "1" }] : [],
      body: new Uint8Array(0),
    },
    timing: { totalMs: 1 },
  }
}
function err(kind: string): ReplayResponse.Result {
  return { error: { kind: kind as never, message: kind }, timing: { totalMs: 1 } }
}

/** A thunk that returns a scripted sequence of results, one per call. */
function scripted(seq: ReplayResponse.Result[]): () => Promise<ReplayResponse.Result> {
  let i = 0
  return async () => seq[Math.min(i++, seq.length - 1)]
}

describe("Send.governed — success & feedback", () => {
  test("returns on first success and grows the limiter", async () => {
    const limiter = new Governor.AimdLimiter(2, 10)
    const r = await Send.governed(scripted([ok()]), "GET", { limiter }, { sleep: noSleep, now: fixedNow })
    expect(r.response?.status).toBe(200)
    expect(r.attempts).toBe(1)
    expect(limiter.value).toBe(3) // onSuccess
  })
})

describe("Send.governed — retry & idempotency", () => {
  test("retries a transient error on an idempotent method", async () => {
    const r = await Send.governed(scripted([err("reset"), ok()]), "GET", {}, { sleep: noSleep, now: fixedNow })
    expect(r.response?.status).toBe(200)
    expect(r.attempts).toBe(2)
    expect(r.retried).toBe(true)
  })

  test("does NOT retry a transient error on a state-changing method", async () => {
    const r = await Send.governed(scripted([err("reset"), ok()]), "POST", {}, { sleep: noSleep, now: fixedNow })
    expect(r.error?.kind).toBe("reset")
    expect(r.attempts).toBe(1) // no retry — idempotency guard
  })

  test("safeToRetry overrides the method guard", async () => {
    const r = await Send.governed(
      scripted([err("reset"), ok()]),
      "POST",
      {},
      { sleep: noSleep, now: fixedNow, safeToRetry: true },
    )
    expect(r.response?.status).toBe(200)
    expect(r.attempts).toBe(2)
  })

  test("a timeout is never retried and throttles the limiter", async () => {
    const limiter = new Governor.AimdLimiter(8, 20)
    const r = await Send.governed(
      scripted([err("timeout"), ok()]),
      "GET",
      { limiter },
      { sleep: noSleep, now: fixedNow },
    )
    expect(r.error?.kind).toBe("timeout")
    expect(r.attempts).toBe(1)
    expect(limiter.value).toBe(4) // halved
  })

  test("stops after maxRetries", async () => {
    const r = await Send.governed(
      scripted([err("reset"), err("reset"), err("reset"), err("reset")]),
      "GET",
      {},
      { sleep: noSleep, now: fixedNow, maxRetries: 2 },
    )
    expect(r.error?.kind).toBe("reset")
    expect(r.attempts).toBe(3) // 1 initial + 2 retries
  })
})

describe("Send.governed — rate limiting", () => {
  test("a 429 throttles and retries, then succeeds", async () => {
    const limiter = new Governor.AimdLimiter(8, 20)
    const r = await Send.governed(
      scripted([ok(429, false), ok(200)]),
      "GET",
      { limiter },
      { sleep: noSleep, now: fixedNow },
    )
    expect(r.response?.status).toBe(200)
    expect(r.attempts).toBe(2)
    // 429 halved (8->4), then success grew (4->5)
    expect(limiter.value).toBe(5)
  })
})

describe("Send.governed — guards", () => {
  test("skips when the global budget is exhausted", async () => {
    const budget = new Governor.GlobalBudget(0)
    const r = await Send.governed(scripted([ok()]), "GET", { budget }, { sleep: noSleep, now: fixedNow })
    expect(r.skipped).toBe("budget")
    expect(r.attempts).toBe(0)
  })

  test("skips when the circuit breaker is open", async () => {
    const breaker = new Governor.CircuitBreaker(1, 10_000)
    breaker.onFailure(0) // opens (threshold 1)
    const r = await Send.governed(scripted([ok()]), "GET", { breaker }, { sleep: noSleep, now: fixedNow })
    expect(r.skipped).toBe("circuit")
    expect(r.attempts).toBe(0)
  })
})
