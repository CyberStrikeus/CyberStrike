import { describe, expect, test } from "bun:test"
import { stableStringify, toolSig, isProgressTool, READ_ONLY_TOOLS } from "../../../src/session/stuck/signals"

describe("stableStringify — key-order invariant", () => {
  test("same object, different key order → identical string", () => {
    expect(stableStringify({ a: 1, b: 2 })).toBe(stableStringify({ b: 2, a: 1 }))
  })
  test("nested key order invariant", () => {
    expect(stableStringify({ x: { p: 1, q: 2 } })).toBe(stableStringify({ x: { q: 2, p: 1 } }))
  })
  test("arrays keep order (order is significant)", () => {
    expect(stableStringify([1, 2])).not.toBe(stableStringify([2, 1]))
  })
  test("scalars", () => {
    expect(stableStringify("a")).toBe('"a"')
    expect(stableStringify(5)).toBe("5")
    expect(stableStringify(null)).toBe("null")
  })
})

describe("toolSig — (tool + args) keying", () => {
  test("same tool + same args → same sig", () => {
    expect(toolSig("bash", { command: "id" })).toBe(toolSig("bash", { command: "id" }))
  })
  test("same tool + args in different key order → same sig", () => {
    expect(toolSig("t", { a: 1, b: 2 })).toBe(toolSig("t", { b: 2, a: 1 }))
  })
  test("same tool + DIFFERENT args → different sig (the false-positive hinge)", () => {
    expect(toolSig("read", { id: 1 })).not.toBe(toolSig("read", { id: 2 }))
  })
  test("different tool + same args → different sig", () => {
    expect(toolSig("a", { x: 1 })).not.toBe(toolSig("b", { x: 1 }))
  })
})

describe("isProgressTool — read-only vs progress", () => {
  test("read/status tools are NOT progress", () => {
    for (const t of ["methodology_status", "get_coverage_notes", "web_get_session_context", "scope_check"]) {
      expect(isProgressTool(t)).toBe(false)
      expect(READ_ONLY_TOOLS.has(t)).toBe(true)
    }
  })
  test("write/exploit tools ARE progress", () => {
    for (const t of ["bash", "report_vulnerability", "record_coverage_note", "web_write_object", "webfetch"]) {
      expect(isProgressTool(t)).toBe(true)
    }
  })
})
