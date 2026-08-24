import { describe, test, expect } from "bun:test"
import { HttpMessage } from "../../src/replay/message"

const CRLF = "\r\n"

describe("HttpMessage.parse", () => {
  test("parses a GET request line without normalizing the target", () => {
    const raw = [`GET /a/../%2e%2e//b?x=1&x=2&y= HTTP/1.1`, `Host: example.com`, ``, ``].join(CRLF)
    const req = HttpMessage.parse(raw)
    expect(req.method).toBe("GET")
    // Path traversal / encoded dots / double slash survive verbatim.
    expect(req.target).toBe("/a/../%2e%2e//b?x=1&x=2&y=")
    expect(req.version).toBe("HTTP/1.1")
  })

  test("preserves header case, order, and duplicates", () => {
    const raw = [`GET / HTTP/1.1`, `Host: example.com`, `content-length: 0`, `X-Dup: a`, `X-Dup: b`, ``, ``].join(CRLF)
    const req = HttpMessage.parse(raw)
    expect(req.headers).toEqual([
      { name: "Host", value: "example.com" },
      { name: "content-length", value: "0" }, // lowercase preserved
      { name: "X-Dup", value: "a" },
      { name: "X-Dup", value: "b" }, // duplicate kept
    ])
  })

  test("captures the body bytes verbatim", () => {
    const body = `{"q": "' OR '1'='1"}`
    const raw = [`POST /login HTTP/1.1`, `Host: x`, `Content-Type: application/json`, ``, body].join(CRLF)
    const req = HttpMessage.parse(raw)
    expect(new TextDecoder().decode(req.body)).toBe(body)
  })

  test("tolerates bare LF line endings", () => {
    const raw = `GET / HTTP/1.1\nHost: x\n\n`
    const req = HttpMessage.parse(raw)
    expect(req.method).toBe("GET")
    expect(req.headers).toEqual([{ name: "Host", value: "x" }])
  })

  test("keeps a colon-less header line instead of dropping it", () => {
    const raw = [`GET / HTTP/1.1`, `MalformedLine`, ``, ``].join(CRLF)
    const req = HttpMessage.parse(raw)
    expect(req.headers).toEqual([{ name: "MalformedLine", value: "" }])
  })

  test("throws on an empty request line", () => {
    expect(() => HttpMessage.parse("")).toThrow()
    expect(() => HttpMessage.parse("\r\n\r\n")).toThrow()
  })
})

describe("HttpMessage.serialize", () => {
  test("produces canonical CRLF output", () => {
    const req: HttpMessage.Request = {
      method: "GET",
      target: "/",
      version: "HTTP/1.1",
      headers: [{ name: "Host", value: "x" }],
      body: new Uint8Array(0),
    }
    expect(HttpMessage.toString(req)).toBe(`GET / HTTP/1.1\r\nHost: x\r\n\r\n`)
  })
})

describe("HttpMessage round-trip", () => {
  test("GET with tricky target and duplicate/case headers is stable", () => {
    const raw = [
      `GET /a/../%2e%2e//b?x=1&x=2&y= HTTP/1.1`,
      `Host: example.com`,
      `content-length: 0`,
      `X-Dup: a`,
      `X-Dup: b`,
      ``,
      ``,
    ].join(CRLF)
    const once = HttpMessage.toString(HttpMessage.parse(raw))
    const twice = HttpMessage.toString(HttpMessage.parse(once))
    expect(once).toBe(raw)
    expect(twice).toBe(once) // idempotent
  })

  test("POST with JSON body round-trips exactly (payload bytes intact)", () => {
    const body = `{"q":"'\`$(id)\` OR 1=1--","n":42}`
    const raw = [`POST /api HTTP/1.1`, `Host: x`, `Content-Type: application/json`, ``, body].join(CRLF)
    const once = HttpMessage.toString(HttpMessage.parse(raw))
    expect(once).toBe(raw)
    // The shell-hostile payload survives untouched — the whole point of the engine.
    const req = HttpMessage.parse(raw)
    expect(new TextDecoder().decode(req.body)).toBe(body)
  })

  test("round-trips non-UTF-8 body bytes without corruption", () => {
    const bin = new Uint8Array([0xff, 0x00, 0xfe, 0x80, 0x0a, 0x41])
    const head = HttpMessage.serialize({
      method: "POST",
      target: "/upload",
      version: "HTTP/1.1",
      headers: [{ name: "Host", value: "x" }],
      body: bin,
    })
    const req = HttpMessage.parse(head)
    expect(Array.from(req.body)).toEqual(Array.from(bin))
  })
})
