import { describe, expect, test } from "bun:test"
import type { Transaction } from "../src/index"
import { compileRules, misconfigRules } from "../src/index"

const rules = compileRules(misconfigRules)
function tx(over: { reqHeaders?: [string, string][]; respHeaders?: [string, string][]; body?: string }): Transaction {
  return {
    id: "t",
    source: "browser",
    host: "app.test",
    request: { method: "GET", url: "https://app.test/x", headers: (over.reqHeaders ?? []).map(([n, v]) => ({ name: n, value: v })) },
    response: { status: 200, headers: (over.respHeaders ?? []).map(([n, v]) => ({ name: n, value: v })), body: over.body ?? "" },
  }
}
const fired = (t: Transaction) => rules.flatMap((r) => r.evaluate(t)).map((s) => s.ruleId)

describe("misconfig catalog — each rule fires on a true positive and stays quiet on a clean one", () => {
  test("cors-origin-reflection-with-credentials", () => {
    expect(fired(tx({ reqHeaders: [["origin", "https://evil.com"]], respHeaders: [["access-control-allow-origin", "https://evil.com"], ["access-control-allow-credentials", "true"]] }))).toContain("cors-origin-reflection-with-credentials")
    // reflection WITHOUT credentials → does not fire
    expect(fired(tx({ reqHeaders: [["origin", "https://evil.com"]], respHeaders: [["access-control-allow-origin", "https://evil.com"]] }))).not.toContain("cors-origin-reflection-with-credentials")
    // two absent headers must NOT match (empty==empty guard)
    expect(fired(tx({}))).not.toContain("cors-origin-reflection-with-credentials")
  })
  test("cors-wildcard-origin", () => {
    expect(fired(tx({ respHeaders: [["access-control-allow-origin", "*"]] }))).toContain("cors-wildcard-origin")
    expect(fired(tx({ respHeaders: [["access-control-allow-origin", "https://app.test"]] }))).not.toContain("cors-wildcard-origin")
  })
  test("directory-listing", () => {
    expect(fired(tx({ body: "<html><title>Index of /var/www</title>..." }))).toContain("directory-listing")
    expect(fired(tx({ body: "<html><title>Dashboard</title>" }))).not.toContain("directory-listing")
  })
  test("debug-console-exposed", () => {
    expect(fired(tx({ body: "Traceback ... Werkzeug Debugger ... console" }))).toContain("debug-console-exposed")
    expect(fired(tx({ body: "You're seeing this error because you have DEBUG = True in your settings" }))).toContain("debug-console-exposed")
    expect(fired(tx({ body: "normal 200 page" }))).not.toContain("debug-console-exposed")
  })
  test("graphql-introspection-enabled", () => {
    expect(fired(tx({ body: '{"data":{"__schema":{"queryType":{"name":"Query"}}}}' }))).toContain("graphql-introspection-enabled")
    expect(fired(tx({ body: '{"data":{"user":{"id":1}}}' }))).not.toContain("graphql-introspection-enabled")
  })
  test("internal-hostname-leak", () => {
    expect(fired(tx({ body: "could not connect to db01.internal:5432" }))).toContain("internal-hostname-leak")
    expect(fired(tx({ body: "visit https://example.com for docs" }))).not.toContain("internal-hostname-leak")
  })
})
