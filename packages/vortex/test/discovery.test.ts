import { describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import type { Transaction, Extract } from "../src/index"
import { MemoryStore, SqliteStore, ingestExtract, query } from "../src/index"

function tx(id: string): Transaction {
  return { id, session: "s", source: "browser", host: "app.test", request: { method: "GET", url: "https://app.test/app.js", headers: [] }, response: { status: 200, headers: [{ name: "content-type", value: "application/javascript" }], body: "…" } }
}

const extract: Extract = {
  endpoints: ["/api/users", "/api/admin/config"],
  jsUrls: ["https://app.test/static/chunk.2.js"],
  tech: ["next", "spring"],
  secrets: [],
}

describe("Vortex is ready to receive an extractor's output (input/output + DB sink)", () => {
  test("ingestExtract writes tech onto the source transaction and endpoints/js into the inventory", () => {
    const store = new MemoryStore()
    store.add(tx("a"))
    const res = ingestExtract(store, "a", extract)
    expect(res.discovered).toBe(3) // 2 endpoints + 1 js
    expect(res.tech).toBe(2)
    expect(store.get("a")?.tech).toEqual(["next", "spring"]) // attached to the tx
    expect(store.discovered("endpoint").map((d) => d.value).sort()).toEqual(["/api/admin/config", "/api/users"])
    expect(store.discovered("js")[0].value).toBe("https://app.test/static/chunk.2.js")
    expect(store.discovered("js")[0].fromTransaction).toBe("a")
  })

  test("re-ingesting the same items is idempotent (dedup by id)", () => {
    const store = new MemoryStore()
    store.add(tx("a"))
    ingestExtract(store, "a", extract)
    const second = ingestExtract(store, "a", extract)
    expect(second.discovered).toBe(0) // nothing new
    expect(store.discovered()).toHaveLength(3)
  })

  test("attached tech is queryable via the DSL", () => {
    const store = new MemoryStore()
    store.add(tx("a"))
    ingestExtract(store, "a", extract)
    expect(query(store.all(), 'contains(tech, "spring")')).toHaveLength(1)
    expect(query(store.all(), 'contains(tech, "django")')).toHaveLength(0)
  })

  test("discovery inventory persists (SqliteStore) and is session-scoped", () => {
    const db = new Database(":memory:")
    const s1 = new SqliteStore(db, "s1")
    const s2 = new SqliteStore(db, "s2")
    s1.add({ ...tx("a"), session: "s1" })
    ingestExtract(s1, "a", extract)
    expect(s1.discovered()).toHaveLength(3)
    expect(s2.discovered()).toHaveLength(0) // other session sees nothing
    // survives a fresh store on the same db
    expect(new SqliteStore(db, "s1").discovered("endpoint")).toHaveLength(2)
  })
})
