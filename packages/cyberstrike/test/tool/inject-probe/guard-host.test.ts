import { describe, test, expect } from "bun:test"

// Standalone copy of guardHost from inject-probe.ts (not exported)
function guardHost(r: { url: URL }, target: URL): { ok: true } | { ok: false; reason: string } {
  if (target.host !== r.url.host) return { ok: false, reason: `out-of-scope host ${target.host}` }
  return { ok: true }
}

describe("guardHost", () => {
  test("allows same host", () => {
    const r = { url: new URL("https://example.com/api/users") }
    const target = new URL("https://example.com/api/admin")
    expect(guardHost(r, target)).toEqual({ ok: true })
  })

  test("allows same host with different paths", () => {
    const r = { url: new URL("https://target.com/login") }
    const target = new URL("https://target.com/dashboard/settings")
    expect(guardHost(r, target)).toEqual({ ok: true })
  })

  test("allows same host with different query strings", () => {
    const r = { url: new URL("https://app.io/search?q=test") }
    const target = new URL("https://app.io/search?q=payload")
    expect(guardHost(r, target)).toEqual({ ok: true })
  })

  test("rejects different host", () => {
    const r = { url: new URL("https://example.com/api") }
    const target = new URL("https://evil.com/steal")
    const result = guardHost(r, target)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain("evil.com")
  })

  test("rejects different subdomain", () => {
    const r = { url: new URL("https://app.example.com/api") }
    const target = new URL("https://admin.example.com/api")
    expect(guardHost(r, target).ok).toBe(false)
  })

  test("rejects different port on same hostname", () => {
    const r = { url: new URL("https://localhost:3000/api") }
    const target = new URL("https://localhost:8080/api")
    expect(guardHost(r, target).ok).toBe(false)
  })

  test("allows same host with same port", () => {
    const r = { url: new URL("http://localhost:4096/api") }
    const target = new URL("http://localhost:4096/other")
    expect(guardHost(r, target)).toEqual({ ok: true })
  })

  test("treats http vs https on same hostname as same host", () => {
    const r = { url: new URL("https://example.com/api") }
    const target = new URL("http://example.com/api")
    expect(guardHost(r, target)).toEqual({ ok: true })
  })

  test("rejects IP address vs hostname even if they resolve the same", () => {
    const r = { url: new URL("https://example.com/api") }
    const target = new URL("https://93.184.216.34/api")
    expect(guardHost(r, target).ok).toBe(false)
  })
})
