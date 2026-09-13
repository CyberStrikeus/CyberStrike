import { describe, expect, test } from "bun:test"
import type { Transaction } from "../src/index"
import { compileRules, dbManagerRules } from "../src/index"

const rules = compileRules(dbManagerRules)
function tx(over: { body?: string; respHeaders?: [string, string][] }): Transaction {
  return {
    id: "t",
    source: "browser",
    host: "app.test",
    request: { method: "GET", url: "https://app.test/", headers: [] },
    response: { status: 200, headers: (over.respHeaders ?? []).map(([n, v]) => ({ name: n, value: v })), body: over.body ?? "" },
  }
}
const fired = (t: Transaction) => rules.flatMap((r) => r.evaluate(t)).map((s) => s.ruleId)

describe("database manager fingerprint rules", () => {
  test("phpMyAdmin via body", () => {
    expect(fired(tx({ body: '<title>phpMyAdmin</title><input name="pma_token">' }))).toContain("tech-dbm-phpmyadmin")
  })

  test("phpMyAdmin via cookie", () => {
    expect(fired(tx({ respHeaders: [["set-cookie", "phpMyAdmin=abc123; Path=/"]] }))).toContain("tech-dbm-phpmyadmin")
  })

  test("Adminer via body", () => {
    expect(fired(tx({ body: '<div id="adminer"><a href="https://www.adminer.org/">Adminer Editor</a></div>' }))).toContain("tech-dbm-adminer")
  })

  test("Knack via body", () => {
    expect(fired(tx({ body: '<script src="https://cdn.knack.com/loader/knack-dist.js"></script>' }))).toContain("tech-dbm-knack")
  })

  test("Xano via body", () => {
    expect(fired(tx({ body: '<script>const api = "https://x8ki-letl-twmt.n7.xano.io/api:abc";</script>' }))).toContain("tech-dbm-xano")
  })

  // --- Structural ---
  test("a plain page triggers no db manager rules", () => {
    expect(fired(tx({ body: "<html><body>Hello</body></html>" }))).toHaveLength(0)
  })

  test("all rule IDs start with tech-dbm-", () => {
    for (const r of dbManagerRules) expect(r.id).toMatch(/^tech-dbm-/)
  })

  test("all rules have db-manager tag", () => {
    for (const r of dbManagerRules) expect(r.tags).toContain("db-manager")
  })

  test("rule count is 4", () => {
    expect(dbManagerRules.length).toBe(4)
  })
})
