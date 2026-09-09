import { describe, expect, test } from "bun:test"
import type { Transaction } from "../src/index"
import { Httpql } from "../src/index"

// HTTPQL is the AGENT query interface (pure SELECT, no function library). These are the advanced
// relational queries an agent runs to dig around the corpus — including the regex searches that the
// DSL engine, made agent-safe, has to block.
function tx(id: string, method: string, url: string, identity?: string, resp?: Transaction["response"]): Transaction {
  return { id, source: "browser", host: "app.test", identity, request: { method, url: `https://app.test${url}`, headers: [] }, response: resp }
}
const corpus: Transaction[] = [
  tx("t1", "GET", "/api/orders/42", "org1"),
  tx("t2", "GET", "/api/orders/42", "org2"),
  tx("t3", "GET", "/api/admin/users", "org1"),
  tx("t5", "GET", "/api/reports/export?file=q.csv", "org2", { status: 200, headers: [], body: "ok" }),
  tx("t6", "GET", "/api/me", "org1", { status: 200, headers: [], body: "token=eyJhbGciOi.eyJzdWIiOiJhZG1pbiJ9.sig" }),
  tx("t7", "GET", "/api/orders/99", "org2", { status: 500, headers: [], body: "You have an error in your SQL syntax" }),
]
const q = (s: string, opts?: { grep?: boolean }) => Httpql.query(corpus, s, opts).map((t) => t.id)

describe("HTTPQL — the agent query interface (SELECT over the traffic DB)", () => {
  test("endpoint / identity / path filters (relational digging)", () => {
    expect(q('endpoint:~"orders/{id}"')).toEqual(["t1", "t2", "t7"])
    expect(q("endpoint:~orders AND identity!=org1")).toEqual(["t2", "t7"]) // IDOR hunt: orders under a role != org1
    expect(q("req.path:~admin")).toEqual(["t3"])
  })
  test("exists (:*) surfaces a param-bearing request", () => {
    expect(q("req.query.file:*")).toEqual(["t5"]) // LFI/export surface
  })
  test("the regex searches the DSL agent-scope BLOCKS — HTTPQL does them via :~", () => {
    expect(q('resp.body:~"eyJ[A-Za-z0-9_-]{6,}[.]eyJ"')).toEqual(["t6"]) // leaked JWT
    expect(q('resp.status:500 AND resp.body:~"SQL syntax"')).toEqual(["t7"]) // SQL error
  })
  test("agent scope still gates the grep-everywhere fields", () => {
    expect(() => q('raw:~"x"', { grep: false })).toThrow(Httpql.QueryError)
    expect(q("resp.status:500", { grep: false })).toEqual(["t7"]) // structured fields fine in agent scope
  })
})
