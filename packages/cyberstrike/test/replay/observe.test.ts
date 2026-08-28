import { describe, test, expect } from "bun:test"
import { Observe } from "../../src/replay/observe"
import type { ReplayResponse } from "../../src/replay/response"

function result(status: number, body: string, totalMs: number): ReplayResponse.Result {
  return {
    response: { version: "HTTP/1.1", status, reason: "", headers: [], body: new TextEncoder().encode(body) },
    timing: { totalMs },
  }
}

describe("Observe.reflection", () => {
  test("detects a raw (un-encoded) reflection", () => {
    const r = Observe.reflection(`<div>zz9marker zz9marker</div>`, "zz9marker")
    expect(r.raw).toBe(true)
    expect(r.count).toBe(2)
    expect(r.htmlEncoded).toBe(false)
  })

  test("detects an html-encoded-only reflection", () => {
    // marker '<x>' rendered as entities, not verbatim
    const r = Observe.reflection(`safe: &#60;x&#62;`, "<x>")
    expect(r.raw).toBe(false)
    expect(r.htmlEncoded).toBe(true)
  })

  test("no reflection", () => {
    expect(Observe.reflection(`nothing here`, "zz9marker")).toEqual({ raw: false, htmlEncoded: false, count: 0 })
  })
})

describe("Observe.errorSignatures", () => {
  test("detects a SQL error signature", () => {
    expect(Observe.errorSignatures(`You have an error in your SQL syntax near`)).toContain("sqli")
    expect(Observe.errorSignatures(`Warning: mysql_fetch_array()`)).toContain("sqli")
    expect(Observe.errorSignatures(`ORA-00933: SQL command not properly ended`)).toContain("sqli")
  })

  test("detects mongo / stack-trace signatures", () => {
    expect(Observe.errorSignatures(`MongoError: E11000 duplicate key`)).toContain("nosql")
    expect(Observe.errorSignatures(`Traceback (most recent call last):`)).toContain("stacktrace")
  })

  test("clean response yields no signatures", () => {
    expect(Observe.errorSignatures(`{"ok":true}`)).toEqual([])
  })
})

describe("Observe.diff", () => {
  test("reports status / length / time deltas and identity", () => {
    const base = result(200, "hello", 100)
    const mut = result(500, "hello world!!", 250)
    const d = Observe.diff(base, mut)
    expect(d.statusChanged).toBe(true)
    expect(d.baselineStatus).toBe(200)
    expect(d.mutatedStatus).toBe(500)
    expect(d.lengthDelta).toBe("hello world!!".length - "hello".length)
    expect(d.timeDeltaMs).toBe(150)
    expect(d.bodyIdentical).toBe(false)
  })

  test("identical bodies are flagged", () => {
    const d = Observe.diff(result(200, "same", 10), result(200, "same", 12))
    expect(d.bodyIdentical).toBe(true)
    expect(d.statusChanged).toBe(false)
    expect(d.lengthDelta).toBe(0)
  })

  test("time delta surfaces a deliberate SLEEP (time-based lead)", () => {
    const d = Observe.diff(result(200, "x", 40), result(200, "x", 2050))
    expect(d.timeDeltaMs).toBeGreaterThan(2000)
  })
})
