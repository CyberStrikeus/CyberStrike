// #40 — passive neighbour-ID (BOLA/IDOR) surfacing: a numeric object id in a 2xx path is flagged as
// an enumerable reference whose id±N neighbours are candidate cross-account objects.
import { describe, expect, test } from "bun:test"
import type { Transaction } from "../src/index"
import { numericIdEnumerable } from "../src/index"

let n = 0
function get(url: string, status: number): Transaction {
  return {
    id: `t${n++}`,
    source: "browser",
    host: "app.test",
    request: { method: "GET", url: `https://app.test${url}`, headers: [] },
    response: { status, headers: [{ name: "content-type", value: "application/json" }], body: "{}" },
  }
}

describe("numeric-id-enumerable (BOLA/IDOR neighbour surface, #40)", () => {
  test("fires on a numeric object id in a 2xx path, carrying the inject point", () => {
    const sigs = numericIdEnumerable.evaluate(get("/api/account/1005", 200))
    expect(sigs).toHaveLength(1)
    expect(sigs[0].category).toBe("access-control")
    expect(sigs[0].param?.location).toBe("path")
    expect(sigs[0].evidence).toContain("1005")
  })

  test("does NOT fire when the id addressed nothing (404/403)", () => {
    expect(numericIdEnumerable.evaluate(get("/api/account/1005", 404))).toHaveLength(0)
    expect(numericIdEnumerable.evaluate(get("/api/account/1005", 403))).toHaveLength(0)
  })

  test("does NOT fire on a UUID path id (not ±N-enumerable)", () => {
    expect(numericIdEnumerable.evaluate(get("/api/account/2f1c8e00-0000-4000-8000-000000000abc", 200))).toHaveLength(0)
  })

  test("does NOT fire on a numeric QUERY value (page/count noise, not a path object id)", () => {
    expect(numericIdEnumerable.evaluate(get("/api/list?page=2", 200))).toHaveLength(0)
  })

  test("one finding per (endpoint, path-param) via dedupKey", () => {
    const a = numericIdEnumerable.evaluate(get("/api/account/1005", 200))[0]
    const b = numericIdEnumerable.evaluate(get("/api/account/1006", 200))[0]
    // same logical endpoint + same path position → same dedupKey (collapses to one finding)
    expect(a.dedupKey).toBe(b.dedupKey)
  })
})
