import { describe, expect, test } from "bun:test"
import type { Transaction } from "../src/index"
import { compileRules, misconfigRules } from "../src/index"

const rules = compileRules(misconfigRules)
function tx(over: { reqHeaders?: [string, string][]; respHeaders?: [string, string][]; body?: string; path?: string; status?: number }): Transaction {
  return {
    id: "t",
    source: "browser",
    host: "app.test",
    request: { method: "GET", url: `https://app.test${over.path ?? "/x"}`, headers: (over.reqHeaders ?? []).map(([n, v]) => ({ name: n, value: v })) },
    response: { status: over.status ?? 200, headers: (over.respHeaders ?? []).map(([n, v]) => ({ name: n, value: v })), body: over.body ?? "" },
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
  test("open-redirect-reflected fires on a 3xx off-origin Location reflected from the request", () => {
    expect(fired(tx({ path: "/out?next=https://evil.com", status: 302, respHeaders: [["location", "https://evil.com"]] }))).toContain("open-redirect-reflected")
    // same-origin relative redirect → not an open redirect
    expect(fired(tx({ path: "/login?next=/dashboard", status: 302, respHeaders: [["location", "/dashboard"]] }))).not.toContain("open-redirect-reflected")
    // off-origin Location NOT reflected from the request → not flagged (server-chosen redirect)
    expect(fired(tx({ path: "/logout", status: 302, respHeaders: [["location", "https://sso.app.test/end"]] }))).not.toContain("open-redirect-reflected")
  })
  test("exposed-artifact fires on a 200 for a VCS/config/backup path, not on a normal 200 or a 404", () => {
    expect(fired(tx({ path: "/.git/config", body: "[core]" }))).toContain("exposed-artifact")
    expect(fired(tx({ path: "/.env", body: "SECRET=1" }))).toContain("exposed-artifact")
    expect(fired(tx({ path: "/backup.sql", body: "INSERT INTO" }))).toContain("exposed-artifact")
    // a normal path → no match
    expect(fired(tx({ path: "/api/users", body: "[]" }))).not.toContain("exposed-artifact")
    // right path but NOT a 200 (e.g. 404) → no match
    expect(fired(tx({ path: "/.git/config", status: 404, body: "not found" }))).not.toContain("exposed-artifact")
  })
})
