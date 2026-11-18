import { describe, expect, test } from "bun:test"
import type { Transaction, Header } from "../src/index"
import { missingSecurityHeaders, weakCookieFlags, bannerVersions, bannerDisclosures, defaultRegistry } from "../src/index"

// server-banner is now a pair of detect-once corpus rules (versioned → low, bare → info), one signal per
// host — promoted from the old per-header declarative rules so banner disclosure stops firing per endpoint.

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

describe("missing-security-headers (detect-once, per-host — #87)", () => {
  test("ONE signal per host listing every missing header, regardless of endpoint count", () => {
    // Three distinct endpoints on the same host, all missing headers → still ONE signal.
    const s = missingSecurityHeaders.evaluate([
      tx([h("content-type", "application/json")], { id: "a", request: { method: "GET", url: "https://app.test/api/a", headers: [] } }),
      tx([h("content-type", "application/json")], { id: "b", request: { method: "GET", url: "https://app.test/api/b", headers: [] } }),
      tx([h("content-type", "application/json")], { id: "c", request: { method: "GET", url: "https://app.test/api/c", headers: [] } }),
    ])
    expect(s).toHaveLength(1)
    expect(s[0].evidence).toContain("HSTS")
    expect(s[0].evidence).toContain("CSP")
    expect(s[0].evidence).toContain("X-Content-Type-Options")
    expect(s[0].evidence).toContain("X-Frame-Options")
    expect(s[0].evidence).toContain("Affected endpoints")
    expect(s[0].dedupKey).toBe("missing-security-headers:app.test")
  })
  test("one signal PER HOST — a multi-host session keeps each host visible", () => {
    const s = missingSecurityHeaders.evaluate([
      tx([h("content-type", "text/html")], { id: "1", host: "www.test", request: { method: "GET", url: "https://www.test/", headers: [] } }),
      tx([h("content-type", "text/html")], { id: "2", host: "admin.test", request: { method: "GET", url: "https://admin.test/", headers: [] } }),
    ])
    expect(s).toHaveLength(2)
    expect(new Set(s.map((x) => x.dedupKey))).toEqual(
      new Set(["missing-security-headers:www.test", "missing-security-headers:admin.test"]),
    )
  })
  test("clean when all present — and X-Frame-Options satisfied by CSP frame-ancestors", () => {
    const s = missingSecurityHeaders.evaluate([
      tx([
        h("strict-transport-security", "max-age=31536000"),
        h("content-security-policy", "default-src 'none'; frame-ancestors 'none'"),
        h("x-content-type-options", "nosniff"),
        h("referrer-policy", "no-referrer"),
        h("permissions-policy", "geolocation=()"),
      ]),
    ])
    expect(s).toHaveLength(0)
  })
  test("no response ⇒ no-op", () => {
    expect(missingSecurityHeaders.evaluate([tx(null)])).toHaveLength(0)
  })
})

describe("weak-cookie-flags (detect-once, per-host — #87)", () => {
  test("one host signal listing each weak cookie + the flags it lacks", () => {
    const s = weakCookieFlags.evaluate([tx([h("set-cookie", "sid=abc123; Path=/")])])
    expect(s).toHaveLength(1)
    expect(s[0].evidence).toContain("sid")
    expect(s[0].evidence).toContain("HttpOnly")
    expect(s[0].evidence).toContain("Secure")
    expect(s[0].evidence).toContain("SameSite")
    expect(s[0].dedupKey).toBe("weak-cookie-flags:app.test")
  })
  test("clean when hardened", () => {
    const s = weakCookieFlags.evaluate([tx([h("set-cookie", "sid=abc; Path=/; HttpOnly; Secure; SameSite=Lax")])])
    expect(s).toHaveLength(0)
  })
  test("does not false-match when the VALUE contains 'secure'", () => {
    const s = weakCookieFlags.evaluate([tx([h("set-cookie", "token=secure_samesite_value; HttpOnly; Secure; SameSite=Strict")])])
    expect(s).toHaveLength(0)
  })
  test("weak + hardened cookies on a host → one signal naming only the weak one", () => {
    const s = weakCookieFlags.evaluate([tx([h("set-cookie", "a=1"), h("set-cookie", "b=2; HttpOnly; Secure; SameSite=Lax")])])
    expect(s).toHaveLength(1)
    expect(s[0].evidence).toContain("a")
    expect(s[0].evidence).not.toContain("b (")
  })
})

