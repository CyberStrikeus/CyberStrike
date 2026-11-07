import { describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import type { Transaction, SignalTriage } from "../src/index"
import { MemoryStore, SqliteStore, scan, defaultRegistry, signalKey } from "../src/index"

function bareApi(id: string): Transaction {
  return { id, source: "browser", host: "app.test", request: { method: "GET", url: "https://app.test/api/x", headers: [] }, response: { status: 200, headers: [{ name: "content-type", value: "application/json" }, { name: "server", value: "nginx" }], body: "{}" } }
}

describe("signal triage — MemoryStore", () => {
  test("new signals default to 'new' triage", () => {
    const store = new MemoryStore()
    store.add(bareApi("a"))
    scan(store, defaultRegistry())
    const sigs = store.signals()
    expect(sigs.length).toBeGreaterThan(0)
    for (const s of sigs) expect(s.triage ?? "new").toBe("new")
  })

  test("updateSignalTriage changes status and is queryable", () => {
    const store = new MemoryStore()
    store.add(bareApi("a"))
    scan(store, defaultRegistry())
    const sigs = store.signals()
    const key = signalKey(sigs[0]!)
    expect(store.updateSignalTriage([key], "reviewed")).toBe(1)
    expect(store.signals({ triage: "reviewed" })).toHaveLength(1)
    expect(store.signals({ triage: "new" }).length).toBe(sigs.length - 1)
  })

  test("updateSignalTriage returns 0 for unknown keys", () => {
    const store = new MemoryStore()
    expect(store.updateSignalTriage(["nonexistent"], "confirmed")).toBe(0)
  })

  test("signalSummary counts all triage states", () => {
    const store = new MemoryStore()
    store.add(bareApi("a"))
    scan(store, defaultRegistry())
    const sigs = store.signals()
    const total = sigs.length
    const key0 = signalKey(sigs[0]!)
    const key1 = signalKey(sigs[1]!)
    store.updateSignalTriage([key0], "confirmed")
    store.updateSignalTriage([key1], "dismissed")
    const summary = store.signalSummary()
    expect(summary.confirmed).toBe(1)
    expect(summary.dismissed).toBe(1)
    expect(summary.new).toBe(total - 2)
    expect(summary.reviewed).toBe(0)
    expect(summary.escalated).toBe(0)
    expect(Object.values(summary).reduce((a, b) => a + b, 0)).toBe(total)
  })
})

describe("signal triage — SqliteStore", () => {
  test("triage persists across store reopens", () => {
    const db = new Database(":memory:")
    const s1 = new SqliteStore(db, "sess1")
    s1.add(bareApi("a"))
    scan(s1, defaultRegistry())
    const sigs = s1.signals()
    const key = signalKey(sigs[0]!)
    s1.updateSignalTriage([key], "escalated")
    const reopened = new SqliteStore(db, "sess1")
    expect(reopened.signals({ triage: "escalated" })).toHaveLength(1)
    expect(reopened.signalSummary().escalated).toBe(1)
  })

  test("addSignals preserves existing triage on re-add", () => {
    const db = new Database(":memory:")
    const store = new SqliteStore(db, "sess2")
    store.add(bareApi("a"))
    scan(store, defaultRegistry())
    const sigs = store.signals()
    const key = signalKey(sigs[0]!)
    store.updateSignalTriage([key], "confirmed")
    scan(store, defaultRegistry())
    const after = store.signals({ triage: "confirmed" })
    expect(after).toHaveLength(1)
    expect(signalKey(after[0]!)).toBe(key)
  })

  test("triage is session-scoped", () => {
    const db = new Database(":memory:")
    const s1 = new SqliteStore(db, "sess-a")
    const s2 = new SqliteStore(db, "sess-b")
    s1.add(bareApi("a1"))
    s2.add(bareApi("a2"))
    scan(s1, defaultRegistry())
    scan(s2, defaultRegistry())
    const sigs1 = s1.signals()
    expect(sigs1.length).toBeGreaterThan(0)
    const key = signalKey(sigs1[0]!)
    s1.updateSignalTriage([key], "dismissed")
    expect(s1.signalSummary().dismissed).toBe(1)
    expect(s2.signalSummary().dismissed).toBe(0)
  })
})
