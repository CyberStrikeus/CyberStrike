import { describe, expect, test } from "bun:test"
import { mine } from "../src/jsmine"

describe("jsmine — JS-body miner (text → Extract)", () => {
  // --- endpoints: forms ---
  test("absolute API URL", () => {
    expect(mine('fetch("https://api.example.com/v1/users")').endpoints).toContain("https://api.example.com/v1/users")
  })
  test("root-relative paths", () => {
    const e = mine('const u="/api/orders/list"; axios.post("/v2/checkout", b)')
    expect(e.endpoints).toContain("/api/orders/list")
    expect(e.endpoints).toContain("/v2/checkout")
  })
  test("template literal with interpolation → wildcard route", () => {
    expect(mine("fetch(`/api/orders/${id}/items`)").endpoints).toContain("/api/orders/*/items")
  })
  test("slash-less REST path (api/v1/users)", () => {
    expect(mine('$.get("api/v1/users")').endpoints).toContain("api/v1/users")
  })
  test("XHR open path", () => {
    expect(mine('xhr.open("GET","/graphql")').endpoints).toContain("/graphql")
  })
  test("relative ../ path", () => {
    expect(mine('load("../admin/settings")').endpoints).toContain("../admin/settings")
  })
  test("bare server-side files", () => {
    const e = mine('a="login.php"; b="config.json"; c="handler.aspx"')
    expect(e.endpoints).toEqual(expect.arrayContaining(["login.php", "config.json", "handler.aspx"]))
  })
  test("routey short path kept, shallow noise dropped", () => {
    const e = mine('a="/api/x"; b="/x"; c="/graphql"')
    expect(e.endpoints).toContain("/api/x")
    expect(e.endpoints).toContain("/graphql")
    expect(e.endpoints).not.toContain("/x")
  })

  // --- endpoints: precision ---
  test("assets, mime types, versions, classes, prose are NOT endpoints", () => {
    const noise = [
      '"/assets/style.css"', '"/img/logo.png"', '"/fonts/x.woff2"',
      '"text/html"', '"application/json"', '"1.2.3"',
      '"col-md-6 d-flex justify-content-between"', '"hello world"',
      '"just-a-label"',
    ].join(";")
    expect(mine(noise).endpoints).toHaveLength(0)
  })

  // --- jsUrls ---
  test("chunk .js and .mjs → jsUrls, not endpoints", () => {
    const e = mine('e("/static/chunks/438.a1b2c3d4.js"); import("./lazy.mjs")')
    expect(e.jsUrls).toContain("/static/chunks/438.a1b2c3d4.js")
    expect(e.jsUrls).toContain("./lazy.mjs")
    expect(e.endpoints).toHaveLength(0)
  })
  test("sourceMappingURL captured, data: map ignored", () => {
    expect(mine("//# sourceMappingURL=main.9f8a.js.map").jsUrls).toContain("main.9f8a.js.map")
    expect(mine("//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozfQ==").jsUrls).toHaveLength(0)
  })

  // --- secrets: vendor ---
  test("vendor secret shapes", () => {
    expect(mine('k="AKIAIOSFODNN7EXAMPLE"').secrets).toContain("AKIAIOSFODNN7EXAMPLE")
    const g = "AIza" + "B".repeat(35)
    expect(mine(`g="${g}"`).secrets).toContain(g)
    const stripe = "sk_live_" + "a".repeat(24)
    expect(mine(`s("${stripe}")`).secrets).toContain(stripe)
    const gh = "ghp_" + "A".repeat(36)
    expect(mine(`t="${gh}"`).secrets).toContain(gh)
    expect(mine("-----BEGIN RSA PRIVATE KEY-----").secrets.some((s) => s.includes("PRIVATE KEY"))).toBe(true)
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4"
    expect(mine(`a="${jwt}"`).secrets).toContain(jwt)
  })
  test("named assignment flagged; placeholder not", () => {
    expect(mine('apiKey:"d41d8cd98f00b204e9800998"').secrets.some((s) => s.includes("d41d8cd98f00b204e9800998"))).toBe(true)
    expect(mine('apiKey:"your_api_key_here", secret:"xxxxxxxx", token:"${ENV}"').secrets).toHaveLength(0)
  })

  // --- secrets: entropy ---
  test("high-entropy base64 token flagged even without a key name", () => {
    const tok = "kThP9xQ2mV7nR4wZ8bL1cY6dF3gJ5aX"
    expect(mine(`x("${tok}")`).secrets).toContain(tok)
  })
  test("entropy precision: SRI, UUID, data-URI, hostnames, prose NOT flagged", () => {
    const noise = [
      '"sha384-oqVuAfXRKap7fdgcVY5uykM6RxhSz1yPjYBc8t9xrIXbLQ2wZ3aP4mK"',
      '"550e8400-e29b-41d4-a716-446655440000"',
      '"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUA"',
      '"cdn.jsdelivr.net"', '"the quick brown fox jumps over"',
      '"1234567890"', '"abcdefghijklmnop"',
    ].join(";")
    expect(mine(noise).secrets).toHaveLength(0)
  })

  // --- resolution / scope ---
  test("resolves relative refs against baseUrl", () => {
    expect(mine('fetch("/api/me")', { baseUrl: "https://app.test/js/app.js" }).endpoints).toContain("https://app.test/api/me")
  })
  test("sameHostOnly drops off-host absolute URLs", () => {
    const e = mine('a="https://app.test/api/x"; b="https://evil.com/api/y"', { baseUrl: "https://app.test/", sameHostOnly: true })
    expect(e.endpoints).toContain("https://app.test/api/x")
    expect(e.endpoints).not.toContain("https://evil.com/api/y")
  })
  test("entropy can be disabled", () => {
    const tok = "kThP9xQ2mV7nR4wZ8bL1cY6dF3gJ5aX"
    expect(mine(`x("${tok}")`, { entropy: false }).secrets).toHaveLength(0)
  })

  // --- realistic minified bundle: recall AND precision together ---
  test("realistic minified bundle — finds real signals, ignores the noise", () => {
    const bundle = [
      '!function(e){var t={};function n(r){return fetch("/api/v1/session").then(function(){return r})}',
      'var a=`/api/users/${e.id}/profile`,',
      'i="api/v2/orders",o="/graphql",',
      's=n.p+"static/js/438.7f8a9c.chunk.js";',
      'e.login=function(){return axios.post("/auth/login",{})};',
      'e.cfg={apiKey:"kThP9xQ2mV7nR4wZ8bL1cY6dF3gJ5aX",stripe:"pk_live_' + "z".repeat(24) + '"};',
      'e.icon="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cCI+PC9zdmc+";',
      'e.klass="btn btn-primary d-flex";e.mime="application/json";e.ver="4.17.21";',
      't.integrity="sha384-oqVuAfXRKap7fdgcVY5uykM6RxhSz1yPjYBc8t9xrIXbLQ2wZ3aP4mK";',
      '}();//# sourceMappingURL=main.7f8a9c.js.map',
    ].join("")
    const e = mine(bundle, { baseUrl: "https://app.test/js/main.js" })

    expect(e.endpoints).toEqual(expect.arrayContaining([
      "https://app.test/api/v1/session",
      "https://app.test/api/users/*/profile",
      "https://app.test/js/api/v2/orders", // slash-less path resolves against the JS file's dir
      "https://app.test/graphql",
      "https://app.test/auth/login",
    ]))
    expect(e.jsUrls).toEqual(expect.arrayContaining([
      "https://app.test/js/static/js/438.7f8a9c.chunk.js",
      "https://app.test/js/main.7f8a9c.js.map",
    ]))
    expect(e.secrets.some((s) => s.includes("kThP9xQ2mV7nR4wZ8bL1cY6dF3gJ5aX"))).toBe(true)
    expect(e.secrets.some((s) => s.startsWith("pk_live_"))).toBe(true)
    const all = [...e.endpoints, ...e.jsUrls, ...e.secrets].join("|")
    expect(all).not.toContain("data:image")
    expect(all).not.toContain("sha384-")
    expect(all).not.toContain("btn")
    expect(all).not.toContain("application/json")
    expect(all).not.toContain("4.17.21")
  })

  // --- structural ---
  test("tech is always empty (rule engine owns tech detection)", () => {
    expect(mine('fetch("/api/x"); jQuery(".x")').tech).toHaveLength(0)
  })
  test("plain JS with no signals yields empty extract", () => {
    const e = mine("function add(a,b){return a+b}const n=42;")
    expect(e.endpoints).toHaveLength(0)
    expect(e.jsUrls).toHaveLength(0)
    expect(e.secrets).toHaveLength(0)
  })
})