describe("server-banner (detect-once, per-host — #87/#5)", () => {
  const ep = (host: string, id: string, p: string) => ({ id, host, request: { method: "GET", url: `https://${host}${p}`, headers: [] } })

  test("bare banners → ONE info signal per host, listing the banners + affected endpoints", () => {
    // Same bare banner on three endpoints of one host → still ONE signal (the old 100x-per-endpoint noise).
    const s = bannerDisclosures.evaluate([
      tx([h("server", "uvicorn"), h("x-powered-by", "Express")], ep("app.test", "a", "/api/a")),
      tx([h("server", "uvicorn")], ep("app.test", "b", "/api/b")),
      tx([h("server", "uvicorn")], ep("app.test", "c", "/api/c")),
    ])
    expect(s).toHaveLength(1)
    expect(s[0].severity).toBe("info")
    expect(s[0].evidence).toContain("Server: uvicorn")
    expect(s[0].evidence).toContain("X-Powered-By: Express")
    expect(s[0].evidence).toContain("Affected endpoints")
    expect(s[0].dedupKey).toBe("server-banner-bare:app.test")
  })
  test("covers the wider bare disclosure-header set (#5)", () => {
    const s = bannerDisclosures.evaluate([
      tx([h("x-served-by", "cache-fra-1"), h("x-drupal-dynamic-cache", "MISS"), h("x-generator", "Drupal 9")]),
    ])
    expect(s).toHaveLength(1)
    expect(s[0].evidence).toContain("x-served-by: cache-fra-1")
    expect(s[0].evidence).toContain("x-drupal-dynamic-cache: MISS")
    expect(s[0].evidence).toContain("x-generator: Drupal 9")
  })
  test("a versioned banner is low, not info — it feeds the version-CVE probe (#5)", () => {
    const versioned = bannerVersions.evaluate([tx([h("server", "Apache/2.4.49"), h("x-aspnet-version", "4.0.30319")])])
    expect(versioned).toHaveLength(1)
    expect(versioned[0].severity).toBe("low")
    expect(versioned[0].evidence).toContain("Server: Apache/2.4.49")
    expect(versioned[0].dedupKey).toBe("server-banner:app.test")
    // the bare rule does not double-fire on the same (versioned) headers
    expect(bannerDisclosures.evaluate([tx([h("server", "Apache/2.4.49")])])).toHaveLength(0)
  })
  test("one signal PER HOST — a multi-host session keeps each host visible", () => {
    const s = bannerDisclosures.evaluate([
      tx([h("server", "nginx")], ep("www.test", "1", "/")),
      tx([h("server", "nginx")], ep("admin.test", "2", "/")),
    ])
    expect(s).toHaveLength(2)
    expect(new Set(s.map((x) => x.dedupKey))).toEqual(new Set(["server-banner-bare:www.test", "server-banner-bare:admin.test"]))
  })
  test("clean when no disclosure header is present", () => {
    expect(bannerVersions.evaluate([tx([h("content-type", "application/json")])])).toHaveLength(0)
    expect(bannerDisclosures.evaluate([tx([h("content-type", "application/json")])])).toHaveLength(0)
  })
})

describe("defaultRegistry", () => {
  test("runs the baseline pack: a bare API response yields missing-headers + banner signals (both corpus), no agent needed", () => {
    // analyze() runs per-tx AND corpus rules over the whole set — missing-security-headers and the banner
    // rules are now per-host corpus rules, so the single-tx run() no longer carries them; analyze() does.
    const signals = defaultRegistry().analyze([tx([h("content-type", "application/json"), h("server", "uvicorn")])])
    const ids = signals.map((s) => s.ruleId)
    expect(ids).toContain("missing-security-headers")
    expect(ids).toContain("server-banner-bare") // uvicorn is a bare banner → info rule
    expect(signals.every((s) => s.transactionId === "t1")).toBe(true)
  })
})
