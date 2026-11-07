import { describe, test, expect } from "bun:test"
import { resolveFromTarget, parseRaw } from "../../../src/tool/inject-probe/resolve"

describe("parseRaw", () => {
  test("splits request line, headers, body with CRLF", () => {
    const raw = "GET /page HTTP/1.1\r\nHost: example.com\r\nCookie: s=abc\r\n\r\nbody here"
    const result = parseRaw(raw)
    expect(result.requestLine).toBe("GET /page HTTP/1.1")
    expect(result.headers["host"]).toBe("example.com")
    expect(result.headers["cookie"]).toBe("s=abc")
    expect(result.body).toBe("body here")
  })

  test("handles LF-only line endings", () => {
    const raw = "POST /api HTTP/1.1\nContent-Type: application/json\n\n{\"key\":\"value\"}"
    const result = parseRaw(raw)
    expect(result.requestLine).toBe("POST /api HTTP/1.1")
    expect(result.headers["content-type"]).toBe("application/json")
    expect(result.body).toBe('{"key":"value"}')
  })

  test("empty body when no double-newline separator", () => {
    const raw = "GET /path HTTP/1.1\r\nHost: example.com"
    const result = parseRaw(raw)
    expect(result.body).toBe("")
    expect(result.requestLine).toBe("GET /path HTTP/1.1")
  })

  test("headers are lowercased", () => {
    const raw = "GET / HTTP/1.1\r\nX-Custom-Header: value\r\nAuthorization: Bearer tok\r\n\r\n"
    const result = parseRaw(raw)
    expect(result.headers["x-custom-header"]).toBe("value")
    expect(result.headers["authorization"]).toBe("Bearer tok")
  })
})

describe("resolveFromTarget", () => {
  test("valid URL returns ResolvedRequest", () => {
    const result = resolveFromTarget({ method: "GET", url: "http://example.com/page?q=1" })
    expect("error" in result).toBe(false)
    if (!("error" in result)) {
      expect(result.method).toBe("GET")
      expect(result.url.hostname).toBe("example.com")
      expect(result.url.searchParams.get("q")).toBe("1")
      expect(result.body).toBe("")
      expect(result.contentType).toBe("")
    }
  })

  test("invalid URL returns error", () => {
    const result = resolveFromTarget({ method: "GET", url: "not-a-url" })
    expect("error" in result).toBe(true)
  })

  test("headers are lowercased", () => {
    const result = resolveFromTarget({
      method: "GET",
      url: "http://example.com/",
      headers: { "X-Custom": "val", "Content-Type": "text/html" },
    })
    if (!("error" in result)) {
      expect(result.headers["x-custom"]).toBe("val")
      expect(result.headers["content-type"]).toBe("text/html")
    }
  })

  test("content_type param takes precedence over header", () => {
    const result = resolveFromTarget({
      method: "POST",
      url: "http://example.com/",
      headers: { "Content-Type": "text/plain" },
      content_type: "application/json",
    })
    if (!("error" in result)) {
      expect(result.contentType).toBe("application/json")
      expect(result.headers["content-type"]).toBe("application/json")
    }
  })

  test("auth source = target when cookie present", () => {
    const result = resolveFromTarget({
      method: "GET",
      url: "http://example.com/",
      headers: { Cookie: "session=abc" },
    })
    if (!("error" in result)) {
      expect(result.auth.source).toBe("target")
    }
  })

  test("auth source = target when authorization present", () => {
    const result = resolveFromTarget({
      method: "GET",
      url: "http://example.com/",
      headers: { Authorization: "Bearer tok" },
    })
    if (!("error" in result)) {
      expect(result.auth.source).toBe("target")
    }
  })

  test("auth source = none when no auth headers", () => {
    const result = resolveFromTarget({ method: "GET", url: "http://example.com/" })
    if (!("error" in result)) {
      expect(result.auth.source).toBe("none")
    }
  })

  test("body is preserved", () => {
    const result = resolveFromTarget({
      method: "POST",
      url: "http://example.com/api",
      body: "field=value",
    })
    if (!("error" in result)) {
      expect(result.body).toBe("field=value")
    }
  })

  test("provenance fields are correct for target", () => {
    const result = resolveFromTarget({ method: "GET", url: "http://example.com/" })
    if (!("error" in result)) {
      expect(result.provenance.fromRaw).toBe(false)
      expect(result.provenance.reconstructed).toBe(false)
      expect(result.provenance.bodyMaybeTruncated).toBe(false)
    }
  })
})
