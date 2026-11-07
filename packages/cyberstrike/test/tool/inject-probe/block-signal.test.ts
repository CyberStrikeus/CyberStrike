import { describe, test, expect } from "bun:test"
import { blockSignal, looksBlocked } from "../../../src/tool/inject-probe/detect"
import type { SendOk } from "../../../src/tool/inject-probe/types"

describe("looksBlocked", () => {
  test("403 Forbidden is blocked", () => {
    expect(looksBlocked(403)).toBe(true)
  })

  test("406 Not Acceptable is blocked", () => {
    expect(looksBlocked(406)).toBe(true)
  })

  test("429 Too Many Requests is blocked", () => {
    expect(looksBlocked(429)).toBe(true)
  })

  test("503 Service Unavailable is blocked", () => {
    expect(looksBlocked(503)).toBe(true)
  })

  test("200 OK is not blocked", () => {
    expect(looksBlocked(200)).toBe(false)
  })

  test("404 Not Found is not blocked", () => {
    expect(looksBlocked(404)).toBe(false)
  })

  test("500 Internal Server Error is not blocked", () => {
    expect(looksBlocked(500)).toBe(false)
  })

  test("302 Redirect is not blocked", () => {
    expect(looksBlocked(302)).toBe(false)
  })
})

describe("blockSignal", () => {
  const ok = (text: string, headers: Record<string, string> = {}, status = 200): SendOk => ({
    status,
    text,
    ms: 100,
    headers,
  })

  test("detects blocked status codes immediately", () => {
    expect(blockSignal(ok("normal page", {}, 403))).toBe("HTTP 403")
    expect(blockSignal(ok("normal page", {}, 429))).toBe("HTTP 429")
  })

  test("returns undefined for clean 200 response", () => {
    expect(blockSignal(ok("<html><body>Hello</body></html>"))).toBeUndefined()
  })

  test("detects Cloudflare challenge page by cf-ray header + body", () => {
    expect(blockSignal(ok("Just a moment... Checking your browser", { "cf-ray": "abc123" }))).toBe(
      "WAF challenge (cdn header)",
    )
  })

  test("detects Cloudflare by server header + body", () => {
    expect(blockSignal(ok("Attention Required! | Cloudflare", { server: "cloudflare" }))).toBe(
      "WAF challenge (cloudflare)",
    )
  })

  test("detects Sucuri WAF by x-sucuri-id header + body", () => {
    expect(blockSignal(ok("Access Denied - Sucuri Website Firewall", { "x-sucuri-id": "12345" }))).toBe(
      "WAF challenge (cdn header)",
    )
  })

  test("detects Akamai by server header + body", () => {
    expect(blockSignal(ok("Access Denied by Akamai security", { server: "AkamaiGHost" }))).toBe(
      "WAF challenge (AkamaiGHost)",
    )
  })

  test("detects ModSecurity by body content alone", () => {
    expect(blockSignal(ok("ModSecurity: Request blocked due to rule match"))).toBe("WAF/challenge page")
  })

  test("detects captcha challenge page", () => {
    expect(blockSignal(ok("Please complete the captcha to continue"))).toBe("WAF/challenge page")
  })

  test("detects DDoS protection page", () => {
    expect(blockSignal(ok("DDoS protection by SomeProvider"))).toBe("WAF/challenge page")
  })

  test("does not flag CDN header alone without WAF body", () => {
    expect(blockSignal(ok("<html>Normal page content</html>", { "cf-ray": "abc123" }))).toBeUndefined()
  })

  test("does not flag server header alone without WAF body", () => {
    expect(blockSignal(ok("<html>Normal API response</html>", { server: "cloudflare" }))).toBeUndefined()
  })

  test("only checks first 2000 chars of body for WAF signatures (no header)", () => {
    const padding = "x".repeat(2100)
    expect(blockSignal(ok(padding + "cloudflare challenge"))).toBeUndefined()
  })

  test("checks first 4000 chars when CDN header is present", () => {
    const padding = "x".repeat(3500)
    expect(blockSignal(ok(padding + "Access Denied", { "cf-ray": "abc" }))).toBe("WAF challenge (cdn header)")
  })
})
