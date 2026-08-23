import { describe, test, expect } from "bun:test"
import { Apply } from "../../src/replay/apply"
import { HttpMessage } from "../../src/replay/message"

const CRLF = "\r\n"
const base = () =>
  HttpMessage.parse([`GET /p?id=1 HTTP/1.1`, `Host: x`, `Cookie: s=1`, ``, ``].join(CRLF))

describe("Apply.mutations", () => {
  test("set-query replaces a param value", () => {
    const out = Apply.mutations(base(), [{ op: "set-query", name: "id", value: "2" }])
    expect(out.target).toBe("/p?id=2")
  })

  test("add-query enables parameter pollution", () => {
    const out = Apply.mutations(base(), [{ op: "add-query", name: "id", value: "9" }])
    expect(out.target).toBe("/p?id=1&id=9")
  })

  test("encode pipeline is applied to the value before setting", () => {
    const out = Apply.mutations(base(), [{ op: "set-query", name: "id", value: "' or 1=1", encode: ["url"] }])
    expect(out.target).toBe("/p?id=" + encodeURIComponent("' or 1=1"))
  })

  test("double-encode via pipeline", () => {
    const out = Apply.mutations(base(), [{ op: "set-query", name: "id", value: " ", encode: ["url", "url"] }])
    expect(out.target).toBe("/p?id=%2520")
  })

  test("set-header / add-header / remove-header", () => {
    let out = Apply.mutations(base(), [{ op: "set-header", name: "Cookie", value: "s=evil" }])
    expect(out.headers.find((h) => h.name === "Cookie")?.value).toBe("s=evil")
    out = Apply.mutations(base(), [{ op: "add-header", name: "X-Fwd", value: "127.0.0.1" }])
    expect(out.headers.filter((h) => h.name === "X-Fwd")).toHaveLength(1)
    out = Apply.mutations(base(), [{ op: "remove-header", name: "cookie" }])
    expect(out.headers.some((h) => h.name.toLowerCase() === "cookie")).toBe(false)
  })

  test("set-body / set-method / set-target", () => {
    let out = Apply.mutations(base(), [{ op: "set-method", value: "POST" }])
    expect(out.method).toBe("POST")
    out = Apply.mutations(base(), [{ op: "set-body", value: `{"a":1}` }])
    expect(new TextDecoder().decode(out.body)).toBe(`{"a":1}`)
    out = Apply.mutations(base(), [{ op: "set-target", value: "/other?x=9" }])
    expect(out.target).toBe("/other?x=9")
  })

  test("chained mutations apply in order", () => {
    const out = Apply.mutations(base(), [
      { op: "set-method", value: "POST" },
      { op: "set-body", value: "q=1" },
      { op: "set-header", name: "Content-Type", value: "application/x-www-form-urlencoded" },
    ])
    expect(out.method).toBe("POST")
    expect(new TextDecoder().decode(out.body)).toBe("q=1")
    expect(out.headers.find((h) => h.name === "Content-Type")?.value).toBe("application/x-www-form-urlencoded")
  })

  test("a named op without a name throws", () => {
    expect(() => Apply.mutations(base(), [{ op: "set-query", value: "x" }])).toThrow()
  })
})

describe("Apply.toCurl", () => {
  test("builds a single-quoted curl with headers and body", () => {
    const req = HttpMessage.parse(
      [`POST /login HTTP/1.1`, `Host: x`, `Content-Type: application/json`, ``, `{"u":"a"}`].join(CRLF),
    )
    const curl = Apply.toCurl(req, "https://app.example.com")
    expect(curl).toContain(`-X 'POST'`)
    expect(curl).toContain(`'https://app.example.com/login'`)
    expect(curl).toContain(`-H 'Content-Type: application/json'`)
    expect(curl).toContain(`--data-raw '{"u":"a"}'`)
  })

  test("escapes embedded single quotes and omits Content-Length", () => {
    const req = HttpMessage.parse(
      [`POST /p HTTP/1.1`, `Host: x`, `Content-Length: 5`, ``, `a'b`].join(CRLF),
    )
    const curl = Apply.toCurl(req, "http://x")
    expect(curl).not.toContain("Content-Length")
    expect(curl).toContain(`'\\''`) // the ' in a'b is shell-escaped
  })
})
