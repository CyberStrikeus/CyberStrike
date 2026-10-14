import { describe, expect, test } from "bun:test"
import { createHash } from "crypto"
import { parseRawRequest, deriveSite } from "../../../src/session/normalize/parser"

function rawHttp(
  method: string,
  target: string,
  host: string,
  headers: Record<string, string> = {},
  body = "",
): string {
  const ct = body ? "\ncontent-type: application/json" : ""
  const extra = Object.entries(headers)
    .map(([k, v]) => `\n${k}: ${v}`)
    .join("")
  return `${method} ${target} HTTP/1.1\nhost: ${host}${ct}${extra}\n\n${body}`
}

describe("parser.parseRawRequest — basic shape", () => {
  test("parses GET with origin form path", () => {
    const p = parseRawRequest({ raw: rawHttp("GET", "/users/1", "api.example.com"), scheme: "https" })
    expect(p.method).toBe("GET")
    expect(p.scheme).toBe("https")
    expect(p.host).toBe("api.example.com")
    expect(p.port).toBe(443)
    expect(p.origin).toBe("https://api.example.com:443")
    expect(p.canonicalPath).toBe("/users/1")
    expect(p.pathSegments).toEqual(["", "users", "1"])
  })

  test("parses POST with body and content-type", () => {
    const p = parseRawRequest({
      raw: rawHttp("POST", "/api/items", "api.example.com", { "content-type": "application/json" }, `{"a":1}`),
      scheme: "https",
    })
    expect(p.method).toBe("POST")
    expect(p.bodyContentType).toBe("application/json")
    expect(p.bodyHash).toBeDefined()
  })

  test("uses default port for http vs https", () => {
    const a = parseRawRequest({ raw: rawHttp("GET", "/", "x.test"), scheme: "http" })
    const b = parseRawRequest({ raw: rawHttp("GET", "/", "x.test"), scheme: "https" })
    expect(a.port).toBe(80)
    expect(b.port).toBe(443)
  })

  test("explicit port in Host header wins over scheme default", () => {
    const p = parseRawRequest({ raw: rawHttp("GET", "/", "localhost:3000"), scheme: "http" })
    expect(p.port).toBe(3000)
    expect(p.origin).toBe("http://localhost:3000")
  })

  test("uppercases method, lowercases host and path", () => {
    const p = parseRawRequest({ raw: rawHttp("get", "/Users/JOHN", "API.Example.COM"), scheme: "https" })
    expect(p.method).toBe("GET")
    expect(p.host).toBe("api.example.com")
    expect(p.canonicalPath).toBe("/users/john")
  })

  test("throws on malformed request line", () => {
    expect(() => parseRawRequest({ raw: "not a real http request", scheme: "https" })).toThrow()
  })
})

describe("parser.parseRawRequest — path canonicalization", () => {
  test("strips trailing slash except root", () => {
    expect(parseRawRequest({ raw: rawHttp("GET", "/users/1/", "x.t"), scheme: "https" }).canonicalPath).toBe("/users/1")
    expect(parseRawRequest({ raw: rawHttp("GET", "/", "x.t"), scheme: "https" }).canonicalPath).toBe("/")
  })

  test("preserves %2F as encoded — does NOT split into new segment", () => {
    const p = parseRawRequest({ raw: rawHttp("GET", "/git/refs%2Fheads%2Fmain", "x.t"), scheme: "https" })
    expect(p.pathSegments).toHaveLength(3)
    expect(p.pathSegments[2]).toBe("refs%2fheads%2fmain")
  })

  test("decodes other percent-encodings (%40, %20)", () => {
    const p = parseRawRequest({ raw: rawHttp("GET", "/users/john%40example.com", "x.t"), scheme: "https" })
    expect(p.canonicalPath).toBe("/users/john@example.com")
    expect(p.pathSegments[2]).toBe("john@example.com")
  })

  test("collapses dot-segments via URL class", () => {
    expect(parseRawRequest({ raw: rawHttp("GET", "/./foo", "x.t"), scheme: "https" }).canonicalPath).toBe("/foo")
    expect(parseRawRequest({ raw: rawHttp("GET", "/foo/../bar", "x.t"), scheme: "https" }).canonicalPath).toBe("/bar")
  })

  test("keeps double-slash-derived empty middle segment", () => {
    const p = parseRawRequest({ raw: rawHttp("GET", "/foo//bar", "x.t"), scheme: "https" })
    expect(p.pathSegments).toEqual(["", "foo", "", "bar"])
  })
})

