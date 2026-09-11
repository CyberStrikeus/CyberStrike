import { describe, expect, test } from "bun:test"
import type { Transaction, Header } from "../src/index"
import { missingSecurityHeaders, weakCookieFlags, serverBanner, defaultRegistry } from "../src/index"

function tx(responseHeaders: Header[] | null, over: Partial<Transaction> = {}): Transaction {
  return {
    id: over.id ?? "t1",
    source: "browser",
    host: "app.test",
    request: { method: "GET", url: "https://app.test/api/x", headers: [] },
    response: responseHeaders === null ? undefined : { status: 200, headers: responseHeaders },
    ...over,
  }
}
const h = (name: string, value: string): Header => ({ name, value })

describe("missing-security-headers", () => {
  test("fires listing every missing header", () => {
    const s = missingSecurityHeaders.evaluate(tx([h("content-type", "application/json")]))
    expect(s).toHaveLength(1)
    expect(s[0].evidence).toContain("HSTS")
    expect(s[0].evidence).toContain("CSP")
    expect(s[0].evidence).toContain("X-Content-Type-Options")
    expect(s[0].evidence).toContain("X-Frame-Options")
  })
  test("clean when all present — and X-Frame-Options satisfied by CSP frame-ancestors", () => {
    const s = missingSecurityHeaders.evaluate(
      tx([
        h("strict-transport-security", "max-age=31536000"),
        h("content-security-policy", "default-src 'none'; frame-ancestors 'none'"),
        h("x-content-type-options", "nosniff"),
      ]),
    )
    expect(s).toHaveLength(0)
  })
  test("no response ⇒ no-op", () => {
    expect(missingSecurityHeaders.evaluate(tx(null))).toHaveLength(0)
  })
})

describe("weak-cookie-flags", () => {
  test("flags exactly the flags a cookie lacks", () => {
    const s = weakCookieFlags.evaluate(tx([h("set-cookie", "sid=abc123; Path=/")]))
    expect(s).toHaveLength(1)
    expect(s[0].title).toContain("HttpOnly")
    expect(s[0].title).toContain("Secure")
    expect(s[0].title).toContain("SameSite")
  })
  test("clean when hardened", () => {
    const s = weakCookieFlags.evaluate(tx([h("set-cookie", "sid=abc; Path=/; HttpOnly; Secure; SameSite=Lax")]))
    expect(s).toHaveLength(0)
  })
  test("does not false-match when the VALUE contains 'secure'", () => {
    const s = weakCookieFlags.evaluate(tx([h("set-cookie", "token=secure_samesite_value; HttpOnly; Secure; SameSite=Strict")]))
    expect(s).toHaveLength(0)
  })
  test("one signal per Set-Cookie", () => {
    const s = weakCookieFlags.evaluate(tx([h("set-cookie", "a=1"), h("set-cookie", "b=2; HttpOnly; Secure; SameSite=Lax")]))
    expect(s).toHaveLength(1)
    expect(s[0].title).toContain('"a"')
  })
})

describe("server-banner", () => {
  test("fires for Server and X-Powered-By separately", () => {
    const s = serverBanner.evaluate(tx([h("server", "uvicorn"), h("x-powered-by", "Express")]))
    expect(s).toHaveLength(2)
    expect(s.map((x) => x.evidence)).toEqual(["Server: uvicorn", "X-Powered-By: Express"])
  })
  test("also fires for framework/version banners (x-aspnet-version, x-generator) — CS parity", () => {
    const s = serverBanner.evaluate(tx([h("x-aspnet-version", "4.0.30319"), h("x-generator", "Drupal 9")]))
    expect(s.map((x) => x.evidence)).toEqual(["x-aspnet-version: 4.0.30319", "x-generator: Drupal 9"])
  })
})

describe("defaultRegistry", () => {
  test("runs the baseline pack: a bare API response yields missing-headers + banner signals, no agent needed", () => {
    const signals = defaultRegistry().run(tx([h("content-type", "application/json"), h("server", "uvicorn")]))
    const ids = signals.map((s) => s.ruleId)
    expect(ids).toContain("missing-security-headers")
    expect(ids).toContain("server-banner")
    // Every signal points back at the transaction it fired on.
    expect(signals.every((s) => s.transactionId === "t1")).toBe(true)
  })
})
