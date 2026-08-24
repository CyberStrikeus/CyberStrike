import { describe, test, expect } from "bun:test"
import { Governor } from "../../src/replay/governor"

describe("CircuitBreaker", () => {
  test("opens after threshold consecutive failures", () => {
    const cb = new Governor.CircuitBreaker(3, 1000)
    expect(cb.canRequest(0)).toBe(true)
    cb.onFailure(0)
    cb.onFailure(0)
    expect(cb.current).toBe("closed")
    cb.onFailure(0)
    expect(cb.current).toBe("open")
    expect(cb.canRequest(500)).toBe(false) // still within cooldown
  })

  test("half-opens after cooldown, closes on success", () => {
    const cb = new Governor.CircuitBreaker(2, 1000)
    cb.onFailure(0)
    cb.onFailure(0)
    expect(cb.current).toBe("open")
    expect(cb.canRequest(1000)).toBe(true) // cooldown elapsed -> half-open probe
    expect(cb.current).toBe("half-open")
    cb.onSuccess()
    expect(cb.current).toBe("closed")
  })

  test("re-opens if the half-open probe fails", () => {
    const cb = new Governor.CircuitBreaker(2, 1000)
    cb.onFailure(0)
    cb.onFailure(0)
    cb.canRequest(1000) // -> half-open
    cb.onFailure(1000)
    expect(cb.current).toBe("open")
    expect(cb.canRequest(1500)).toBe(false)
  })

  test("a success resets the failure streak", () => {
    const cb = new Governor.CircuitBreaker(3, 1000)
    cb.onFailure(0)
    cb.onFailure(0)
    cb.onSuccess()
    cb.onFailure(0)
    cb.onFailure(0)
    expect(cb.current).toBe("closed") // streak restarted, only 2 since reset
  })
})

describe("AimdLimiter", () => {
  test("additive increase capped at max", () => {
    const l = new Governor.AimdLimiter(2, 4)
    expect(l.value).toBe(2)
    l.onSuccess()
    l.onSuccess()
    l.onSuccess()
    expect(l.value).toBe(4) // capped
  })

  test("multiplicative decrease, floor 1", () => {
    const l = new Governor.AimdLimiter(8, 20)
    l.onThrottle()
    expect(l.value).toBe(4)
    l.onThrottle()
    expect(l.value).toBe(2)
    l.onThrottle()
    l.onThrottle()
    expect(l.value).toBe(1) // never below 1
  })
})

describe("TokenBucket", () => {
  test("starts full and drains", () => {
    const b = new Governor.TokenBucket(5, 5, 0)
    for (let i = 0; i < 5; i++) expect(b.take(0)).toBe(true)
    expect(b.take(0)).toBe(false) // empty
  })

  test("refills over time at the configured rate", () => {
    const b = new Governor.TokenBucket(10, 10, 0)
    for (let i = 0; i < 10; i++) b.take(0)
    expect(b.take(0)).toBe(false)
    // 10 tokens/sec => 500ms yields 5 tokens
    expect(b.available(500)).toBeCloseTo(5, 5)
    expect(b.take(500)).toBe(true)
  })

  test("never exceeds capacity on refill", () => {
    const b = new Governor.TokenBucket(100, 3, 0)
    b.take(0)
    expect(b.available(10_000)).toBe(3) // capped at capacity, not 100
  })
})

describe("GlobalBudget", () => {
  test("consumes down to the cap then refuses", () => {
    const g = new Governor.GlobalBudget(3)
    expect(g.tryConsume()).toBe(true)
    expect(g.tryConsume()).toBe(true)
    expect(g.tryConsume()).toBe(true)
    expect(g.tryConsume()).toBe(false)
    expect(g.remaining).toBe(0)
    expect(g.consumed).toBe(3)
  })

  test("rejects an over-cap batch without partially consuming", () => {
    const g = new Governor.GlobalBudget(5)
    g.tryConsume(3)
    expect(g.tryConsume(3)).toBe(false) // 3+3 > 5
    expect(g.consumed).toBe(3) // unchanged
  })
})

describe("DEFAULTS", () => {
  test("match the approved values", () => {
    expect(Governor.DEFAULTS.totalTimeoutMs).toBe(30_000)
    expect(Governor.DEFAULTS.perHostConcurrencyMax).toBe(20)
    expect(Governor.DEFAULTS.globalRequestBudget).toBe(5_000)
    expect(Governor.DEFAULTS.agentPoolMax).toBe(4)
  })
})
