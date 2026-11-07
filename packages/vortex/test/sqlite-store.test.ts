import { describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { rmSync } from "node:fs"
import type { Transaction } from "../src/index"
import { SqliteStore } from "../src/index"

function tx(id: string, status: number, identity?: string): Transaction {
  return { id, source: "browser", host: "app.test", identity, request: { method: "GET", url: `https://app.test/${id}`, headers: [] }, response: { status, headers: [{ name: "server", value: "nginx" }] } }
}

describe("SqliteStore", () => {
  test("add / get / all / size round-trips through SQL (not a JS map)", () => {
    const db = new Database(":memory:")
    const s = new SqliteStore(db, "sess-1")
    s.add(tx("a", 200, "org1"))
    s.add(tx("b", 500))
    expect(s.size()).toBe(2)
    const got = s.get("a")
    expect(got?.identity).toBe("org1")
    expect(got?.response?.headers[0]).toEqual({ name: "server", value: "nginx" }) // nested data survived JSON round-trip
    expect(s.all().map((t) => t.id).sort()).toEqual(["a", "b"])
  })

  test("instances are session-scoped: one session cannot see another's rows on the same db", () => {
    const db = new Database(":memory:")
    const one = new SqliteStore(db, "sess-1")
    const two = new SqliteStore(db, "sess-2")
    one.add(tx("x", 200))
    two.add(tx("y", 200))
    expect(one.all().map((t) => t.id)).toEqual(["x"])
    expect(two.all().map((t) => t.id)).toEqual(["y"])
    expect(one.get("y")).toBeUndefined()
  })

  test("add stamps the store's session onto the transaction", () => {
    const s = new SqliteStore(new Database(":memory:"), "sess-1")
    const stored = s.add(tx("a", 200))
    expect(stored.session).toBe("sess-1")
  })

  test("durable across a fresh DB open (survives 'restart')", () => {
    const path = join(tmpdir(), `vortex-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`)
    try {
      new SqliteStore(path, "sess-1").add(tx("keep", 200, "org1"))
      // A brand-new store on the same file (simulating a restart) still sees it.
      const reopened = new SqliteStore(path, "sess-1")
      expect(reopened.size()).toBe(1)
      expect(reopened.get("keep")?.identity).toBe("org1")
    } finally {
      rmSync(path, { force: true })
    }
  })
})