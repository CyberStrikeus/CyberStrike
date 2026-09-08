import { describe, expect, test } from "bun:test"
import type { Transaction } from "../src/index"
import { normalizePath, endpointKey, params } from "../src/index"

function tx(method: string, url: string, body?: string, contentType = "application/json"): Transaction {
  return {
    id: "t",
    source: "browser",
    host: "app.test",
    request: { method, url, headers: body ? [{ name: "content-type", value: contentType }] : [], body },
  }
}

describe("normalizePath", () => {
  test("collapses uuid / numeric / long-hex segments, keeps real names", () => {
    expect(normalizePath("/review/customers/00000000-0000-4000-8000-000000000000/modules/12/data")).toBe(
      "/review/customers/{uuid}/modules/{id}/data",
    )
    expect(normalizePath("/session/deadbeefdeadbeef01/notes")).toBe("/session/{hex}/notes")
    expect(normalizePath("/")).toBe("/")
    expect(normalizePath("/analytics/api/filter-options")).toBe("/analytics/api/filter-options")
  })
})

describe("endpointKey", () => {
  test("groups instances of the same endpoint (method + host + normalized path)", () => {
    const a = endpointKey(tx("GET", "https://app.test/api/users/1"))
    const b = endpointKey(tx("GET", "https://app.test/api/users/2?x=1"))
    expect(a).toBe(b)
    expect(a).toBe("GET app.test/api/users/{id}")
  })
  test("different hosts do not collide", () => {
    expect(endpointKey(tx("GET", "https://a.test/x/1"))).not.toBe(endpointKey(tx("GET", "https://b.test/x/1")))
  })
  test("tolerates a relative/malformed url", () => {
    expect(endpointKey(tx("POST", "/api/run/5"))).toContain("/api/run/{id}")
  })
})

describe("params", () => {
  test("query params parsed", () => {
    expect(params(tx("GET", "https://app.test/x?id=42&sort=asc")).query).toEqual({ id: "42", sort: "asc" })
  })
  test("json body flattened to dot-paths — the injection target is addressable", () => {
    const p = params(tx("POST", "https://app.test/analytics/api/run-query", JSON.stringify({ query_template_id: "abc", params: { staff_name: "x", year: 2026 } })))
    expect(p.body["query_template_id"]).toBe("abc")
    expect(p.body["params.staff_name"]).toBe("x")
    expect(p.body["params.year"]).toBe("2026")
  })
  test("form-urlencoded body parsed", () => {
    const p = params(tx("POST", "https://app.test/login", "user=admin&pass=secret", "application/x-www-form-urlencoded"))
    expect(p.body).toEqual({ user: "admin", pass: "secret" })
  })
  test("non-parseable body ⇒ empty", () => {
    expect(params(tx("POST", "https://app.test/x", "<xml/>", "application/xml")).body).toEqual({})
  })
})
