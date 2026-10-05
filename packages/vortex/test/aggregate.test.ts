import { describe, expect, test } from "bun:test"
import type { Transaction } from "../src/index"
import { compileAggregate, compileAggregates, parseAggregates, aggregateRules } from "../src/index"

// Build a transaction on a given path with CORS reflection+credentials (the true-positive shape).
function reflectTx(id: string, path: string, host = "app.test"): Transaction {
  return {
    id,
    source: "browser",
    host,
    request: { method: "GET", url: `https://${host}${path}`, headers: [{ name: "origin", value: "https://evil.com" }] },
    response: {
      status: 200,
      headers: [
        { name: "access-control-allow-origin", value: "https://evil.com" },
        { name: "access-control-allow-credentials", value: "true" },
      ],
      body: "",
    },
  }
}

// A clean transaction (no CORS reflection).
function cleanTx(id: string, path: string): Transaction {
  return {
    id,
    source: "browser",
    host: "app.test",
    request: { method: "GET", url: `https://app.test${path}`, headers: [] },
    response: { status: 200, headers: [], body: "" },
  }
}

const corsRule = compileAggregate(aggregateRules.find((r) => r.id === "cors-origin-reflection-with-credentials")!)

describe("compileAggregate — one finding, many URLs", () => {
  test("collapses N matching endpoints into ONE signal", () => {
    const txs = [reflectTx("1", "/api/a"), reflectTx("2", "/api/b"), reflectTx("3", "/api/c"), cleanTx("4", "/home")]
    const signals = corsRule.evaluate(txs)
    expect(signals.length).toBe(1)
    const sig = signals[0]!
    expect(sig.ruleId).toBe("cors-origin-reflection-with-credentials")
    expect(sig.severity).toBe("high")
    // {count} = 3 distinct endpoints, {endpoints} lists all three
    expect(sig.title).toContain("3 endpoint")
    expect(sig.evidence).toContain("/api/a")
    expect(sig.evidence).toContain("/api/b")
    expect(sig.evidence).toContain("/api/c")
    expect(sig.evidence).not.toContain("/home")
    // one finding per host (#87: config-class rules group by host) — these endpoints share app.test
    expect(sig.dedupKey).toBe("cors-origin-reflection-with-credentials:app.test")
  })

  test("no matching transactions ⇒ no signal", () => {
    expect(corsRule.evaluate([cleanTx("1", "/a"), cleanTx("2", "/b")]).length).toBe(0)
  })

  test("distinct endpoints are de-duplicated (same endpoint hit twice = one listed URL)", () => {
    const txs = [reflectTx("1", "/api/a"), reflectTx("2", "/api/a"), reflectTx("3", "/api/b")]
    const sig = corsRule.evaluate(txs)[0]!
    expect(sig.title).toContain("2 endpoint")
  })

  test("groupBy a field path ⇒ one finding per distinct value", () => {
    const rule = compileAggregate({
      id: "per-host-cors",
      category: "misconfiguration",
      severity: "low",
      when: 'resp.header.access-control-allow-origin == "*"',
      aggregate: { groupBy: "host", list: "endpoint" },
      message: "wildcard CORS on {count} endpoint(s)",
    })
    const wild = (id: string, host: string, path: string): Transaction => ({
      id,
      source: "browser",
      host,
      request: { method: "GET", url: `https://${host}${path}`, headers: [] },
      response: { status: 200, headers: [{ name: "access-control-allow-origin", value: "*" }], body: "" },
    })
    const signals = rule.evaluate([wild("1", "a.test", "/x"), wild("2", "a.test", "/y"), wild("3", "b.test", "/z")])
    expect(signals.length).toBe(2) // one per host
    expect(new Set(signals.map((s) => s.dedupKey))).toEqual(new Set(["per-host-cors:a.test", "per-host-cors:b.test"]))
  })

  test("the enumerated list is capped, overflow shown as +N more", () => {
    const rule = compileAggregate({
      id: "capped",
      category: "misconfiguration",
      severity: "low",
      when: 'resp.header.access-control-allow-origin == req.header.origin',
      aggregate: { groupBy: "ruleId", list: "endpoint", max: 2 },
      evidence: "{endpoints}",
    })
    const txs = [reflectTx("1", "/a"), reflectTx("2", "/b"), reflectTx("3", "/c"), reflectTx("4", "/d")]
    const sig = rule.evaluate(txs)[0]!
    expect(sig.evidence).toContain("+2 more")
  })

  test("parseAggregates validates + round-trips the baseline rules", () => {
    const parsed = parseAggregates(aggregateRules)
    expect(parsed.length).toBe(aggregateRules.length)
    expect(compileAggregates(parsed).length).toBe(aggregateRules.length)
  })
})
