import { describe, test, expect } from "bun:test"

// Standalone copies from inject-probe.ts (not exported)
type Location = "query" | "form_field" | "json_body" | "header" | "cookie" | "path"
interface InjPoint { location: Location; name: string }
interface ResolvedRequest { url: URL; contentType: string; body: string }

function multipartBoundary(r: { contentType: string; body: string }): string | null {
  const m = r.contentType.match(/boundary=("?)([^";]+)\1/i)
  if (m) return m[2].trim()
  const b = r.body.match(/^--(.+?)\r?\n/)
  return b ? b[1].trim() : null
}

function mpFieldName(seg: string): string | null {
  if (/filename="/i.test(seg)) return null
  const m = seg.match(/content-disposition:[^\r\n]*\bname="([^"]+)"/i)
  return m ? m[1] : null
}

function multipartFieldNames(body: string, boundary: string): string[] {
  const names: string[] = []
  for (const seg of body.split(`--${boundary}`)) {
    const n = mpFieldName(seg)
    if (n != null) names.push(n)
  }
  return names
}

function enumeratePoints(r: ResolvedRequest, only?: string): InjPoint[] {
  const points: InjPoint[] = []
  for (const [name] of r.url.searchParams) if (!only || only === name) points.push({ location: "query", name })
  if (r.contentType.includes("application/x-www-form-urlencoded")) {
    const form = new URLSearchParams(r.body)
    for (const [name] of form) if (!only || only === name) points.push({ location: "form_field", name })
  } else if (r.contentType.includes("multipart/form-data")) {
    const b = multipartBoundary(r)
    if (b)
      for (const name of multipartFieldNames(r.body, b))
        if (!only || only === name) points.push({ location: "form_field", name })
  }
  return points
}

describe("enumeratePoints", () => {
  test("discovers query string parameters", () => {
    const r: ResolvedRequest = {
      url: new URL("https://example.com/search?q=test&page=1"),
      contentType: "",
      body: "",
    }
    const points = enumeratePoints(r)
    expect(points).toEqual([
      { location: "query", name: "q" },
      { location: "query", name: "page" },
    ])
  })

  test("discovers form-urlencoded body parameters", () => {
    const r: ResolvedRequest = {
      url: new URL("https://example.com/login"),
      contentType: "application/x-www-form-urlencoded",
      body: "username=admin&password=secret",
    }
    const points = enumeratePoints(r)
    expect(points).toEqual([
      { location: "form_field", name: "username" },
      { location: "form_field", name: "password" },
    ])
  })

  test("discovers both query and form parameters", () => {
    const r: ResolvedRequest = {
      url: new URL("https://example.com/api?token=abc"),
      contentType: "application/x-www-form-urlencoded",
      body: "action=update",
    }
    const points = enumeratePoints(r)
    expect(points).toHaveLength(2)
    expect(points[0]).toEqual({ location: "query", name: "token" })
    expect(points[1]).toEqual({ location: "form_field", name: "action" })
  })

  test("filters by target parameter name when 'only' is provided", () => {
    const r: ResolvedRequest = {
      url: new URL("https://example.com/search?q=test&page=1&lang=en"),
      contentType: "",
      body: "",
    }
    const points = enumeratePoints(r, "q")
    expect(points).toEqual([{ location: "query", name: "q" }])
  })

  test("returns empty array when no parameters exist", () => {
    const r: ResolvedRequest = {
      url: new URL("https://example.com/api"),
      contentType: "application/json",
      body: '{"key":"value"}',
    }
    expect(enumeratePoints(r)).toEqual([])
  })

  test("discovers multipart form-data text fields", () => {
    const boundary = "----TestBoundary"
    const body = [
      `------TestBoundary\r\nContent-Disposition: form-data; name="comment"\r\n\r\nhello\r\n`,
      `------TestBoundary\r\nContent-Disposition: form-data; name="file"; filename="test.txt"\r\nContent-Type: text/plain\r\n\r\ndata\r\n`,
      `------TestBoundary--`,
    ].join("")
    const r: ResolvedRequest = {
      url: new URL("https://example.com/upload"),
      contentType: `multipart/form-data; boundary=${boundary}`,
      body,
    }
    const points = enumeratePoints(r)
    expect(points).toEqual([{ location: "form_field", name: "comment" }])
  })

  test("returns empty when 'only' param does not exist", () => {
    const r: ResolvedRequest = {
      url: new URL("https://example.com/search?q=test"),
      contentType: "",
      body: "",
    }
    expect(enumeratePoints(r, "nonexistent")).toEqual([])
  })
})
