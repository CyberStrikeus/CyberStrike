import { describe, expect, test } from "bun:test"
import type { Transaction } from "../src/index"
import { query, compile, QueryError } from "../src/index"

function tx(over: Partial<Transaction> & { id: string }): Transaction {
  return {
    source: "browser",
    host: "app.test",
    request: { method: "GET", url: "https://app.test/x", headers: [] },
    ...over,
  } as Transaction
}

const corpus: Transaction[] = [
  tx({
    id: "a",
    identity: "org1",
    request: { method: "POST", url: "https://app.test/analytics/api/run-query?debug=1", headers: [{ name: "content-type", value: "application/json" }], body: JSON.stringify({ params: { staff_name: "o'brien" } }) },
    response: { status: 200, headers: [{ name: "server", value: "uvicorn" }] },
  }),
  tx({ id: "b", request: { method: "GET", url: "https://app.test/review/dashboard", headers: [] }, response: { status: 500, headers: [{ name: "server", value: "nginx" }], body: "SQL syntax error near" } }),
  tx({ id: "c", identity: "org2", request: { method: "GET", url: "https://app.test/api/users/2", headers: [] }, response: { status: 403, headers: [] } }),
]

describe("HTTPQL-lite", () => {
  test("numeric comparison on status", () => {
    expect(query(corpus, "resp.status>=500").map((t) => t.id)).toEqual(["b"])
    expect(query(corpus, "resp.status:200").map((t) => t.id)).toEqual(["a"])
  })
  test("regex on a header and on a body", () => {
    expect(query(corpus, "resp.header.server:~uvicorn").map((t) => t.id)).toEqual(["a"])
    expect(query(corpus, 'resp.body:~"SQL syntax"').map((t) => t.id)).toEqual(["b"])
  })
  test("AND combines constraints", () => {
    expect(query(corpus, "req.method:POST AND resp.status:200").map((t) => t.id)).toEqual(["a"])
  })
  test("OR unions, parens group", () => {
    expect(query(corpus, "resp.status:403 OR resp.status>=500").map((t) => t.id).sort()).toEqual(["b", "c"])
    expect(query(corpus, "(resp.status:403 OR resp.status:200) AND identity:org1").map((t) => t.id)).toEqual(["a"])
  })
  test("query params and flattened body params are addressable", () => {
    expect(query(corpus, "req.query.debug:1").map((t) => t.id)).toEqual(["a"])
    // the injection target — a quote inside params.staff_name
    expect(query(corpus, "req.body.params.staff_name:~\"'\"").map((t) => t.id)).toEqual(["a"])
  })
  test("endpoint + identity fields", () => {
    expect(query(corpus, "identity:org2").map((t) => t.id)).toEqual(["c"])
    expect(query(corpus, "endpoint:~users").map((t) => t.id)).toEqual(["c"])
  })
  test("!= negation, and absent field is falsy", () => {
    expect(query(corpus, "req.method!=GET").map((t) => t.id)).toEqual(["a"])
    expect(query(corpus, "resp.header.x-frame-options:DENY")).toHaveLength(0) // none have it
  })
  test("compile once, reuse", () => {
    const q = compile("resp.status>=400")
    expect(q.filter(corpus).map((t) => t.id).sort()).toEqual(["b", "c"])
  })
  test("syntax errors throw QueryError", () => {
    expect(() => query(corpus, "resp.status")).toThrow(QueryError)
    expect(() => query(corpus, "(resp.status:200")).toThrow(QueryError)
    expect(() => query(corpus, "")).toThrow(QueryError)
  })
})
