import { describe, test, expect } from "bun:test"
import { send, guardHost, nonce, repeatBaseline } from "../../../src/tool/inject-probe/send"
import type { HttpSender } from "../../../src/tool/inject-probe/send"
import type { ResolvedRequest, SendBudget, InjPoint } from "../../../src/tool/inject-probe/types"

const makeR = (urlStr = "http://example.com/page?x=1"): ResolvedRequest => ({
  method: "GET",
  url: new URL(urlStr),
  headers: {},
  body: "",
  contentType: "",
  auth: { source: "none" },
  provenance: { fromRaw: false, reconstructed: false, bodyMaybeTruncated: false },
})

const okSender = (body = "ok", headers: Record<string, string> = {}): HttpSender => ({
  send: async () => ({ status: 200, body, headers }),
})

const errorSender = (msg: string): HttpSender => ({
  send: async () => ({ error: msg }),
})

describe("nonce", () => {
  test("starts with m and has length 11", () => {
    const n = nonce()
    expect(n[0]).toBe("m")
    expect(n.length).toBe(11)
  })

  test("generates unique values", () => {
    const a = nonce()
    const b = nonce()
    expect(a).not.toBe(b)
  })
})

describe("guardHost", () => {
  test("same host returns ok", () => {
    const r = makeR()
    expect(guardHost(r, new URL("http://example.com/other"))).toEqual({ ok: true })
  })

  test("different host returns error", () => {
    const r = makeR()
    const result = guardHost(r, new URL("http://evil.com/path"))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain("evil.com")
  })
})

describe("send", () => {
  test("returns budget exhausted when sent >= max", async () => {
    const r = makeR()
    const budget: SendBudget = { sent: 5, max: 5 }
    const result = await send(okSender(), r, { url: "http://example.com/page?x=1", body: "", headers: {} }, new AbortController().signal, budget)
    expect(result).toEqual({ error: "send budget exhausted" })
  })

  test("increments budget.sent on each call", async () => {
    const r = makeR()
    const budget: SendBudget = { sent: 0, max: 10 }
    await send(okSender(), r, { url: "http://example.com/page?x=1", body: "" }, new AbortController().signal, budget)
    expect(budget.sent).toBe(1)
    await send(okSender(), r, { url: "http://example.com/page?x=1", body: "" }, new AbortController().signal, budget)
    expect(budget.sent).toBe(2)
  })

  test("rejects out-of-scope host", async () => {
    const r = makeR()
    const result = await send(okSender(), r, { url: "http://evil.com/path", body: "" }, new AbortController().signal)
    expect("error" in result).toBe(true)
    if ("error" in result) expect(result.error).toContain("out-of-scope")
  })

  test("timeout detection on connection timed out", async () => {
    const r = makeR()
    const result = await send(errorSender("connection timed out"), r, { url: "http://example.com/page?x=1", body: "" }, new AbortController().signal)
    expect("error" in result).toBe(true)
    if ("error" in result) expect(result.timeout).toBe(true)
  })

  test("timeout detection on ECONNRESET", async () => {
    const r = makeR()
    const result = await send(errorSender("ECONNRESET"), r, { url: "http://example.com/page?x=1", body: "" }, new AbortController().signal)
    expect("error" in result).toBe(true)
    if ("error" in result) expect(result.timeout).toBe(true)
  })

  test("no timeout flag on DNS failure", async () => {
    const r = makeR()
    const result = await send(errorSender("DNS lookup failed"), r, { url: "http://example.com/page?x=1", body: "" }, new AbortController().signal)
    expect("error" in result).toBe(true)
    if ("error" in result) expect(result.timeout).toBe(false)
  })

  test("successful send returns SendOk with status, text, ms, headers", async () => {
    const r = makeR()
    const sender = okSender("hello world", { server: "nginx", "x-custom": "ignored" })
    const result = await send(sender, r, { url: "http://example.com/page?x=1", body: "" }, new AbortController().signal)
    expect("error" in result).toBe(false)
    if (!("error" in result)) {
      expect(result.status).toBe(200)
      expect(result.text).toBe("hello world")
      expect(typeof result.ms).toBe("number")
      expect(result.headers["server"]).toBe("nginx")
      expect(result.headers["x-custom"]).toBeUndefined()
    }
  })

  test("truncates body to 200k", async () => {
    const r = makeR()
    const longBody = "x".repeat(300_000)
    const sender = okSender(longBody)
    const result = await send(sender, r, { url: "http://example.com/page?x=1", body: "" }, new AbortController().signal)
    if (!("error" in result)) {
      expect(result.text.length).toBe(200_000)
    }
  })
})

describe("repeatBaseline", () => {
  test("returns ok baseline with byte jitter from mock sender", async () => {
    let callCount = 0
    const sender: HttpSender = {
      send: async () => {
        callCount++
        const body = "a".repeat(100 + callCount)
        return { status: 200, body, headers: {} }
      },
    }
    const r = makeR()
    const point: InjPoint = { location: "query", name: "x" }
    const budget: SendBudget = { sent: 0, max: 10 }
    const bl = await repeatBaseline(sender, r, point, new AbortController().signal, budget)
    expect(bl.ok).toBe(true)
    if (bl.ok) {
      expect(bl.status).toBe(200)
      expect(bl.byteJitter).toBe(1)
      expect(bl.marker.startsWith("m")).toBe(true)
    }
  })

  test("returns not-ok on sender error", async () => {
    const r = makeR()
    const point: InjPoint = { location: "query", name: "x" }
    const budget: SendBudget = { sent: 0, max: 10 }
    const bl = await repeatBaseline(errorSender("ETIMEDOUT"), r, point, new AbortController().signal, budget)
    expect(bl.ok).toBe(false)
    if (!bl.ok) {
      expect(bl.timeout).toBe(true)
      expect(bl.error).toContain("ETIMEDOUT")
    }
  })

  test("returns blocked on WAF response", async () => {
    const sender: HttpSender = {
      send: async () => ({ status: 403, body: "Access Denied", headers: {} }),
    }
    const r = makeR()
    const point: InjPoint = { location: "query", name: "x" }
    const budget: SendBudget = { sent: 0, max: 10 }
    const bl = await repeatBaseline(sender, r, point, new AbortController().signal, budget)
    expect(bl.ok).toBe(false)
    if (!bl.ok) expect(bl.block).toBeDefined()
  })
})
