import { describe, test, expect } from "bun:test"
import { applyPayload } from "../../../src/tool/inject-probe/mutate"
import type { ResolvedRequest, InjPoint } from "../../../src/tool/inject-probe/types"

const mkRequest = (urlStr: string, opts: Partial<ResolvedRequest> = {}): ResolvedRequest => ({
  method: opts.method ?? "GET",
  url: new URL(urlStr),
  headers: opts.headers ?? {},
  body: opts.body ?? "",
  contentType: opts.contentType ?? "",
  auth: { source: "none" },
  provenance: { fromRaw: false, reconstructed: false, bodyMaybeTruncated: false },
})

describe("applyPayload", () => {
  describe("query injection", () => {
    test("sets query parameter value", () => {
      const r = mkRequest("https://target.com/search?q=test&page=1")
      const result = applyPayload(r, { location: "query", name: "q" }, "<script>alert(1)</script>")
      const url = new URL(result.url)
      expect(url.searchParams.get("q")).toBe("<script>alert(1)</script>")
      expect(url.searchParams.get("page")).toBe("1")
    })

    test("adds new query parameter if not present", () => {
      const r = mkRequest("https://target.com/api")
      const result = applyPayload(r, { location: "query", name: "inject" }, "payload")
      expect(new URL(result.url).searchParams.get("inject")).toBe("payload")
    })
  })

  describe("form_field injection", () => {
    test("sets form-urlencoded field", () => {
      const r = mkRequest("https://target.com/login", {
        contentType: "application/x-www-form-urlencoded",
        body: "user=admin&pass=secret",
      })
      const result = applyPayload(r, { location: "form_field", name: "user" }, "' OR 1=1--")
      const params = new URLSearchParams(result.body)
      expect(params.get("user")).toBe("' OR 1=1--")
      expect(params.get("pass")).toBe("secret")
    })
  })

  describe("json_body injection", () => {
    test("sets JSON field value", () => {
      const r = mkRequest("https://target.com/api", {
        contentType: "application/json",
        body: '{"username":"admin","role":"user"}',
      })
      const result = applyPayload(r, { location: "json_body", name: "username" }, "{{7*7}}")
      const parsed = JSON.parse(result.body)
      expect(parsed.username).toBe("{{7*7}}")
      expect(parsed.role).toBe("user")
    })
  })

  describe("header injection", () => {
    test("sets header value with sanitization", () => {
      const r = mkRequest("https://target.com/api", { headers: { "x-token": "old" } })
      const result = applyPayload(r, { location: "header", name: "x-token" }, "payload")
      expect(result.headers["x-token"]).toBe("payload")
    })

    test("sanitizes CR/LF from header value", () => {
      const r = mkRequest("https://target.com/api")
      const result = applyPayload(r, { location: "header", name: "x-custom" }, "val\r\nEvil: header")
      expect(result.headers["x-custom"]).not.toContain("\r")
      expect(result.headers["x-custom"]).not.toContain("\n")
    })
  })

  describe("cookie injection", () => {
    test("sets cookie value", () => {
      const r = mkRequest("https://target.com/api", { headers: { cookie: "session=abc; lang=en" } })
      const result = applyPayload(r, { location: "cookie", name: "session" }, "INJECTED")
      expect(result.headers["cookie"]).toContain("session=INJECTED")
      expect(result.headers["cookie"]).toContain("lang=en")
    })
  })

  describe("path injection", () => {
    test("replaces path segment by index", () => {
      const r = mkRequest("https://target.com/api/users/123")
      const result = applyPayload(r, { location: "path", name: "2" }, "PAYLOAD")
      expect(new URL(result.url).pathname).toBe("/api/users/PAYLOAD")
    })
  })

  describe("isolation", () => {
    test("does not mutate the original request headers", () => {
      const headers = { "x-token": "original" }
      const r = mkRequest("https://target.com/api", { headers })
      applyPayload(r, { location: "header", name: "x-token" }, "modified")
      expect(headers["x-token"]).toBe("original")
    })

    test("does not mutate the original URL", () => {
      const r = mkRequest("https://target.com/search?q=safe")
      applyPayload(r, { location: "query", name: "q" }, "injected")
      expect(r.url.searchParams.get("q")).toBe("safe")
    })
  })
})
