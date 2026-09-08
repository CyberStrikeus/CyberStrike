import { describe, expect, test } from "bun:test"
import type { Transaction } from "../src/index"
import { crossIdentityAccess, unauthenticatedReach, defaultRegistry, missingSecurityHeaders } from "../src/index"

let n = 0
function tx(url: string, status: number, identity?: string, method = "GET"): Transaction {
  return {
    id: `t${n++}`,
    source: "browser",
    host: "app.test",
    identity,
    request: { method, url: `https://app.test${url}`, headers: [] },
    response: { status, headers: [] },
  }
}

describe("cross-identity-access (corpus rule)", () => {
  test("fires once for an endpoint reached with 2xx under two identities", () => {
    const s = crossIdentityAccess.evaluate([tx("/api/users/1", 200, "org1"), tx("/api/users/2", 200, "org2")])
    expect(s).toHaveLength(1)
    expect(s[0].evidence).toContain("org1")
    expect(s[0].evidence).toContain("org2")
  })
  test("does NOT fire when only one identity reached it", () => {
    expect(crossIdentityAccess.evaluate([tx("/api/x", 200, "org1"), tx("/api/x", 200, "org1")])).toHaveLength(0)
  })
  test("ignores non-2xx (a 403 for org2 is not 'reached')", () => {
    expect(crossIdentityAccess.evaluate([tx("/api/x", 200, "org1"), tx("/api/x", 403, "org2")])).toHaveLength(0)
  })
})

describe("unauthenticated-reach (corpus rule)", () => {
  test("fires when an endpoint is reached both authenticated and anonymously", () => {
    const s = unauthenticatedReach.evaluate([tx("/api/secret", 200, "org1"), tx("/api/secret", 200, undefined)])
    expect(s).toHaveLength(1)
    expect(s[0].severity).toBe("medium")
  })
  test("does NOT fire when only authenticated", () => {
    expect(unauthenticatedReach.evaluate([tx("/api/secret", 200, "org1")])).toHaveLength(0)
  })
})

describe("defaultRegistry.analyze — corpus + per-tx, deduped", () => {
  test("100 hits of one endpoint collapse to a single missing-headers signal (no 100x noise)", () => {
    const txs: Transaction[] = []
    for (let i = 0; i < 100; i++) txs.push(tx("/api/list", 200, "org1"))
    const signals = defaultRegistry().analyze(txs).filter((s) => s.ruleId === "missing-security-headers")
    expect(signals).toHaveLength(1)
  })
  test("surfaces the cross-identity access-control candidate deterministically", () => {
    const signals = defaultRegistry().analyze([tx("/api/users/1", 200, "org1"), tx("/api/users/2", 200, "org2")])
    expect(signals.some((s) => s.ruleId === "cross-identity-access")).toBe(true)
  })
})

describe("scope — header rule skips redirects and static assets", () => {
  const bare = (over: Partial<Transaction>): Transaction => ({
    id: "s",
    source: "browser",
    host: "app.test",
    request: { method: "GET", url: "https://app.test/x", headers: [] },
    response: { status: 200, headers: [] },
    ...over,
  })
  test("no fire on a 301 redirect", () => {
    expect(missingSecurityHeaders.evaluate(bare({ response: { status: 301, headers: [] } }))).toHaveLength(0)
  })
  test("no fire on a .js asset", () => {
    expect(missingSecurityHeaders.evaluate(bare({ request: { method: "GET", url: "https://app.test/app.js", headers: [] } }))).toHaveLength(0)
  })
})
