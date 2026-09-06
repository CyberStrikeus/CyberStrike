import { describe, test, expect } from "bun:test"
import { validatePoints } from "../../../src/tool/inject-probe/resolve"
import type { InjPoint } from "../../../src/tool/inject-probe/types"

describe("validatePoints", () => {
  test("accepts query parameters", () => {
    const result = validatePoints([{ location: "query", name: "search" }])
    expect(result.points).toHaveLength(1)
    expect(result.rejected).toHaveLength(0)
  })

  test("accepts form_field parameters", () => {
    const result = validatePoints([{ location: "form_field", name: "username" }])
    expect(result.points).toHaveLength(1)
  })

  test("accepts safe headers like X-Custom", () => {
    const result = validatePoints([{ location: "header", name: "X-Custom-Token" }])
    expect(result.points).toHaveLength(1)
    expect(result.rejected).toHaveLength(0)
  })

  test("rejects Host header — prevents request rerouting", () => {
    const result = validatePoints([{ location: "header", name: "Host" }])
    expect(result.points).toHaveLength(0)
    expect(result.rejected).toHaveLength(1)
    expect(result.rejected[0]!.point).toBe("header:Host")
  })

  test("rejects Transfer-Encoding — prevents request smuggling", () => {
    const result = validatePoints([{ location: "header", name: "Transfer-Encoding" }])
    expect(result.points).toHaveLength(0)
    expect(result.rejected).toHaveLength(1)
  })

  test("rejects Content-Length — prevents framing attacks", () => {
    const result = validatePoints([{ location: "header", name: "Content-Length" }])
    expect(result.rejected).toHaveLength(1)
  })

  test("rejects Connection header", () => {
    const result = validatePoints([{ location: "header", name: "connection" }])
    expect(result.rejected).toHaveLength(1)
  })

  test("rejects HTTP/2 pseudo-headers", () => {
    const result = validatePoints([
      { location: "header", name: ":authority" },
      { location: "header", name: ":method" },
      { location: "header", name: ":path" },
      { location: "header", name: ":scheme" },
    ])
    expect(result.points).toHaveLength(0)
    expect(result.rejected).toHaveLength(4)
  })

  test("rejection is case-insensitive", () => {
    const result = validatePoints([{ location: "header", name: "HOST" }])
    expect(result.rejected).toHaveLength(1)
  })

  test("mixed valid and invalid points — keeps valid, rejects invalid", () => {
    const result = validatePoints([
      { location: "query", name: "q" },
      { location: "header", name: "Host" },
      { location: "header", name: "X-Token" },
      { location: "header", name: "Transfer-Encoding" },
      { location: "form_field", name: "user" },
    ])
    expect(result.points).toHaveLength(3)
    expect(result.rejected).toHaveLength(2)
  })

  test("non-header locations are never rejected even with forbidden names", () => {
    const result = validatePoints([
      { location: "query", name: "host" },
      { location: "cookie", name: "transfer-encoding" },
    ])
    expect(result.points).toHaveLength(2)
    expect(result.rejected).toHaveLength(0)
  })
})

describe("sanitizeHeaderValue (tested indirectly via applyPayload)", () => {
  // sanitizeHeaderValue is a private const in mutate.ts — tested indirectly
  // through the applyPayload header injection path in apply-payload.test.ts.
  // Dedicated tests for the sanitization logic are in apply-payload.test.ts.
  test("placeholder — see apply-payload.test.ts header injection tests", () => {
    expect(true).toBe(true)
  })
})
