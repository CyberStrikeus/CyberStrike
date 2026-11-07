import { describe, expect, test } from "bun:test"
import type { Transaction } from "../src/index"
import { compileRules, loadBalancerRules } from "../src/index"

const rules = compileRules(loadBalancerRules)
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

describe("load balancer fingerprint rules", () => {
  test("Google Cloud LB via via header", () => {
    expect(fired(tx({ respHeaders: [["via", "1.1 google, 1.1 GFE"]] }))).toContain("tech-lb-google-cloud")
  })

  test("Google Cloud LB via server header", () => {
    expect(fired(tx({ respHeaders: [["server", "Google Frontend"]] }))).toContain("tech-lb-google-cloud")
  })

  test("Amazon ALB via server header", () => {
    expect(fired(tx({ respHeaders: [["server", "awselb/2.0"]] }))).toContain("tech-lb-amazon-alb")
  })

  test("Amazon ALB via AWSALB cookie", () => {
    expect(fired(tx({ respHeaders: [["set-cookie", "AWSALB=abc123; Path=/"]] }))).toContain("tech-lb-amazon-alb")
  })

  test("Azure Front Door via x-azure-ref header", () => {
    expect(fired(tx({ respHeaders: [["x-azure-ref", "0abc123"]] }))).toContain("tech-lb-azure-front-door")
  })

  test("Amazon ELB via server header", () => {
    expect(fired(tx({ respHeaders: [["server", "awselb/1.0"]] }))).toContain("tech-lb-amazon-elb")
  })

  test("Amazon ELB via AWSELB cookie", () => {
    expect(fired(tx({ respHeaders: [["set-cookie", "AWSELB=abc123; Path=/"]] }))).toContain("tech-lb-amazon-elb")
  })

  test("Application Request Routing via ARRAffinity cookie", () => {
    expect(fired(tx({ respHeaders: [["set-cookie", "ARRAffinity=abc123; Path=/"]] }))).toContain("tech-lb-arr")
  })

  test("Application Request Routing via x-powered-by-arr header", () => {
    expect(fired(tx({ respHeaders: [["x-powered-by-arr", "2.5"]] }))).toContain("tech-lb-arr")
  })

  // --- Structural ---
  test("a plain page triggers no load balancer rules", () => {
    expect(fired(tx({ body: "<html><body>Hello</body></html>" }))).toHaveLength(0)
  })

  test("all rule IDs start with tech-lb-", () => {
    for (const r of loadBalancerRules) expect(r.id).toMatch(/^tech-lb-/)
  })

  test("all rules have load-balancer tag", () => {
    for (const r of loadBalancerRules) expect(r.tags).toContain("load-balancer")
  })

  test("rule count is 5", () => {
    expect(loadBalancerRules.length).toBe(5)
  })
})