describe("parser.parseRawRequest — query and body", () => {
  test("query keys sorted; same keys different order produce same hash", () => {
    const a = parseRawRequest({ raw: rawHttp("GET", "/search?b=2&a=1", "x.t"), scheme: "https" })
    const b = parseRawRequest({ raw: rawHttp("GET", "/search?a=1&b=2", "x.t"), scheme: "https" })
    expect(a.queryKeyHash).toBe(b.queryKeyHash)
    expect(a.queryKeyHash).toBeDefined()
  })

  test("empty / missing query yields undefined", () => {
    const noQuery = parseRawRequest({ raw: rawHttp("GET", "/users/1", "x.t"), scheme: "https" })
    expect(noQuery.query).toBeUndefined()
    expect(noQuery.queryKeyHash).toBeUndefined()
  })

  test("JSON body hash is order-insensitive", () => {
    const a = parseRawRequest({
      raw: rawHttp("POST", "/x", "x.t", { "content-type": "application/json" }, `{"a":1,"b":2}`),
      scheme: "https",
    })
    const b = parseRawRequest({
      raw: rawHttp("POST", "/x", "x.t", { "content-type": "application/json" }, `{"b":2,"a":1}`),
      scheme: "https",
    })
    expect(a.bodyHash).toBe(b.bodyHash)
  })

  test("non-JSON body hashes raw text", () => {
    const a = parseRawRequest({
      raw: rawHttp("POST", "/x", "x.t", { "content-type": "text/plain" }, "hello"),
      scheme: "https",
    })
    const b = parseRawRequest({
      raw: rawHttp("POST", "/x", "x.t", { "content-type": "text/plain" }, "world"),
      scheme: "https",
    })
    expect(a.bodyHash).not.toBe(b.bodyHash)
  })
})

describe("parser.parseRawRequest — Next.js Server Actions", () => {
  function serverActionRequest({
    path = "/dashboard",
    action = "action-id-1",
    body = "1:hello",
    routerState = "state-a",
    accept = "text/x-component",
  }: {
    path?: string
    action?: string
    body?: string
    routerState?: string
    accept?: string
  } = {}): string {
    const headers = [
      "host: app.example.com",
      "content-type: text/plain",
      `Next-Action: ${action}`,
      ...(accept ? [`accept: ${accept}`] : []),
      `next-router-state-tree: ${routerState}`,
    ]
    return `POST ${path} HTTP/1.1\n${headers.join("\n")}\n\n${body}`
  }

  test("uses canonical path and action ID while ignoring RSC body and router state", () => {
    const a = parseRawRequest({
      raw: serverActionRequest({ path: "/Dashboard/", body: "1:hello", routerState: "state-a" }),
      scheme: "https",
    })
    const b = parseRawRequest({
      raw: serverActionRequest({ path: "/dashboard", body: "1:goodbye", routerState: "state-b" }),
      scheme: "https",
    })

    expect(a.protocol).toBe("nextjs-action")
    expect(a.operation).toBe("action-id-1")
    expect(a.opKeyHash).toBe(createHash("sha256").update("/dashboard:action-id-1").digest("hex").slice(0, 16))
    expect(a.opKeyHash).toBe(b.opKeyHash)
    expect(a.bodyHash).not.toBe(b.bodyHash)
  })

  test("separates action IDs and canonical paths, and does not require the RSC Accept header", () => {
    const first = parseRawRequest({
      raw: serverActionRequest({ accept: "", path: "/dashboard", action: "action-id-1" }),
      scheme: "https",
    })
    const otherAction = parseRawRequest({
      raw: serverActionRequest({ path: "/dashboard", action: "action-id-2" }),
      scheme: "https",
    })
    const otherPath = parseRawRequest({
      raw: serverActionRequest({ path: "/settings", action: "action-id-1" }),
      scheme: "https",
    })

    expect(first.protocol).toBe("nextjs-action")
    expect(first.opKeyHash).not.toBe(otherAction.opKeyHash)
    expect(first.opKeyHash).not.toBe(otherPath.opKeyHash)
  })

  test("leaves ordinary POST requests on the REST path", () => {
    const parsed = parseRawRequest({
      raw: rawHttp("POST", "/dashboard", "app.example.com", { "content-type": "text/plain" }, "1:hello"),
      scheme: "https",
    })

    expect(parsed.protocol).toBeUndefined()
    expect(parsed.operation).toBeUndefined()
    expect(parsed.opKeyHash).toBeUndefined()
  })
})

describe("parser.deriveSite", () => {
  test("strips single-label TLDs to eTLD+1", () => {
    expect(deriveSite("api.example.com")).toBe("example.com")
    expect(deriveSite("app.example.com")).toBe("example.com")
    expect(deriveSite("admin.api.example.com")).toBe("example.com")
  })

  test("handles compound TLDs", () => {
    expect(deriveSite("api.example.co.uk")).toBe("example.co.uk")
    expect(deriveSite("app.example.com.tr")).toBe("example.com.tr")
  })

  test("returns IPv4 unchanged", () => {
    expect(deriveSite("127.0.0.1")).toBe("127.0.0.1")
    expect(deriveSite("10.0.0.1")).toBe("10.0.0.1")
  })

  test("returns single-label hosts unchanged (e.g., localhost)", () => {
    expect(deriveSite("localhost")).toBe("localhost")
  })
})
