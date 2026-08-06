import { describe, test, expect } from "bun:test"

// Standalone copies from inject-probe.ts (not exported)
function excerptAround(text: string, index: number, matchLen: number, radius = 90): string {
  const start = Math.max(0, index - radius)
  const end = Math.min(text.length, index + matchLen + radius)
  const body = text.slice(start, end).replace(/\s+/g, " ").trim().slice(0, 320)
  return (start > 0 ? "…" : "") + body + (end < text.length ? "…" : "")
}

function excerptOf(text: string, needle: string, radius = 90): string {
  const i = text.indexOf(needle)
  return i < 0 ? "" : excerptAround(text, i, needle.length, radius)
}

describe("excerptAround", () => {
  test("extracts context around a match in the middle", () => {
    const text = "a".repeat(100) + "FOUND" + "b".repeat(100)
    const result = excerptAround(text, 100, 5)
    expect(result).toContain("FOUND")
    expect(result.startsWith("…")).toBe(true)
    expect(result.endsWith("…")).toBe(true)
  })

  test("no leading ellipsis when match is at the start", () => {
    const text = "FOUND" + "x".repeat(200)
    const result = excerptAround(text, 0, 5)
    expect(result.startsWith("…")).toBe(false)
    expect(result.startsWith("FOUND")).toBe(true)
  })

  test("no trailing ellipsis when match is at the end", () => {
    const text = "x".repeat(50) + "FOUND"
    const result = excerptAround(text, 50, 5)
    expect(result.endsWith("FOUND")).toBe(true)
    expect(result.endsWith("…")).toBe(false)
  })

  test("collapses whitespace to single spaces", () => {
    const text = "before   \n\t  FOUND   \r\n  after"
    const result = excerptAround(text, 12, 5, 20)
    expect(result).not.toContain("\n")
    expect(result).not.toContain("\t")
    expect(result).not.toContain("  ")
  })

  test("caps output at 320 chars", () => {
    const text = "x".repeat(1000)
    const result = excerptAround(text, 0, 5, 500)
    expect(result.length).toBeLessThanOrEqual(320 + 2) // +2 for possible ellipsis
  })

  test("custom radius controls context window", () => {
    const text = "a".repeat(200) + "FOUND" + "b".repeat(200)
    const small = excerptAround(text, 200, 5, 10)
    const large = excerptAround(text, 200, 5, 50)
    expect(large.length).toBeGreaterThan(small.length)
  })
})

describe("excerptOf", () => {
  test("finds needle and returns context around it", () => {
    const text = "prefix uid=0(root) gid=0(root) suffix"
    const result = excerptOf(text, "uid=0(root)")
    expect(result).toContain("uid=0(root)")
  })

  test("returns empty string when needle is not found", () => {
    expect(excerptOf("no match here", "MISSING")).toBe("")
  })

  test("finds first occurrence of needle", () => {
    const text = "first MATCH and second MATCH"
    const result = excerptOf(text, "MATCH")
    expect(result).toContain("first MATCH")
  })

  test("respects custom radius", () => {
    const text = "a".repeat(100) + "NEEDLE" + "b".repeat(100)
    const result = excerptOf(text, "NEEDLE", 5)
    expect(result).toContain("NEEDLE")
    expect(result.length).toBeLessThan(30)
  })
})
