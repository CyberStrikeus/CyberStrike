import { describe, expect, test } from "bun:test"
import type { Transaction } from "../src/index"
import { compile, query, ExprError } from "../src/expr"

// base64url encode (JWT segments)
const b64url = (o: unknown) =>
  Buffer.from(JSON.stringify(o)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
const jwtNone = `${b64url({ alg: "none", typ: "JWT" })}.${b64url({ sub: "admin" })}.`

function tx(over: Partial<Transaction> & { id: string }): Transaction {
  return { source: "browser", host: "app.test", request: { method: "GET", url: "https://app.test/x", headers: [] }, ...over } as Transaction
}

const test_ = (src: string, t: Transaction) => compile(src).test(t)

describe("DSL engine — core", () => {
  const t = tx({
    id: "a",
    request: { method: "POST", url: "https://app.test/search?q=hi", headers: [{ name: "content-type", value: "application/json" }] },
    response: { status: 500, headers: [{ name: "server", value: "nginx" }], body: "You have an error in your SQL syntax" },
  })
  test("comparison + logical + fields (HTTPQL's job, now expr syntax)", () => {
    expect(test_("resp.status == 500", t)).toBe(true)
    expect(test_("resp.status >= 500 && req.method == \"POST\"", t)).toBe(true)
    expect(test_("resp.status == 200 || req.method == \"GET\"", t)).toBe(false)
    expect(test_("!(resp.status == 200)", t)).toBe(true)
    expect(test_("req.query.q", t)).toBe(true) // truthy: present, non-empty  (was field:*)
    expect(test_("req.query.missing", t)).toBe(false)
  })
  test("string functions", () => {
    expect(test_("contains(resp.body, \"SQL syntax\")", t)).toBe(true)
    expect(test_("icontains(resp.body, \"sql SYNTAX\")", t)).toBe(true)
    expect(test_("regex(\"error .* SQL\", resp.body)", t)).toBe(true)
    expect(test_("starts_with(req.method, \"PO\")", t)).toBe(true)
  })
  test("errors: unknown function + empty + trailing", () => {
    expect(() => compile("nope(resp.body)")).toThrow(ExprError)
    expect(() => compile("")).toThrow(ExprError)
    expect(() => compile("resp.status == 500 500")).toThrow(ExprError)
  })
})

// ── The 5 scenarios HTTPQL could NOT express ────────────────────────────────
describe("DSL engine — the five expr-only scenarios", () => {
  test("1. decode-then-inspect: JWT alg:none", () => {
    const t = tx({ id: "j", request: { method: "GET", url: "https://app.test/api/me", headers: [{ name: "authorization", value: `Bearer ${jwtNone}` }] } })
    expect(test_('jwt_alg(req.header.authorization) == "none"', t)).toBe(true)
    expect(test_('contains(jwt_payload(req.header.authorization), "admin")', t)).toBe(true)
    // raw base64 regex would NOT reveal alg:none — this is the whole point
  })
  test("2. version compare: Apache 2.4.49 path traversal (CVE-2021-41773)", () => {
    const t = tx({ id: "v", response: { status: 200, headers: [{ name: "server", value: "Apache/2.4.49 (Unix)" }] } })
    expect(test_('compare_versions(resp.header.server, "< 2.4.50")', t)).toBe(true)
    expect(test_('compare_versions(resp.header.server, "< 2.4.49")', t)).toBe(false)
    expect(test_('compare_versions(resp.header.server, ">= 2.4.49")', t)).toBe(true)
  })
  test("3. field-in-field: open redirect (a field is the operand, not a literal)", () => {
    const t = tx({
      id: "o",
      request: { method: "GET", url: "https://app.test/login?next=https://evil.com/x", headers: [] },
      response: { status: 302, headers: [{ name: "location", value: "https://evil.com/x" }] },
    })
    expect(test_("starts_with(resp.header.location, req.query.next)", t)).toBe(true)
  })
  test("4. computed scalar: response length / header count", () => {
    const empty = tx({ id: "e", response: { status: 200, headers: [], body: "ok" } })
    expect(test_("resp.status == 200 && len(resp.body) < 30", empty)).toBe(true)
    const multi = tx({ id: "m", response: { status: 200, headers: [{ name: "set-cookie", value: "a=1" }, { name: "set-cookie", value: "b=2" }], body: "" } })
    expect(test_('count_header("resp", "set-cookie") > 1', multi)).toBe(true)
  })
  test("5. structural / hash: content-type lies, known-page hash", () => {
    const t = tx({ id: "s", response: { status: 200, headers: [{ name: "content-type", value: "application/json" }], body: "<html>error</html>" } })
    expect(test_('contains(resp.header.content-type, "json") && !is_json(resp.body)', t)).toBe(true)
    expect(test_(`md5(resp.body) == "${Buffer.from("").toString()}"`, t)).toBe(false) // sanity: md5 returns a hex string
    expect(compile("md5(resp.body)").eval(t)).toMatch(/^[0-9a-f]{32}$/)
  })
})

describe("DSL engine — index, arithmetic, agent-scope gate", () => {
  test("split + index (jwt segment access)", () => {
    const t = tx({ id: "i", request: { method: "GET", url: "https://app.test/x?a=1.2.3", headers: [] } })
    expect(compile('split(req.query.a, ".")[1]').eval(t)).toBe("2")
    expect(test_('split(req.query.a, ".")[2] == "3"', t)).toBe(true)
  })
  test("arithmetic", () => {
    const t = tx({ id: "n", response: { status: 200, headers: [], body: "abcd" } })
    expect(compile("len(resp.body) * 2").eval(t)).toBe(8)
  })
  test("agent scope (grep:false) rejects raw / bare-header, allows structured + functions", () => {
    expect(() => compile("raw", { grep: false })).toThrow(ExprError)
    expect(() => compile('contains(req.raw, "x")', { grep: false })).toThrow(ExprError) // even inside a function
    expect(() => compile('regex("x", req.header)', { grep: false })).toThrow(ExprError) // bare header
    const t = tx({ id: "g", response: { status: 200, headers: [], body: "hi" } })
    expect(compile("resp.status == 200", { grep: false }).test(t)).toBe(true)
    expect(compile('contains(resp.body, "hi")', { grep: false }).test(t)).toBe(true)
    // full scope still allows raw
    expect(compile('contains(raw, "hi")').test(t)).toBe(true)
  })
  test("query() filters a corpus", () => {
    const corpus = [tx({ id: "a", response: { status: 500, headers: [], body: "" } }), tx({ id: "b", response: { status: 200, headers: [], body: "" } })]
    expect(query(corpus, "resp.status >= 500").map((t) => t.id)).toEqual(["a"])
  })
})
