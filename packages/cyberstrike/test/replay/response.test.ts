import { describe, test, expect } from "bun:test"
import { ReplayResponse } from "../../src/replay/response"

const CRLF = "\r\n"
const bytes = (s: string) => new TextEncoder().encode(s)

describe("ReplayResponse.parse", () => {
  test("parses status line, headers, and body", () => {
    const raw = [`HTTP/1.1 200 OK`, `Content-Type: application/json`, `X-A: 1`, ``, `{"ok":true}`].join(CRLF)
    const r = ReplayResponse.parse(bytes(raw))
    expect(r.version).toBe("HTTP/1.1")
    expect(r.status).toBe(200)
    expect(r.reason).toBe("OK")
    expect(r.headers).toEqual([
      { name: "Content-Type", value: "application/json" },
      { name: "X-A", value: "1" },
    ])
    expect(new TextDecoder().decode(r.body)).toBe(`{"ok":true}`)
  })

  test("handles a multi-word reason phrase", () => {
    const r = ReplayResponse.parse(bytes([`HTTP/1.1 404 Not Found`, ``, ``].join(CRLF)))
    expect(r.status).toBe(404)
    expect(r.reason).toBe("Not Found")
  })

  test("handles an empty reason phrase", () => {
    const r = ReplayResponse.parse(bytes([`HTTP/1.1 204 `, ``, ``].join(CRLF)))
    expect(r.status).toBe(204)
    expect(r.reason).toBe("")
  })

  test("preserves duplicate headers (e.g. Set-Cookie)", () => {
    const raw = [`HTTP/1.1 200 OK`, `Set-Cookie: a=1`, `Set-Cookie: b=2`, ``, ``].join(CRLF)
    const r = ReplayResponse.parse(bytes(raw))
    expect(r.headers.filter((h) => h.name === "Set-Cookie")).toHaveLength(2)
  })

  test("keeps body bytes verbatim (binary-safe)", () => {
    const head = bytes([`HTTP/1.1 200 OK`, `Content-Length: 3`, ``, ``].join(CRLF))
    const bin = new Uint8Array([0xff, 0x00, 0xfe])
    const full = new Uint8Array(head.length + bin.length)
    full.set(head, 0)
    full.set(bin, head.length)
    const r = ReplayResponse.parse(full)
    expect(Array.from(r.body)).toEqual([0xff, 0x00, 0xfe])
  })

  test("throws on empty / malformed status line", () => {
    expect(() => ReplayResponse.parse(bytes(""))).toThrow()
    expect(() => ReplayResponse.parse(bytes(`HTTP/1.1 abc OK\r\n\r\n`))).toThrow()
  })
})

describe("ReplayResponse helpers", () => {
  const r = ReplayResponse.parse(bytes([`HTTP/1.1 503 x`, `Retry-After: 5`, ``, ``].join(CRLF)))

  test("header() is case-insensitive", () => {
    expect(ReplayResponse.header(r, "retry-after")).toBe("5")
    expect(ReplayResponse.header(r, "RETRY-AFTER")).toBe("5")
    expect(ReplayResponse.header(r, "missing")).toBeUndefined()
  })

  test("hasRetryAfter detects the header", () => {
    expect(ReplayResponse.hasRetryAfter(r)).toBe(true)
    const noRa = ReplayResponse.parse(bytes([`HTTP/1.1 200 OK`, ``, ``].join(CRLF)))
    expect(ReplayResponse.hasRetryAfter(noRa)).toBe(false)
  })
})
