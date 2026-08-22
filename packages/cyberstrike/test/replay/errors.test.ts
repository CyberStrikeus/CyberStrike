import { describe, test, expect } from "bun:test"
import { ReplayError } from "../../src/replay/errors"

describe("ReplayError.classify", () => {
  test("maps common Node codes", () => {
    expect(ReplayError.classify({ code: "ENOTFOUND" })).toBe("dns")
    expect(ReplayError.classify({ code: "EAI_AGAIN" })).toBe("dns")
    expect(ReplayError.classify({ code: "ECONNREFUSED" })).toBe("conn_refused")
    expect(ReplayError.classify({ code: "ETIMEDOUT" })).toBe("timeout")
    expect(ReplayError.classify({ code: "ECONNRESET" })).toBe("reset")
    expect(ReplayError.classify({ code: "EHOSTUNREACH" })).toBe("unreachable")
  })

  test("treats AbortError / TimeoutError as timeout", () => {
    expect(ReplayError.classify({ name: "AbortError" })).toBe("timeout")
    expect(ReplayError.classify({ name: "TimeoutError" })).toBe("timeout")
  })

  test("detects TLS failures by code and message", () => {
    expect(ReplayError.classify({ code: "ERR_TLS_CERT_ALTNAME_INVALID" })).toBe("tls")
    expect(ReplayError.classify({ message: "unable to verify the first certificate" })).toBe("tls")
    expect(ReplayError.classify({ code: "DEPTH_ZERO_SELF_SIGNED_CERT" })).toBe("tls")
  })

  test("unwraps a wrapped cause (fetch style)", () => {
    const err = { name: "TypeError", message: "fetch failed", cause: { code: "ECONNREFUSED" } }
    expect(ReplayError.classify(err)).toBe("conn_refused")
  })

  test("returns unknown when nothing matches — never guesses timeout", () => {
    expect(ReplayError.classify({ code: "ESOMETHING" })).toBe("unknown")
    expect(ReplayError.classify("a string")).toBe("unknown")
    expect(ReplayError.classify(null)).toBe("unknown")
  })
})

describe("ReplayError.isRateLimited", () => {
  test("429 is always rate limited", () => {
    expect(ReplayError.isRateLimited(429, false)).toBe(true)
  })
  test("503 only with Retry-After", () => {
    expect(ReplayError.isRateLimited(503, true)).toBe(true)
    expect(ReplayError.isRateLimited(503, false)).toBe(false)
  })
  test("200 is not rate limited", () => {
    expect(ReplayError.isRateLimited(200, true)).toBe(false)
  })
})

describe("ReplayError.isRetryable — idempotency guard", () => {
  test("transient + idempotent method is retryable", () => {
    expect(ReplayError.isRetryable("reset", "GET")).toBe(true)
    expect(ReplayError.isRetryable("dns", "HEAD")).toBe(true)
  })

  test("state-changing methods are never auto-retried", () => {
    expect(ReplayError.isRetryable("reset", "POST")).toBe(false)
    expect(ReplayError.isRetryable("dns", "DELETE")).toBe(false)
  })

  test("safeToRetry overrides the method guard", () => {
    expect(ReplayError.isRetryable("reset", "POST", true)).toBe(true)
  })

  test("timeout is never retryable (may be time-based evidence)", () => {
    expect(ReplayError.isRetryable("timeout", "GET")).toBe(false)
    expect(ReplayError.isRetryable("timeout", "GET", true)).toBe(false)
  })

  test("http_error / rate_limited are not transport-retryable here", () => {
    expect(ReplayError.isRetryable("http_error", "GET")).toBe(false)
    expect(ReplayError.isRetryable("rate_limited", "GET")).toBe(false)
  })
})
