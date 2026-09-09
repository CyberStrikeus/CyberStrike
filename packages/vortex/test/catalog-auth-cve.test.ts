import { describe, expect, test } from "bun:test"
import type { Transaction } from "../src/index"
import { compileRules, authRules, cveRules } from "../src/index"

const rules = [...compileRules(authRules), ...compileRules(cveRules)]
const fired = (t: Transaction) => rules.flatMap((r) => r.evaluate(t)).map((s) => s.ruleId)
function tx(over: { url?: string; reqHeaders?: [string, string][]; status?: number; respHeaders?: [string, string][]; body?: string }): Transaction {
  return {
    id: "t",
    source: "browser",
    host: "app.test",
    request: { method: "GET", url: `https://app.test${over.url ?? "/x"}`, headers: (over.reqHeaders ?? []).map(([n, v]) => ({ name: n, value: v })) },
    response: { status: over.status ?? 200, headers: (over.respHeaders ?? []).map(([n, v]) => ({ name: n, value: v })), body: over.body ?? "" },
  }
}
const b64u = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url")
const jwt = (alg: string) => `${b64u({ alg })}.${b64u({ sub: "admin" })}.sig`

describe("auth catalog", () => {
  test("jwt-alg-none fires on an unsigned bearer (None/NONE too), not on a signed one", () => {
    expect(fired(tx({ url: "/api/me", reqHeaders: [["authorization", `Bearer ${jwt("none")}`]] }))).toContain("jwt-alg-none")
    expect(fired(tx({ url: "/api/me", reqHeaders: [["authorization", `Bearer ${jwt("NONE")}`]] }))).toContain("jwt-alg-none")
    expect(fired(tx({ url: "/api/me", reqHeaders: [["authorization", `Bearer ${jwt("HS256")}`]] }))).not.toContain("jwt-alg-none")
    expect(fired(tx({ url: "/api/me" }))).not.toContain("jwt-alg-none")
  })
  test("secret-in-url fires on a token in the query, not on a benign param", () => {
    expect(fired(tx({ url: "/cb?access_token=abc123&state=x" }))).toContain("secret-in-url")
    expect(fired(tx({ url: "/search?q=hello&page=2" }))).not.toContain("secret-in-url")
  })
})

describe("cve / vulnerable-component catalog", () => {
  test("apache-path-traversal-cve fires only inside the 2.4.49–2.4.50 window on an Apache banner", () => {
    expect(fired(tx({ respHeaders: [["server", "Apache/2.4.49 (Unix)"]] }))).toContain("apache-path-traversal-cve-2021-41773")
    expect(fired(tx({ respHeaders: [["server", "Apache/2.4.50"]] }))).toContain("apache-path-traversal-cve-2021-41773")
    expect(fired(tx({ respHeaders: [["server", "Apache/2.4.52"]] }))).not.toContain("apache-path-traversal-cve-2021-41773") // patched
    expect(fired(tx({ respHeaders: [["server", "Apache/2.4.48"]] }))).not.toContain("apache-path-traversal-cve-2021-41773") // below window
    expect(fired(tx({ respHeaders: [["server", "nginx/2.4.49"]] }))).not.toContain("apache-path-traversal-cve-2021-41773") // not Apache
  })
  test("spring-actuator-exposed fires on the actuator JSON shape at 200", () => {
    expect(fired(tx({ url: "/actuator/env", body: '{"activeProfiles":["prod"],"propertySources":[]}' }))).toContain("spring-actuator-exposed")
    expect(fired(tx({ url: "/actuator/health", status: 404, body: "not found" }))).not.toContain("spring-actuator-exposed")
    expect(fired(tx({ url: "/api/x", body: '{"activeProfiles":[]}' }))).not.toContain("spring-actuator-exposed") // not an /actuator path
  })
})
