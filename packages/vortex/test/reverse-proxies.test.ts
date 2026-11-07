import { describe, expect, test } from "bun:test"
import type { Transaction } from "../src/index"
import { compileRules, reverseProxyRules } from "../src/index"

const rules = compileRules(reverseProxyRules)
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

describe("reverse proxy fingerprint rules", () => {
  test("Envoy via server header", () => {
    expect(fired(tx({ respHeaders: [["server", "envoy"]] }))).toContain("tech-rp-envoy")
  })
  test("Envoy via x-envoy header", () => {
    expect(fired(tx({ respHeaders: [["x-envoy-upstream-service-time", "12"]] }))).toContain("tech-rp-envoy")
  })
  test("F5 BigIP via cookie", () => {
    expect(fired(tx({ respHeaders: [["set-cookie", "BIGipServerpool_web=123.45.67.89.20480; path=/"]] }))).toContain("tech-rp-f5-bigip")
  })
  test("F5 BigIP via server header", () => {
    expect(fired(tx({ respHeaders: [["server", "BigIP"]] }))).toContain("tech-rp-f5-bigip")
  })
  test("IBM DataPower via header", () => {
    expect(fired(tx({ respHeaders: [["x-backside-transport", "OK OK"]] }))).toContain("tech-rp-ibm-datapower")
  })
  test("V2Board via body", () => {
    expect(fired(tx({ body: '<title>V2Board</title>' }))).toContain("tech-rp-v2board")
  })
  test("Hydra-Shield via server header", () => {
    expect(fired(tx({ respHeaders: [["server", "Hydra-Shield"]] }))).toContain("tech-rp-hydra-shield")
  })
  test("Urllo via server header", () => {
    expect(fired(tx({ respHeaders: [["server", "urllo"]] }))).toContain("tech-rp-urllo")
  })

  // --- Structural ---
  test("a plain page triggers no reverse proxy rules", () => {
    expect(fired(tx({ body: "<html><body>Hello</body></html>" }))).toHaveLength(0)
  })
  test("all rule IDs start with tech-rp-", () => {
    for (const r of reverseProxyRules) expect(r.id).toMatch(/^tech-rp-/)
  })
  test("all rules have reverse-proxy tag", () => {
    for (const r of reverseProxyRules) expect(r.tags).toContain("reverse-proxy")
  })
  test("rule count is 6", () => {
    expect(reverseProxyRules.length).toBe(6)
  })
})
