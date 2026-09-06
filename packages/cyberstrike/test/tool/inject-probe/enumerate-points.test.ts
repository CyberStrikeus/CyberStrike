import { describe, test, expect } from "bun:test"
import { enumeratePoints } from "../../../src/tool/inject-probe/resolve"
import type { ResolvedRequest } from "../../../src/tool/inject-probe/types"

const mkReq = (url: string, opts: Partial<ResolvedRequest> = {}): ResolvedRequest => ({
  method: "GET",
  url: new URL(url),
  headers: {},
  body: opts.body ?? "",
  contentType: opts.contentType ?? "",
  auth: { source: "none" },
  provenance: { fromRaw: false, reconstructed: false, bodyMaybeTruncated: false },
})

describe("enumeratePoints", () => {
  test("discovers query string parameters", () => {
    const r = mkReq("https://example.com/search?q=test&page=1")
    const points = enumeratePoints(r)
    expect(points).toEqual([
      { location: "query", name: "q" },
      { location: "query", name: "page" },
    ])
  })

  test("discovers form-urlencoded body parameters", () => {
    const r = mkReq("https://example.com/login", {
      contentType: "application/x-www-form-urlencoded",
      body: "username=admin&password=secret",
    })
    const points = enumeratePoints(r)
    expect(points).toEqual([
      { location: "form_field", name: "username" },
      { location: "form_field", name: "password" },
    ])
  })

  test("discovers both query and form parameters", () => {
    const r = mkReq("https://example.com/api?token=abc", {
      contentType: "application/x-www-form-urlencoded",
      body: "action=update",
    })
    const points = enumeratePoints(r)
    expect(points).toHaveLength(2)
    expect(points[0]).toEqual({ location: "query", name: "token" })
    expect(points[1]).toEqual({ location: "form_field", name: "action" })
  })

  test("filters by target parameter name when 'only' is provided", () => {
    const r = mkReq("https://example.com/search?q=test&page=1&lang=en")
    const points = enumeratePoints(r, "q")
    expect(points).toEqual([{ location: "query", name: "q" }])
  })

  test("returns empty array when no parameters exist", () => {
    const r = mkReq("https://example.com/api", {
      contentType: "application/json",
      body: '{"key":"value"}',
    })
    expect(enumeratePoints(r)).toEqual([])
  })

  test("discovers multipart form-data text fields", () => {
    const boundary = "----TestBoundary"
    const body = [
      `------TestBoundary\r\nContent-Disposition: form-data; name="comment"\r\n\r\nhello\r\n`,
      `------TestBoundary\r\nContent-Disposition: form-data; name="file"; filename="test.txt"\r\nContent-Type: text/plain\r\n\r\ndata\r\n`,
      `------TestBoundary--`,
    ].join("")
    const r = mkReq("https://example.com/upload", {
      contentType: `multipart/form-data; boundary=${boundary}`,
      body,
    })
    const points = enumeratePoints(r)
    expect(points).toEqual([{ location: "form_field", name: "comment" }])
  })

  test("returns empty when 'only' param does not exist", () => {
    const r = mkReq("https://example.com/search?q=test")
    expect(enumeratePoints(r, "nonexistent")).toEqual([])
  })
})
