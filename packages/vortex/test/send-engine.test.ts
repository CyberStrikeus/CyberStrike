import { describe, expect, test } from "bun:test"
import { HttpMessage, Mutate, Apply, Observe } from "../src/send"

const RAW = ["POST /api/run HTTP/1.1", "Host: app.test", "Content-Type: application/json", "Cookie: sid=abc", "", '{"a":1}'].join("\r\n")

describe("send engine port — raw HTTP round-trips in vortex", () => {
  test("parse → serialize preserves method/target/headers/body", () => {
    const req = HttpMessage.parse(RAW)
    expect(req.method).toBe("POST")
    expect(req.target).toBe("/api/run")
    expect(req.version).toBe("HTTP/1.1")
    expect(new TextDecoder().decode(HttpMessage.serialize(req))).toBe(RAW)
  })

  test("Mutate builds/edits a request (captured-replay AND fresh-build modularity)", () => {
    const req = HttpMessage.parse(RAW)
    const withHeader = Mutate.setHeader(req, "X-Test", "1")
    expect(withHeader.headers.some((h) => h.name === "X-Test" && h.value === "1")).toBe(true)
    const withQuery = Mutate.addQuery(req, "debug", "1")
    expect(withQuery.target).toContain("debug=1")
    // original is untouched (mutations clone)
    expect(req.headers.some((h) => h.name === "X-Test")).toBe(false)
  })

  test("Apply.mutations applies a typed op list; Observe reads a response body", () => {
    const req = HttpMessage.parse(RAW)
    const mutated = Apply.mutations(req, [{ op: "set-header", name: "Authorization", value: "Bearer x" }])
    expect(mutated.headers.some((h) => h.name === "Authorization")).toBe(true)
    expect(Observe.errorSignatures("... SQL syntax error near ...").length).toBeGreaterThan(0)
  })
})
