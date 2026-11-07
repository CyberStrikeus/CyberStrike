import { describe, expect, test } from "bun:test"
import { parseRequestTarget } from "../../src/server/routes/session"

describe("parseRequestTarget — dispatch-brief URL from a raw request", () => {
  test("combines method + Host + path", () => {
    const raw = "POST /api/flags HTTP/1.1\r\nHost: portal.example.com\r\nAccept: */*\r\n\r\n{}"
    expect(parseRequestTarget(raw)).toBe("POST portal.example.com/api/flags")
  })

  test("case-insensitive Host header", () => {
    const raw = "GET /x HTTP/1.1\r\nhost: h.example.com\r\n\r\n"
    expect(parseRequestTarget(raw)).toBe("GET h.example.com/x")
  })

  test("falls back to the request line when no Host header", () => {
    expect(parseRequestTarget("GET /just/path HTTP/1.1\r\n\r\n")).toBe("GET /just/path")
  })

  test("undefined on an unparseable request line", () => {
    expect(parseRequestTarget("")).toBeUndefined()
    expect(parseRequestTarget("garbage line")).toBeUndefined()
  })
})
