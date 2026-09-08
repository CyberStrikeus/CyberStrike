import { describe, expect, test } from "bun:test"
import type { Transaction } from "../src/index"
import { MemoryStore } from "../src/index"

function tx(id: string, source: Transaction["source"], status: number): Transaction {
  return { id, source, host: "app.test", request: { method: "GET", url: `https://app.test/${id}`, headers: [] }, response: { status, headers: [] } }
}

describe("MemoryStore", () => {
  test("add / get / all / size", () => {
    const s = new MemoryStore()
    s.add(tx("a", "browser", 200))
    s.add(tx("b", "replay", 500))
    expect(s.size()).toBe(2)
    expect(s.get("a")?.source).toBe("browser")
    expect(s.all().map((t) => t.id).sort()).toEqual(["a", "b"])
  })
  test("add replaces by id (idempotent upsert)", () => {
    const s = new MemoryStore()
    s.add(tx("a", "browser", 200))
    s.add(tx("a", "cloud", 404))
    expect(s.size()).toBe(1)
    expect(s.get("a")?.source).toBe("cloud")
  })
  test("where filters the corpus", () => {
    const s = new MemoryStore()
    s.add(tx("a", "browser", 200))
    s.add(tx("b", "browser", 500))
    s.add(tx("c", "cloud", 500))
    const errors = s.where((t) => (t.response?.status ?? 0) >= 500)
    expect(errors.map((t) => t.id).sort()).toEqual(["b", "c"])
  })
  test("clear empties it", () => {
    const s = new MemoryStore()
    s.add(tx("a", "browser", 200))
    s.clear()
    expect(s.size()).toBe(0)
  })
})
