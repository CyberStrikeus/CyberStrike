import { describe, test, expect } from "bun:test"
import { HttpMessage } from "../../src/replay/message"
import { Mutate } from "../../src/replay/mutate"

const CRLF = "\r\n"

function req(raw: string): HttpMessage.Request {
  return HttpMessage.parse(raw)
}
const GET = (target: string) => req([`${target}`, `Host: x`, ``, ``].join(CRLF))

describe("Mutate — immutability", () => {
  test("does not mutate the base request", () => {
    const base = GET("GET /a?id=1 HTTP/1.1")
    const before = HttpMessage.toString(base)
    Mutate.setQuery(base, "id", "999")
    Mutate.addHeader(base, "X-Test", "1")
    Mutate.setBody(base, "hello")
    expect(HttpMessage.toString(base)).toBe(before)
  })
})

describe("Mutate — query", () => {
  test("splits and rejoins a target losslessly", () => {
    const { path, query } = Mutate.splitTarget("/p?a=1&b=&c")
    expect(path).toBe("/p")
    expect(query).toEqual([
      { key: "a", value: "1", hasEquals: true },
      { key: "b", value: "", hasEquals: true },
      { key: "c", value: "", hasEquals: false },
    ])
    expect(Mutate.joinTarget(path, query)).toBe("/p?a=1&b=&c")
  })

  test("setQuery replaces value and forces an equals sign", () => {
    const r = Mutate.setQuery(GET("GET /p?id=1&x=2 HTTP/1.1"), "id", "' OR 1=1")
    expect(r.target).toBe("/p?id=' OR 1=1&x=2")
  })

  test("addQuery enables parameter pollution", () => {
    const r = Mutate.addQuery(GET("GET /p?id=1 HTTP/1.1"), "id", "2")
    expect(r.target).toBe("/p?id=1&id=2")
  })

  test("removeQuery drops all matching params", () => {
    const r = Mutate.removeQuery(GET("GET /p?id=1&id=2&x=3 HTTP/1.1"), "id")
    expect(r.target).toBe("/p?x=3")
  })

  test("setQuery on a targetless query is a no-op (key absent)", () => {
    const r = Mutate.setQuery(GET("GET /p HTTP/1.1"), "id", "1")
    expect(r.target).toBe("/p")
  })

  test("does not URL-encode raw values (caller owns encoding)", () => {
    const r = Mutate.setQuery(GET("GET /p?q=x HTTP/1.1"), "q", "a b&c")
    // The raw value lands verbatim — encoding is a separate, explicit step.
    expect(r.target).toBe("/p?q=a b&c")
  })
})

describe("Mutate — headers", () => {
  const base = req([`GET / HTTP/1.1`, `Host: x`, `X-Dup: a`, `X-Dup: b`, ``, ``].join(CRLF))

  test("setHeader replaces all matching (case-insensitive), preserves existing name case", () => {
    const r = Mutate.setHeader(base, "x-dup", "z")
    expect(r.headers).toEqual([
      { name: "Host", value: "x" },
      { name: "X-Dup", value: "z" },
      { name: "X-Dup", value: "z" },
    ])
  })

  test("setHeader appends when absent", () => {
    const r = Mutate.setHeader(base, "Authorization", "Bearer t")
    expect(r.headers[r.headers.length - 1]).toEqual({ name: "Authorization", value: "Bearer t" })
  })

  test("addHeader always appends a duplicate", () => {
    const r = Mutate.addHeader(base, "Host", "evil.com")
    expect(r.headers.filter((h) => h.name.toLowerCase() === "host")).toHaveLength(2)
  })

  test("removeHeader drops all matching", () => {
    const r = Mutate.removeHeader(base, "X-DUP")
    expect(r.headers.some((h) => h.name.toLowerCase() === "x-dup")).toBe(false)
  })
})

describe("Mutate — body / request line", () => {
  test("setBody replaces bytes without recomputing Content-Length", () => {
    const r = Mutate.setBody(req([`POST / HTTP/1.1`, `Content-Length: 0`, ``, ``].join(CRLF)), "abcd")
    expect(new TextDecoder().decode(r.body)).toBe("abcd")
    // Content-Length intentionally left stale — deliberate mismatch stays possible.
    expect(r.headers.find((h) => h.name.toLowerCase() === "content-length")?.value).toBe("0")
  })

  test("setMethod / setTarget / setVersion", () => {
    let r = GET("GET /a HTTP/1.1")
    r = Mutate.setMethod(r, "POST")
    r = Mutate.setTarget(r, "/b")
    r = Mutate.setVersion(r, "HTTP/2")
    expect(`${r.method} ${r.target} ${r.version}`).toBe("POST /b HTTP/2")
  })
})
