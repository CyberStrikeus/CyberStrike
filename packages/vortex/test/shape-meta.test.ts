import { describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import type { Transaction } from "../src/index"
import { requestShape, groupByShape, SqliteStore, query } from "../src/index"

function tx(id: string, url: string, over: Partial<Transaction> = {}): Transaction {
  return { id, source: "browser", host: "app.test", request: { method: "GET", url: `https://app.test${url}`, headers: [] }, ...over }
}

describe("requestShape (A.4 — template/dup)", () => {
  test("same endpoint + same param NAMES ⇒ same shape (values differ)", () => {
    expect(requestShape(tx("a", "/api/users/1?sort=asc"))).toBe(requestShape(tx("b", "/api/users/2?sort=desc")))
  })
  test("different param names ⇒ different shape", () => {
    expect(requestShape(tx("a", "/api/users/1?sort=asc"))).not.toBe(requestShape(tx("b", "/api/users/1?filter=x")))
  })
  test("groupByShape collapses value-only variants", () => {
    const groups = groupByShape([tx("a", "/s?q=1"), tx("b", "/s?q=2"), tx("c", "/s?q=3&extra=1")])
    expect(groups.size).toBe(2) // {q} and {q,extra}
  })
})

describe("A.3 — transport metadata persists and is queryable", () => {
  test("httpVersion / tls / timing round-trip through the SqliteStore", () => {
    const s = new SqliteStore(new Database(":memory:"), "sess")
    s.add(tx("a", "/x", { httpVersion: "2", tls: { version: "TLS1.3", cipher: "AES256" }, timing: { startedAt: 1, ms: 42 }, redirectChain: ["https://app.test/old"] }))
    const got = s.get("a")
    expect(got?.httpVersion).toBe("2")
    expect(got?.tls?.version).toBe("TLS1.3")
    expect(got?.timing?.ms).toBe(42)
    expect(got?.redirectChain).toEqual(["https://app.test/old"])
  })
  test("HTTPQL exposes httpVersion, timeMs, tls.version", () => {
    const corpus = [
      tx("h2", "/a", { httpVersion: "2", timing: { ms: 10 }, tls: { version: "TLS1.3" } }),
      tx("h1", "/b", { httpVersion: "1.1", timing: { ms: 900 }, tls: { version: "TLS1.2" } }),
    ]
    expect(query(corpus, 'httpVersion == "2"').map((t) => t.id)).toEqual(["h2"])
    expect(query(corpus, "timeMs >= 500").map((t) => t.id)).toEqual(["h1"])
    expect(query(corpus, 'contains(tls.version, "1.3")').map((t) => t.id)).toEqual(["h2"])
  })
})
