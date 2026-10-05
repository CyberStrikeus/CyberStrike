import { describe, expect, test } from "bun:test"
import type { Transaction } from "../src/index"
import { parseSetCookie, responseCookies, requestCookies, query, weakCookieFlags } from "../src/index"

function tx(reqCookie?: string, setCookies: string[] = []): Transaction {
  return {
    id: "t",
    source: "browser",
    host: "app.test",
    request: { method: "GET", url: "https://app.test/x", headers: reqCookie ? [{ name: "cookie", value: reqCookie }] : [] },
    response: { status: 200, headers: setCookies.map((v) => ({ name: "set-cookie", value: v })) },
  }
}

describe("parseSetCookie", () => {
  test("parses name/value and all attributes", () => {
    const c = parseSetCookie("sid=abc123; Path=/; Domain=app.test; HttpOnly; Secure; SameSite=Lax; Max-Age=3600")
    expect(c.name).toBe("sid")
    expect(c.value).toBe("abc123")
    expect(c.path).toBe("/")
    expect(c.domain).toBe("app.test")
    expect(c.httpOnly).toBe(true)
    expect(c.secure).toBe(true)
    expect(c.sameSite).toBe("Lax")
    expect(c.maxAge).toBe(3600)
  })
  test("flags absent when only name=value", () => {
    const c = parseSetCookie("token=xyz")
    expect(c.httpOnly).toBe(false)
    expect(c.secure).toBe(false)
    expect(c.sameSite).toBeUndefined()
  })
})

describe("requestCookies", () => {
  test("parses the Cookie header into a map", () => {
    expect(requestCookies(tx("a=1; b=2; __Host-x=deadbeef"))).toEqual({ a: "1", b: "2", "__Host-x": "deadbeef" })
  })
  test("empty when no Cookie header", () => {
    expect(requestCookies(tx())).toEqual({})
  })
})

describe("responseCookies", () => {
  test("one per Set-Cookie header", () => {
    const cs = responseCookies(tx(undefined, ["a=1; HttpOnly", "b=2; Secure; SameSite=Strict"]))
    expect(cs.map((c) => c.name)).toEqual(["a", "b"])
    expect(cs[1].sameSite).toBe("Strict")
  })
})

describe("weak-cookie-flags uses the parsed model", () => {
  test("clean cookie yields no signal, hardened value with 'secure' in it is not a false match", () => {
    expect(weakCookieFlags.evaluate([tx(undefined, ["sid=abc; HttpOnly; Secure; SameSite=Lax"])])).toHaveLength(0)
    expect(weakCookieFlags.evaluate([tx(undefined, ["t=secure_value; HttpOnly; Secure; SameSite=Strict"])])).toHaveLength(0)
  })
  test("bare cookie flags all three", () => {
    const s = weakCookieFlags.evaluate([tx(undefined, ["sid=abc"])])
    expect(s).toHaveLength(1)
    expect(s[0].evidence).toContain("HttpOnly")
  })
})

describe("HTTPQL cookie fields", () => {
  const corpus = [tx("session=s1; theme=dark", ["auth=t1; HttpOnly"])]
  test("req.cookie.<name> and resp.cookie.<name>", () => {
    expect(query(corpus, 'req.cookie.session == "s1"')).toHaveLength(1)
    expect(query(corpus, 'req.cookie.theme == "dark"')).toHaveLength(1)
    expect(query(corpus, 'resp.cookie.auth == "t1"')).toHaveLength(1)
    expect(query(corpus, 'req.cookie.session == "nope"')).toHaveLength(0)
  })
})
