import { describe, test, expect } from "bun:test"
import { buildXssPoc, domPocUrl, cspNote } from "../../../src/tool/inject-probe/poc"
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

const PAYLOAD = `<svg onload=alert("XSS")>`

describe("buildXssPoc — a hand-off PoC per injection location", () => {
  test("GET query → a clickable URL with the payload URL-encoded into the exact param", () => {
    const r = mkRequest("https://t.com/search?q=hi&page=1")
    const poc = buildXssPoc(r, { location: "query", name: "q" }, PAYLOAD)
    expect(poc.kind).toBe("url")
    expect(poc.clickable).toBe(true)
    // the URL parses and, once decoded, carries the exact payload; page param preserved
    const u = new URL(poc.poc_url!)
    expect(u.searchParams.get("q")).toBe(PAYLOAD)
    expect(u.searchParams.get("page")).toBe("1")
    expect(poc.poc_url).not.toContain("<svg") // raw angle brackets are percent-encoded on the wire
  })

  test("GET path → a clickable URL with the payload in the path segment", () => {
    const r = mkRequest("https://t.com/user/alice/profile")
    const poc = buildXssPoc(r, { location: "path", name: "1" }, PAYLOAD) // segment index 1 = alice
    expect(poc.kind).toBe("url")
    expect(poc.clickable).toBe(true)
    expect(poc.poc_url).toContain("%3Csvg") // path-encoded payload present
  })

  test("POST form-urlencoded → a self-submitting HTML page (auto-POST)", () => {
    const r = mkRequest("https://t.com/comment", { method: "POST", contentType: "application/x-www-form-urlencoded", body: "text=hi&csrf=abc" })
    const poc = buildXssPoc(r, { location: "form_field", name: "text" }, PAYLOAD)
    expect(poc.kind).toBe("form")
    expect(poc.clickable).toBe(false)
    expect(poc.poc_html).toContain(`<form action="https://t.com/comment" method="POST">`)
    expect(poc.poc_html).toContain("document.forms[0].submit()")
    // payload is HTML-attribute-escaped inside the hidden input (no raw < that breaks the form)
    expect(poc.poc_html).toContain("&lt;svg")
    expect(poc.poc_html).toContain(`name="csrf"`) // sibling field preserved
    expect(poc.poc_curl).toContain("-X POST")
  })

  test("JSON body → curl reproducer (not clickable)", () => {
    const r = mkRequest("https://t.com/api", { method: "POST", contentType: "application/json", body: `{"name":"hi"}` })
    const poc = buildXssPoc(r, { location: "json_body", name: "name" }, PAYLOAD)
    expect(poc.kind).toBe("curl")
    expect(poc.clickable).toBe(false)
    expect(poc.poc_curl).toContain("--data")
    expect(poc.poc_curl).toContain("alert")
  })

  test("header injection → curl reproducer with the header carrying the payload", () => {
    const r = mkRequest("https://t.com/", { headers: { "user-agent": "x" } })
    const poc = buildXssPoc(r, { location: "header", name: "User-Agent" }, PAYLOAD)
    expect(poc.kind).toBe("curl")
    expect(poc.clickable).toBe(false)
    expect(poc.poc_curl.toLowerCase()).toContain("user-agent")
  })

  test("cookie injection → curl reproducer", () => {
    const r = mkRequest("https://t.com/", { headers: { cookie: "sid=1" } })
    const poc = buildXssPoc(r, { location: "cookie", name: "tracking" }, PAYLOAD)
    expect(poc.kind).toBe("curl")
    expect(poc.poc_curl.toLowerCase()).toContain("cookie")
  })

  test("curl single-quotes are escaped in a raw (non-URL-encoded) value — no shell breakout", () => {
    // a header value carries the literal quote (not percent-encoded), so it exercises shell-quoting
    const r = mkRequest("https://t.com/", { headers: { "x-test": "v" } })
    const poc = buildXssPoc(r, { location: "header", name: "X-Test" }, `a'b`)
    expect(poc.poc_curl).toContain(`'\\''`) // embedded single quote safely escaped
  })
})

describe("domPocUrl — DOM XSS via URL fragment (client-side, no server round-trip)", () => {
  test("payload placed raw in the fragment; existing fragment replaced", () => {
    expect(domPocUrl("https://t.com/app", PAYLOAD)).toBe(`https://t.com/app#${PAYLOAD}`)
    expect(domPocUrl("https://t.com/app#old", "x")).toBe("https://t.com/app#x")
  })
})

describe("cspNote — flags a PoC a CSP may block", () => {
  test("restrictive CSP (no unsafe-inline) → warning", () => {
    expect(cspNote("default-src 'self'; script-src 'self'")).toContain("⚠️")
  })
  test("permissive CSP (unsafe-inline) → soft note, no warning", () => {
    expect(cspNote("script-src 'self' 'unsafe-inline'")).not.toContain("⚠️")
  })
  test("no CSP → no note", () => {
    expect(cspNote(undefined)).toBeUndefined()
  })
})
