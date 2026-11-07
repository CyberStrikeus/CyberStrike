import { describe, expect, test } from "bun:test"
import type { Transaction } from "../src/index"
import { compile, compileGroup, compileCorpusRule } from "../src/index"

let n = 0
function tx(path: string, status: number, identity?: string): Transaction {
  return {
    id: `t${n++}`,
    source: "browser",
    host: "app.test",
    identity,
    request: { method: "GET", url: `https://app.test${path}`, headers: [] },
    response: { status, headers: [] },
  }
}

describe("group quantifiers (compileGroup)", () => {
  const group = [tx("/a", 200, "org1"), tx("/a", 200, "org2"), tx("/a", 403, undefined)]
  test("any — ∃ a transaction matching the predicate", () => {
    expect(compileGroup('any(resp.status == 403)').test(group)).toBe(true)
    expect(compileGroup('any(resp.status == 500)').test(group)).toBe(false)
  })
  test("all — every transaction matches", () => {
    expect(compileGroup('all(resp.status >= 200)').test(group)).toBe(true)
    expect(compileGroup('all(resp.status < 400)').test(group)).toBe(false)
  })
  test("count — how many match", () => {
    expect(compileGroup('count(resp.status == 200) >= 2').test(group)).toBe(true)
    expect(compileGroup('count(resp.status == 403) == 1').test(group)).toBe(true)
  })
  test("countDistinct — distinct values of a sub-expression", () => {
    expect(compileGroup('countDistinct(identity) >= 2').test(group)).toBe(true)
    // only one DISTINCT identity among 2xx
    expect(compileGroup('countDistinct(identity) >= 2').test([tx("/b", 200, "org1"), tx("/b", 200, "org1")])).toBe(false)
  })
  test("quantifiers compose with && / ||", () => {
    expect(compileGroup('any(identity == "org1") && any(identity == "org2")').test(group)).toBe(true)
  })
  test("a quantifier in a per-transaction expression is rejected", () => {
    expect(() => compile("any(resp.status == 200)")).toThrow()
  })
  test("a bare field at group scope is rejected", () => {
    expect(() => compileGroup("resp.status == 200").test(group)).toThrow()
  })
})

describe("compileCorpusRule", () => {
  const rule = compileCorpusRule({
    id: "two-ids",
    category: "access-control",
    severity: "low",
    corpus: { groupBy: "endpoint", where: "resp.status >= 200 && resp.status < 300", having: "countDistinct(identity) >= 2", list: "identity" },
    message: "reached under multiple identities",
    evidence: "{group} by {list} ({count} hits)",
  })

  test("fires once per qualifying group, anchored to the first filtered tx", () => {
    const s = rule.evaluate([tx("/u/1", 200, "org1"), tx("/u/2", 200, "org2"), tx("/u/3", 403, "org3")])
    expect(s).toHaveLength(1)
    expect(s[0].evidence).toContain("org1")
    expect(s[0].evidence).toContain("org2")
    expect(s[0].evidence).not.toContain("org3") // 403 filtered out by `where`
    expect(s[0].dedupKey).toContain("two-ids")
  })
  test("does not fire when the having predicate is false", () => {
    expect(rule.evaluate([tx("/x", 200, "org1"), tx("/x", 200, "org1")])).toHaveLength(0)
  })
  test("{count} is the filtered group size", () => {
    const s = rule.evaluate([tx("/y/1", 200, "org1"), tx("/y/2", 200, "org2")])
    expect(s[0].evidence).toContain("(2 hits)")
  })
})
