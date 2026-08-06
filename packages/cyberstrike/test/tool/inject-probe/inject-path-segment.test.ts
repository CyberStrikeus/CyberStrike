import { describe, test, expect } from "bun:test"

// Standalone copy from inject-probe.ts (not exported)
function injectPathSegment(pathname: string, indexStr: string, value: string): string {
  const segs = pathname.split("/")
  const nonEmpty: number[] = []
  for (let i = 0; i < segs.length; i++) if (segs[i] !== "") nonEmpty.push(i)
  const target = nonEmpty[Number(indexStr)]
  if (target == null) return pathname
  segs[target] = encodeURIComponent(value.replace(/\.\.(\/|\\)?/g, ""))
  return segs.join("/")
}

describe("injectPathSegment", () => {
  test("replaces first non-empty segment (index 0)", () => {
    expect(injectPathSegment("/api/users/123", "0", "PAYLOAD")).toBe("/PAYLOAD/users/123")
  })

  test("replaces second segment (index 1)", () => {
    expect(injectPathSegment("/api/users/123", "1", "PAYLOAD")).toBe("/api/PAYLOAD/123")
  })

  test("replaces last segment", () => {
    expect(injectPathSegment("/api/users/123", "2", "PAYLOAD")).toBe("/api/users/PAYLOAD")
  })

  test("returns original path for out-of-bounds index", () => {
    expect(injectPathSegment("/api/users", "5", "PAYLOAD")).toBe("/api/users")
  })

  test("URL-encodes the injected value", () => {
    const result = injectPathSegment("/api/data/test", "1", "a b&c=d")
    expect(result).toContain("a%20b%26c%3Dd")
  })

  test("strips ../ traversal from value — prevents path escape", () => {
    const result = injectPathSegment("/api/files/doc", "2", "../../etc/passwd")
    expect(result).not.toContain("..")
    expect(result).toContain("etc")
  })

  test("strips ..\\ traversal (Windows-style)", () => {
    const result = injectPathSegment("/api/files/doc", "2", "..\\..\\windows\\system32")
    expect(result).not.toContain("..")
  })

  test("strips mixed traversal patterns", () => {
    const result = injectPathSegment("/api/data/x", "2", "../test")
    expect(result).not.toContain("..")
    expect(result).toContain("test")
  })

  test("handles single-segment path", () => {
    expect(injectPathSegment("/endpoint", "0", "new")).toBe("/new")
  })

  test("handles path with trailing slash", () => {
    expect(injectPathSegment("/api/users/", "1", "PAYLOAD")).toBe("/api/PAYLOAD/")
  })
})
