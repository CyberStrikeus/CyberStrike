import { beforeEach, describe, expect, test } from "bun:test"
import { WebScope } from "../../../src/session/web/scope"

beforeEach(() => WebScope._reset())

describe("WebScope.registrable", () => {
  test("derives the registrable domain (incl. two-part TLDs)", () => {
    expect(WebScope.registrable("demo.example.com")).toBe("example.com")
    expect(WebScope.registrable("github.com")).toBe("github.com")
    expect(WebScope.registrable("x.com")).toBe("x.com")
    expect(WebScope.registrable("shop.example.co.uk")).toBe("example.co.uk")
  })
})

describe("WebScope.allowed", () => {
  test("same domain + subdomains in scope; external + non-http out", () => {
    WebScope.ensure("s", "http://demo.example.com/login.jsp")
    expect(WebScope.allowed("s", "http://demo.example.com/account")).toBe(true)
    expect(WebScope.allowed("s", "https://app.example.com/x")).toBe(true) // subdomain, same registrable
    expect(WebScope.allowed("s", "https://github.com/HCL/AltoroJ")).toBe(false) // the real bug
    expect(WebScope.allowed("s", "mailto:a@b.com")).toBe(false)
    expect(WebScope.allowed("s", "javascript:void(0)")).toBe(false)
  })

  test("explicit patterns widen scope; ensure is idempotent (first origin wins)", () => {
    WebScope.ensure("s", "http://a.example.com/", ["*.partner.org"])
    expect(WebScope.allowed("s", "https://x.partner.org/y")).toBe(true)
    expect(WebScope.allowed("s", "https://other.net/")).toBe(false)
    WebScope.ensure("s", "https://github.com/") // ignored — already set
    expect(WebScope.allowed("s", "https://github.com/")).toBe(false)
  })

  test("no scope set → allowed (don't block un-scoped/manual use)", () => {
    expect(WebScope.allowed("fresh", "https://anything.com/")).toBe(true)
  })

  test("label renders the scope as *.domain (+ patterns)", () => {
    WebScope.ensure("s", "http://demo.example.com/")
    expect(WebScope.label("s")).toBe("*.example.com")
    WebScope.ensure("s2", "http://a.example.com/", ["*.partner.org"])
    expect(WebScope.label("s2")).toBe("*.example.com, *.partner.org")
  })
})
