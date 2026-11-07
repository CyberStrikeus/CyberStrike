// Characterization tests for the advanced cross-transaction corpus rules — they were registered and
// running but untested. These lock the current behavior (a prerequisite for ever migrating them to the
// declarative DSL): each rule gets a firing case + a non-firing case, asserting id/severity/evidence.
import { describe, expect, test } from "bun:test"
import type { Transaction } from "../src/index"
import { privilegeEscalation, methodConfusion, inconsistentAuth, cacheableAuth, headerDifferential } from "../src/index"

let n = 0
type Over = { method?: string; identity?: string; status?: number; bodyLength?: number; headers?: [string, string][] }
function tx(path: string, over: Over = {}): Transaction {
  return {
    id: `t${n++}`,
    source: "browser",
    host: "app.test",
    identity: over.identity,
    request: { method: over.method ?? "GET", url: `https://app.test${path}`, headers: [] },
    response: {
      status: over.status ?? 200,
      headers: (over.headers ?? []).map(([name, value]) => ({ name, value })),
      bodyLength: over.bodyLength,
    },
  }
}

describe("privilege-escalation-surface", () => {
  test("fires when one identity gets a >2x, >200B larger response on the same endpoint", () => {
    const s = privilegeEscalation.evaluate([
      tx("/data", { identity: "admin", bodyLength: 1000 }),
      tx("/data", { identity: "user", bodyLength: 100 }),
    ])
    expect(s).toHaveLength(1)
    expect(s[0].ruleId).toBe("privilege-escalation-surface")
    expect(s[0].severity).toBe("medium")
    expect(s[0].evidence).toContain("1000B")
    expect(s[0].evidence).toContain("100B")
  })
  test("does not fire when the size difference is small (< 2x and < 200B)", () => {
    expect(privilegeEscalation.evaluate([tx("/data", { identity: "admin", bodyLength: 150 }), tx("/data", { identity: "user", bodyLength: 120 })])).toHaveLength(0)
  })
  test("does not fire under a single identity", () => {
    expect(privilegeEscalation.evaluate([tx("/data", { identity: "admin", bodyLength: 1000 }), tx("/data", { identity: "admin", bodyLength: 100 })])).toHaveLength(0)
  })
})

describe("method-confusion", () => {
  test("fires when the same path succeeds under both a safe and a mutating method", () => {
    const s = methodConfusion.evaluate([tx("/submit", { method: "GET" }), tx("/submit", { method: "POST" })])
    expect(s).toHaveLength(1)
    expect(s[0].ruleId).toBe("method-confusion")
    expect(s[0].evidence).toContain("GET")
    expect(s[0].evidence).toContain("POST")
  })
  test("does not fire for a read-only path (GET only)", () => {
    expect(methodConfusion.evaluate([tx("/submit", { method: "GET" }), tx("/submit", { method: "HEAD" })])).toHaveLength(0)
  })
})

describe("inconsistent-auth", () => {
  test("fires when a minority of endpoints under an API prefix are reachable unauthenticated", () => {
    const s = inconsistentAuth.evaluate([
      tx("/api/v1/a", { identity: "org1" }),
      tx("/api/v1/b", { identity: "org1" }),
      tx("/api/v1/c", { identity: "org1" }),
      tx("/api/v1/secret", {}), // anonymous (no identity)
    ])
    expect(s).toHaveLength(1)
    expect(s[0].ruleId).toBe("inconsistent-auth")
    expect(s[0].evidence).toContain("unauthed")
  })
  test("does not fire when the whole prefix is public (no authed endpoints at all)", () => {
    expect(
      inconsistentAuth.evaluate([tx("/api/v1/a", {}), tx("/api/v1/b", {}), tx("/api/v1/c", {})]),
    ).toHaveLength(0)
  })
})

describe("cacheable-auth-response", () => {
  test("fires when an authenticated response allows caching", () => {
    const s = cacheableAuth.evaluate([tx("/account", { identity: "org1", headers: [["cache-control", "max-age=3600"]] })])
    expect(s).toHaveLength(1)
    expect(s[0].ruleId).toBe("cacheable-auth-response")
    expect(s[0].dedupKey).toContain("cacheable-auth-response:app.test")
  })
  test("does not fire when caching is suppressed (no-store/private)", () => {
    expect(cacheableAuth.evaluate([tx("/account", { identity: "org1", headers: [["cache-control", "private, no-store"]] })])).toHaveLength(0)
  })
  test("does not fire for an anonymous response", () => {
    expect(cacheableAuth.evaluate([tx("/public", { headers: [["cache-control", "max-age=3600"]] })])).toHaveLength(0)
  })
})

describe("response-header-differential", () => {
  test("fires when the Set-Cookie count differs across identities on one endpoint", () => {
    const s = headerDifferential.evaluate([
      tx("/data", { identity: "org1", headers: [["set-cookie", "a=1"]] }),
      tx("/data", { identity: "org2", headers: [] }),
    ])
    expect(s).toHaveLength(1)
    expect(s[0].ruleId).toBe("response-header-differential")
    expect(s[0].evidence).toContain("Set-Cookie count")
  })
  test("fires when a security header is present for one identity but not another", () => {
    const s = headerDifferential.evaluate([
      tx("/data", { identity: "org1", headers: [["content-security-policy", "default-src 'self'"]] }),
      tx("/data", { identity: "org2", headers: [] }),
    ])
    expect(s).toHaveLength(1)
    expect(s[0].evidence).toContain("content-security-policy")
  })
  test("does not fire when the header profile is identical", () => {
    expect(
      headerDifferential.evaluate([
        tx("/data", { identity: "org1", headers: [["content-security-policy", "default-src 'self'"]] }),
        tx("/data", { identity: "org2", headers: [["content-security-policy", "default-src 'none'"]] }),
      ]),
    ).toHaveLength(0)
  })
})
