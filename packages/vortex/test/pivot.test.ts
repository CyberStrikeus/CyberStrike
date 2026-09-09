import { describe, expect, test } from "bun:test"
import type { Transaction, Extract } from "../src/index"
import { MemoryStore, valueOccurrences, untestedEndpoints, ingestExtract } from "../src/index"

function tx(id: string, url: string, headers: [string, string][] = [], resp?: Transaction["response"], body?: string): Transaction {
  return { id, source: "browser", host: "app.test", request: { method: "GET", url: `https://app.test${url}`, headers: headers.map(([n, v]) => ({ name: n, value: v })), body }, response: resp }
}

describe("valueOccurrences — where else a value (spotted in a rawView) flows", () => {
  const store = new MemoryStore()
  const token = "eyJhbGci.eyJzdWIiOiJhZG1pbiJ9.sig"
  store.add(tx("t1", "/api/me", [["authorization", `Bearer ${token}`]])) // token in a request header
  store.add(tx("t2", "/api/login", [], { status: 200, headers: [], body: `{"jwt":"${token}"}` })) // same token leaked in a response body
  store.add(tx("t3", "/api/orders/42")) // unrelated
  store.add(tx("t4", "/api/audit?actor=42")) // "42" in a query param

  test("finds the token in a request header AND a response body, naming the sites", () => {
    const occ = valueOccurrences(store, token)
    expect(occ.map((o) => o.transactionId).sort()).toEqual(["t1", "t2"])
    expect(occ.find((o) => o.transactionId === "t1")!.sites).toContain("req.header.authorization")
    expect(occ.find((o) => o.transactionId === "t2")!.sites.some((s) => s.startsWith("resp.body"))).toBe(true)
  })
  test("path-embedded value is reported as req.url; query value as the named param", () => {
    expect(valueOccurrences(store, "orders/42").find((o) => o.transactionId === "t3")!.sites).toEqual(["req.url"])
    expect(valueOccurrences(store, "42").find((o) => o.transactionId === "t4")!.sites).toContain("req.query.actor")
  })
  test("empty value returns nothing", () => {
    expect(valueOccurrences(store, "")).toHaveLength(0)
  })
})

describe("untestedEndpoints — discovered but never requested (untested attack surface)", () => {
  test("returns discovered endpoints no transaction hit (by normalized path)", () => {
    const store = new MemoryStore()
    store.add(tx("t1", "/api/orders/42")) // hits orders/{id}
    const extract: Extract = { endpoints: ["/api/orders/99", "/api/admin/export", "/api/users/7"], jsUrls: [], tech: [], secrets: [] }
    ingestExtract(store, "t1", extract)
    const untested = untestedEndpoints(store).map((d) => d.value).sort()
    // /api/orders/99 folds to orders/{id} → COVERED by t1; the other two were never requested
    expect(untested).toEqual(["/api/admin/export", "/api/users/7"])
  })
})
