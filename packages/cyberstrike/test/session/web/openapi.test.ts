import { describe, expect, test } from "bun:test"
import { OpenApi } from "../../../src/session/web/openapi"

const all = () => true
const parse = (spec: object, url: string, inScope: (u: string) => boolean = all) => OpenApi.parse(JSON.stringify(spec), url, inScope).map((e) => `${e.method} ${e.url}`)

describe("OpenApi.parse", () => {
  test("OpenAPI v3 with servers[] base", () => {
    const spec = { openapi: "3.0.0", servers: [{ url: "https://api.h.test" }], paths: { "/users": { get: {}, post: {} }, "/users/{id}": { get: {} } } }
    expect(parse(spec, "https://h.test/openapi.json").sort()).toEqual([
      "GET https://api.h.test/users",
      "GET https://api.h.test/users/{id}",
      "POST https://api.h.test/users",
    ])
  })

  test("Swagger v2 host + basePath base (scheme from spec url)", () => {
    const spec = { swagger: "2.0", host: "h.test", basePath: "/v1", paths: { "/x": { get: {} } } }
    expect(parse(spec, "https://h.test/swagger.json")).toEqual(["GET https://h.test/v1/x"])
  })

  test("falls back to the spec origin when no servers/host", () => {
    expect(parse({ openapi: "3.0", paths: { "/y": { post: {} } } }, "https://h.test/api-docs")).toEqual(["POST https://h.test/y"])
  })

  test("ignores non-HTTP-method keys (parameters/summary)", () => {
    const spec = { openapi: "3.0", paths: { "/z": { get: {}, parameters: [], summary: "x" } } }
    expect(parse(spec, "https://h.test/openapi.json")).toEqual(["GET https://h.test/z"])
  })

  test("out-of-scope base → nothing", () => {
    const spec = { openapi: "3.0", servers: [{ url: "https://evil.com" }], paths: { "/x": { get: {} } } }
    expect(parse(spec, "https://h.test/openapi.json", (u) => !u.includes("evil"))).toEqual([])
  })

  test("malformed JSON / no paths → []", () => {
    expect(OpenApi.parse("{not json", "https://h.test/x", all)).toEqual([])
    expect(parse({ openapi: "3.0" }, "https://h.test/x")).toEqual([])
  })

  test("looksLikeSpec gates cheaply", () => {
    expect(OpenApi.looksLikeSpec(`{"openapi":"3.0","paths":{}}`)).toBe(true)
    expect(OpenApi.looksLikeSpec(`{"swagger":"2.0","paths":{}}`)).toBe(true)
    expect(OpenApi.looksLikeSpec(`<html>not a spec</html>`)).toBe(false)
  })
})
