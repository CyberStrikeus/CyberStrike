import { describe, test, expect } from "bun:test"

// Standalone copies from inject-probe.ts (not exported)
const FORBIDDEN_HEADERS = new Set([
  "host",
  ":authority",
  ":method",
  ":path",
  ":scheme",
  "content-length",
  "connection",
  "transfer-encoding",
  "te",
  "upgrade",
  "content-type",
])

type Location = "query" | "form_field" | "json_body" | "header" | "cookie" | "path"
interface InjPoint {
  location: Location
  name: string
}

function validatePoints(pts: InjPoint[]): { points: InjPoint[]; rejected: { point: string; reason: string }[] } {
  const points: InjPoint[] = []
  const rejected: { point: string; reason: string }[] = []
  for (const p of pts) {
    if (p.location === "header" && FORBIDDEN_HEADERS.has(p.name.toLowerCase())) {
      rejected.push({
        point: `header:${p.name}`,
        reason: "routing/framing header — refused (no response-splitting/rerouting)",
      })
      continue
    }
    points.push(p)
  }
  return { points, rejected }
}

const sanitizeHeaderValue = (v: string) => v.replace(/[\r\n ]/g, "")

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
    expect(result.rejected[0].point).toBe("header:Host")
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

describe("sanitizeHeaderValue", () => {
  test("strips carriage return — prevents HTTP response splitting", () => {
    expect(sanitizeHeaderValue("value\rinjected")).toBe("valueinjected")
  })

  test("strips newline — prevents header injection", () => {
    expect(sanitizeHeaderValue("value\nInjected: header")).toBe("valueInjected:header")
  })

  test("strips CRLF sequence", () => {
    expect(sanitizeHeaderValue("value\r\nSet-Cookie: evil=1")).toBe("valueSet-Cookie:evil=1")
  })

  test("strips spaces", () => {
    expect(sanitizeHeaderValue("some value here")).toBe("somevaluehere")
  })

  test("leaves clean values unchanged", () => {
    expect(sanitizeHeaderValue("Bearer_token123")).toBe("Bearer_token123")
  })

  test("handles empty string", () => {
    expect(sanitizeHeaderValue("")).toBe("")
  })
})
