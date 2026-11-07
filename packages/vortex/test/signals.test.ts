import { describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import type { Transaction } from "../src/index"
import { MemoryStore, SqliteStore, scan, defaultRegistry } from "../src/index"

// A bare API response (no security headers, a server banner) → passive rules fire.
function bareApi(id: string): Transaction {
  return { id, source: "browser", host: "app.test", request: { method: "GET", url: "https://app.test/api/x", headers: [] }, response: { status: 200, headers: [{ name: "content-type", value: "application/json" }, { name: "server", value: "nginx" }], body: "{}" } }
}

describe("signal store — signals are first-class, persisted 'flags'", () => {
  test("scan() runs the rules over observed traffic and persists deduped signals", () => {
    const store = new MemoryStore()
    store.add(bareApi("a"))
    const produced = scan(store, defaultRegistry())
    expect(produced.length).toBeGreaterThan(0)
    const stored = store.signals()
    expect(stored.some((s) => s.ruleId === "missing-security-headers")).toBe(true)
    // idempotent: re-scan adds nothing new
    const before = store.signals().length
    scan(store, defaultRegistry())
    expect(store.signals().length).toBe(before)
  })

  test("signals(filter) reads flags by rule / severity / transaction", () => {
    const store = new MemoryStore()
    store.add(bareApi("a"))
    scan(store, defaultRegistry())
    expect(store.signals({ ruleId: "server-banner" }).length).toBe(1)
    expect(store.signals({ transactionId: "a" }).length).toBeGreaterThan(0)
    expect(store.signals({ severity: "info" }).some((s) => s.ruleId === "server-banner")).toBe(true)
  })

  test("SqliteStore persists signals, session-scoped, and dedups", () => {
    const db = new Database(":memory:")
    const s1 = new SqliteStore(db, "s1")
    s1.add({ ...bareApi("a"), session: "s1" })
    scan(s1, defaultRegistry())
    expect(s1.signals().length).toBeGreaterThan(0)
    expect(new SqliteStore(db, "s2").signals()).toHaveLength(0) // other session sees none
    // survives a fresh store on the same db
    const reopened = new SqliteStore(db, "s1")
    expect(reopened.signals({ ruleId: "missing-security-headers" }).length).toBe(1)
  })
})
