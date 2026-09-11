import { describe, expect, test } from "bun:test"
import type { Transaction } from "../src/index"
import { compileRule, compileRules, parseRules, signatureRules, defaultRegistry, ExprError } from "../src/index"

function tx(id: string, status: number, body: string, path = "/api/x"): Transaction {
  return {
    id,
    source: "browser",
    host: "app.test",
    request: { method: "POST", url: `https://app.test${path}`, headers: [] },
    response: { status, headers: [{ name: "content-type", value: "text/html" }], body },
  }
}

describe("declarative rule DSL", () => {
  test("a {when: DSL expr} rule compiles to a Rule that fires on a match", () => {
    const rule = compileRule({ id: "err5xx", category: "misconfiguration", severity: "medium", when: "resp.status >= 500" })
    expect(rule.evaluate(tx("a", 500, ""))).toHaveLength(1)
    expect(rule.evaluate(tx("b", 200, ""))).toHaveLength(0)
  })

  test("message/evidence interpolate {field} with the same vocabulary as the DSL", () => {
    const rule = compileRule({
      id: "r",
      category: "x",
      severity: "low",
      when: "resp.status == 500",
      message: "fail on {req.method} {req.path}",
      evidence: "status={resp.status}",
    })
    const s = rule.evaluate(tx("a", 500, "", "/api/run/5"))
    expect(s[0].title).toBe("fail on POST /api/run/{id}")
    expect(s[0].evidence).toBe("status=500")
  })

  test("dedupBy collapses per field via the registry", () => {
    const reg = defaultRegistry()
    reg.register(compileRule({ id: "d", category: "x", severity: "low", when: "resp.status == 500", dedupBy: "endpoint" }))
    const sigs = reg.analyze([tx("a", 500, ""), tx("b", 500, "")]).filter((s) => s.ruleId === "d")
    expect(sigs).toHaveLength(1) // same endpoint → one signal
  })

  test("parseRules validates untrusted JSON (an agent's output) and rejects bad rules", () => {
    const ok = parseRules([{ id: "x", category: "c", severity: "high", when: "resp.status == 200" }])
    expect(ok).toHaveLength(1)
    expect(() => parseRules([{ id: "x", category: "c", severity: "nope", when: "resp.status == 200" }])).toThrow()
    expect(() => parseRules([{ id: "x", category: "c", severity: "high" }])).toThrow() // missing when
  })

  test("a bad DSL 'when' fails at compile, not silently", () => {
    expect(() => compileRule({ id: "x", category: "c", severity: "low", when: "resp.status == " })).toThrow(ExprError)
    expect(() => compileRule({ id: "y", category: "c", severity: "low", when: "nope(resp.body)" })).toThrow(ExprError)
  })
})

describe("built-in signature rules (declarative, dogfooded)", () => {
  const rules = compileRules(signatureRules)
  const run = (t: Transaction) => rules.flatMap((r) => r.evaluate(t))

  test("sql-error fires on a SQL error body", () => {
    const s = run(tx("a", 500, "Error: You have an error in your SQL syntax near '1'"))
    expect(s.some((x) => x.ruleId === "sql-error-signature")).toBe(true)
  })
  test("stack-trace fires on a python traceback", () => {
    const s = run(tx("a", 500, "Traceback (most recent call last):\n  File ..."))
    expect(s.some((x) => x.ruleId === "stack-trace-signature")).toBe(true)
  })
  test("secret-in-response fires on a leaked private key / AWS key", () => {
    expect(run(tx("a", 200, "-----BEGIN RSA PRIVATE KEY-----\nMII...")).some((x) => x.ruleId === "secret-in-response")).toBe(true)
    expect(run(tx("b", 200, "key=AKIAIOSFODNN7EXAMPLE")).some((x) => x.ruleId === "secret-in-response")).toBe(true)
  })
  test("full-path-disclosure fires on a leaked filesystem path (unix + windows), not an ordinary URL", () => {
    expect(run(tx("a", 500, "Warning: include(/var/www/html/app/config.php): failed")).some((x) => x.ruleId === "full-path-disclosure")).toBe(true)
    expect(run(tx("b", 500, "Could not open C:\\inetpub\\wwwroot\\app\\web.config")).some((x) => x.ruleId === "full-path-disclosure")).toBe(true)
    expect(run(tx("c", 200, "see https://app.test/var/report for details")).some((x) => x.ruleId === "full-path-disclosure")).toBe(false)
  })
  test("clean response yields nothing", () => {
    expect(run(tx("a", 200, "{\"ok\":true}"))).toHaveLength(0)
  })
})
