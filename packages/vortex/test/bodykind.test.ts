import { describe, expect, test } from "bun:test"
import type { Transaction } from "../src/index"
import { bodyKind, analyzeBody, responseFields, requestBodyKind, responseBodyKind, query } from "../src/index"

describe("bodyKind classification", () => {
  test("by content-type", () => {
    expect(bodyKind("application/json", "{}")).toBe("json")
    expect(bodyKind("application/vnd.api+json", "{}")).toBe("json")
    expect(bodyKind("application/x-www-form-urlencoded", "a=1")).toBe("form")
    expect(bodyKind("multipart/form-data; boundary=x", "--x--")).toBe("multipart")
    expect(bodyKind("application/xml", "<a/>")).toBe("xml")
    expect(bodyKind("text/xml", "<a/>")).toBe("xml")
    expect(bodyKind("text/html", "<html>")).toBe("html")
    expect(bodyKind("text/plain", "hi")).toBe("text")
    expect(bodyKind("image/png", "\x89PNG")).toBe("binary")
    expect(bodyKind("application/graphql", "{ me }")).toBe("graphql")
    expect(bodyKind("", undefined)).toBe("empty")
  })
  test("sniffs when content-type is absent/unknown", () => {
    expect(bodyKind("", '{"a":1}')).toBe("json")
    expect(bodyKind("", "<!DOCTYPE html><html>")).toBe("html")
    expect(bodyKind("", "<root><a>1</a></root>")).toBe("xml")
    expect(bodyKind("", "just text")).toBe("text")
  })
})

describe("analyzeBody field extraction per kind", () => {
  test("json flattens", () => {
    expect(analyzeBody("application/json", '{"a":{"b":2}}').fields).toEqual({ "a.b": "2" })
  })
  test("form parses", () => {
    expect(analyzeBody("application/x-www-form-urlencoded", "u=admin&p=x").fields).toEqual({ u: "admin", p: "x" })
  })
  test("xml best-effort leaf extraction", () => {
    expect(analyzeBody("application/xml", "<user><name>alice</name><role>admin</role></user>").fields).toEqual({ name: "alice", role: "admin" })
  })
  test("html/text/binary have no fields (raw only)", () => {
    expect(analyzeBody("text/html", "<html>x</html>").fields).toEqual({})
    expect(analyzeBody("text/plain", "hello").fields).toEqual({})
  })
})

function tx(id: string, resBody: string, resCT: string): Transaction {
  return {
    id,
    source: "browser",
    host: "app.test",
    request: { method: "GET", url: "https://app.test/api/users/1", headers: [] },
    response: { status: 200, headers: [{ name: "content-type", value: resCT }], body: resBody },
  }
}

describe("response body is parsed too (not just request)", () => {
  test("responseFields extracts a JSON response's fields", () => {
    const t = tx("a", JSON.stringify({ id: 42, email: "a@b.c" }), "application/json")
    expect(responseFields(t)).toEqual({ id: "42", email: "a@b.c" })
    expect(responseBodyKind(t)).toBe("json")
    expect(requestBodyKind(t)).toBe("empty")
  })
  test("HTTPQL can query response body fields and body kinds", () => {
    const corpus = [
      tx("json", JSON.stringify({ customerId: "c-1" }), "application/json"),
      tx("html", "<html>error</html>", "text/html"),
    ]
    expect(query(corpus, "resp.body.customerId:c-1").map((t) => t.id)).toEqual(["json"])
    expect(query(corpus, "resp.bodyKind:html").map((t) => t.id)).toEqual(["html"])
    expect(query(corpus, "resp.bodyKind:json").map((t) => t.id)).toEqual(["json"])
  })
})
