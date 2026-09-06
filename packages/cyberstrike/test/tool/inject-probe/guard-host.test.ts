import { describe, test, expect } from "bun:test"
import { guardHost } from "../../../src/tool/inject-probe/send"
import type { ResolvedRequest } from "../../../src/tool/inject-probe/types"

const mkReq = (url: string): ResolvedRequest =>
  ({
    url: new URL(url),
    method: "GET",
    headers: {},
    body: "",
    contentType: "",
    auth: { source: "none" },
    provenance: { fromRaw: false, reconstructed: false, bodyMaybeTruncated: false },
  }) as ResolvedRequest

describe("guardHost", () => {
  test("allows same host", () => {
    const r = mkReq("https://example.com/api/users")
    const target = new URL("https://example.com/api/admin")
    expect(guardHost(r, target)).toEqual({ ok: true })
  })

  test("allows same host with different paths", () => {
    const r = mkReq("https://target.com/login")
    const target = new URL("https://target.com/dashboard/settings")
    expect(guardHost(r, target)).toEqual({ ok: true })
  })

  test("allows same host with different query strings", () => {
    const r = mkReq("https://app.io/search?q=test")
    const target = new URL("https://app.io/search?q=payload")
    expect(guardHost(r, target)).toEqual({ ok: true })
  })

  test("rejects different host", () => {
    const r = mkReq("https://example.com/api")
    const target = new URL("https://evil.com/steal")
    const result = guardHost(r, target)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain("evil.com")
  })

  test("rejects different subdomain", () => {
    const r = mkReq("https://app.example.com/api")
    const target = new URL("https://admin.example.com/api")
    expect(guardHost(r, target).ok).toBe(false)
  })

  test("rejects different port on same hostname", () => {
    const r = mkReq("https://localhost:3000/api")
    const target = new URL("https://localhost:8080/api")
    expect(guardHost(r, target).ok).toBe(false)
  })

  test("allows same host with same port", () => {
    const r = mkReq("http://localhost:4096/api")
    const target = new URL("http://localhost:4096/other")
    expect(guardHost(r, target)).toEqual({ ok: true })
  })

  test("treats http vs https on same hostname as same host", () => {
    const r = mkReq("https://example.com/api")
    const target = new URL("http://example.com/api")
    expect(guardHost(r, target)).toEqual({ ok: true })
  })

  test("rejects IP address vs hostname even if they resolve the same", () => {
    const r = mkReq("https://example.com/api")
    const target = new URL("https://93.184.216.34/api")
    expect(guardHost(r, target).ok).toBe(false)
  })
})
