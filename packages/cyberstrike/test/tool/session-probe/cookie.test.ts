import { describe, test, expect } from "bun:test"
import {
  shannonBits,
  isSessionCookie,
  classifyCookieEntropy,
  decodedStructure,
  parseCookieHeader,
  splitSetCookies,
  parseSetCookie,
  analyzeCookieAttributes,
} from "../../../src/tool/session-probe/cookie"

describe("session-probe/cookie", () => {
  test("parseCookieHeader splits name/value pairs", () => {
    expect(parseCookieHeader("a=1; b=2; c=")).toEqual([
      { name: "a", value: "1" },
      { name: "b", value: "2" },
      { name: "c", value: "" },
    ])
  })

  test("shannonBits rewards length + alphabet diversity", () => {
    expect(shannonBits("")).toBe(0)
    expect(shannonBits("aaaaaaaa")).toBe(0) // one symbol → zero bits
    // A long mixed-alphabet value carries far more bits than a short one.
    expect(shannonBits("aB3kZ9qLmX2pQ7rT")).toBeGreaterThan(shannonBits("aB3k"))
  })

  test("isSessionCookie matches session names, excludes CSRF", () => {
    expect(isSessionCookie("JSESSIONID")).toBe(true)
    expect(isSessionCookie("connect.sid")).toBe(true)
    expect(isSessionCookie("myapp_session")).toBe(true)
    expect(isSessionCookie("XSRF-TOKEN")).toBe(false)
    expect(isSessionCookie("csrf_token")).toBe(false)
    expect(isSessionCookie("theme")).toBe(false)
  })

  test("decodedStructure catches numeric + base64-wrapped ids", () => {
    expect(decodedStructure("1024")).toMatch(/numeric/)
    expect(decodedStructure(Buffer.from("1234").toString("base64"))).toMatch(/numeric/) // "MTIzNA=="
    expect(decodedStructure(Buffer.from("alice").toString("base64"))).toMatch(/printable/) // "YWxpY2U="
    expect(decodedStructure("aB3kZ9qLmX2pQ7rT4wYcUv8n")).toBeUndefined() // opaque random
  })

  test("classifyCookieEntropy: weak / structured / ok", () => {
    expect(classifyCookieEntropy("sid", "42").verdict).toBe("structured") // plain numeric
    expect(classifyCookieEntropy("sid", Buffer.from("1001").toString("base64")).verdict).toBe("structured")
    expect(classifyCookieEntropy("sid", "abcd1234").verdict).toBe("weak") // short, low bits
    // A long high-entropy opaque token passes.
    const strong = "F3xQ9kL2mZ7pR4tW8cY1nV6bJ0sH5dA3gK9uT2eN7rM4wX6"
    expect(classifyCookieEntropy("sid", strong).verdict).toBe("ok")
  })

  test("splitSetCookies keeps Expires commas intact", () => {
    const raw = "sid=abc; Path=/; Expires=Wed, 09 Jun 2021 10:18:14 GMT, theme=dark; Path=/"
    expect(splitSetCookies(raw)).toEqual(["sid=abc; Path=/; Expires=Wed, 09 Jun 2021 10:18:14 GMT", "theme=dark; Path=/"])
  })

  test("parseSetCookie extracts name/value + attributes", () => {
    const c = parseSetCookie("SESSIONID=xyz; Secure; HttpOnly; SameSite=Lax; Domain=.site.com; Path=/")
    expect(c.name).toBe("SESSIONID")
    expect(c.value).toBe("xyz")
    expect(c.secure).toBe(true)
    expect(c.httpOnly).toBe(true)
    expect(c.sameSite).toBe("Lax")
    expect(c.domain).toBe(".site.com")
  })

  test("analyzeCookieAttributes flags missing flags, broad domain, SameSite=None-insecure", () => {
    const bad = parseSetCookie("sid=abc; Domain=.site.com; SameSite=None")
    const kinds = analyzeCookieAttributes("https", bad).map((f) => f.kind)
    expect(kinds).toContain("cookie-missing-httponly")
    expect(kinds).toContain("cookie-missing-secure")
    expect(kinds).toContain("cookie-samesite-none-insecure")
    expect(kinds).toContain("cookie-domain-too-broad")

    const good = parseSetCookie("sid=abc; Secure; HttpOnly; SameSite=Lax; Path=/")
    expect(analyzeCookieAttributes("https", good)).toHaveLength(0)
  })

  test("analyzeCookieAttributes enforces cookie-prefix contracts", () => {
    // __Host- with a Domain (and no Path=/) violates the prefix.
    const host = parseSetCookie("__Host-sid=abc; Secure; HttpOnly; Domain=site.com")
    expect(analyzeCookieAttributes("https", host).map((f) => f.kind)).toContain("cookie-host-prefix-violated")
    // __Secure- without Secure violates the prefix.
    const sec = parseSetCookie("__Secure-sid=abc; HttpOnly; SameSite=Lax; Path=/")
    expect(analyzeCookieAttributes("https", sec).map((f) => f.kind)).toContain("cookie-secure-prefix-violated")
  })
})
