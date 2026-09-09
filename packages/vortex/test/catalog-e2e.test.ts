import { describe, expect, test } from "bun:test"
import type { Transaction } from "../src/index"
import { MemoryStore, defaultRegistry, leads } from "../src/index"

// End-to-end: a realistic corpus → the REAL baseline catalog (defaultRegistry) analyzes it → signals
// → leads assembled for the agent. Proves the whole producer chain (DSL rule → signal → subjects →
// lead) with the shipped rules, not stubs.
const b64u = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url")
function tx(id: string, over: Partial<Transaction["request"]> & { method?: string; identity?: string; status?: number; respHeaders?: [string, string][]; respBody?: string }): Transaction {
  return {
    id,
    source: "browser",
    host: "app.test",
    identity: over.identity,
    request: { method: over.method ?? "GET", url: `https://app.test${over.url ?? "/x"}`, headers: over.headers ?? [] },
    response: { status: over.status ?? 200, headers: (over.respHeaders ?? []).map(([n, v]) => ({ name: n, value: v })), body: over.respBody ?? "" },
  }
}

describe("catalog end-to-end — real baseline rules over a corpus → signals → leads", () => {
  const store = new MemoryStore()
  store.add(tx("sql", { method: "POST", url: "/api/orders/42", status: 500, respBody: "You have an error in your SQL syntax near '1'" }))
  store.add(tx("cors", { url: "/api/data", headers: [{ name: "origin", value: "https://evil.com" }], respHeaders: [["access-control-allow-origin", "https://evil.com"], ["access-control-allow-credentials", "true"]] }))
  store.add(tx("jwt", { url: "/api/me", headers: [{ name: "authorization", value: `Bearer ${b64u({ alg: "none" })}.${b64u({ sub: "admin" })}.s` }] }))
  store.add(tx("apache", { url: "/", respHeaders: [["server", "Apache/2.4.49 (Unix)"]] }))
  // cross-identity value reuse chain
  store.add(tx("owner", { url: "/api/accounts/9988", identity: "org1", respBody: '{"account_id":"ACC-9988-XYZ"}' }))
  store.add(tx("attacker", { url: "/api/accounts?account=ACC-9988-XYZ", identity: "org2", respBody: '{"balance":100}' }))

  const signals = defaultRegistry().analyze(store.all())
  store.addSignals(signals)

  test("the shipped catalog fires across categories over one corpus", () => {
    const ids = new Set(signals.map((s) => s.ruleId))
    for (const expected of ["sql-error-signature", "cors-origin-reflection-with-credentials", "jwt-alg-none", "apache-path-traversal-cve-2021-41773", "cross-identity-value-reuse"]) {
      expect(ids.has(expected)).toBe(true)
    }
  })

  test("each signal becomes an agent lead carrying function + objects + role + raw", () => {
    const all = leads(store, signals)
    expect(all.length).toBeGreaterThanOrEqual(5)
    const sql = all.find((l) => l.signal.ruleId === "sql-error-signature")!
    expect(sql.function.endpoint).toBe("POST app.test/api/orders/{id}")
    expect(sql.function.crud).toBe("create")
    expect(sql.objects.map((o) => o.ref)).toContain("orders:42")
    expect(sql.raw.response).toContain("SQL syntax") // raw inline
    const jwt = all.find((l) => l.signal.ruleId === "jwt-alg-none")!
    expect(jwt.role).toBe("admin") // decoded from the token subject
  })
})
