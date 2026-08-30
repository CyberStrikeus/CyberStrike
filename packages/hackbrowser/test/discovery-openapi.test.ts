import { test, expect } from "bun:test"
import { makeMatcher } from "../src/scope.ts"
import { parseSpec, resolveBase } from "../src/discovery/detectors/openapi.ts"

const inScope = makeMatcher(["*.example.com"])

test("parseSpec (OpenAPI v3, absolute server) emits method x path endpoints", () => {
  const spec = {
    openapi: "3.0.0",
    servers: [{ url: "https://api.example.com/v1" }],
    paths: { "/users": { get: {}, post: {} }, "/users/{id}": { get: {} } },
  }
  const eps = parseSpec(spec, "https://api.example.com/openapi.json", inScope)
  const set = new Set(eps.map((e) => `${e.method} ${e.url}`))
  expect(set.has("GET https://api.example.com/v1/users")).toBe(true)
  expect(set.has("POST https://api.example.com/v1/users")).toBe(true)
  expect(set.has("GET https://api.example.com/v1/users/{id}")).toBe(true)
  expect(eps.every((e) => e.source === "openapi")).toBe(true)
})

test("parseSpec (Swagger v2, host + basePath + schemes)", () => {
  const spec = {
    swagger: "2.0",
    host: "api.example.com",
    basePath: "/v2",
    schemes: ["https"],
    paths: { "/orders": { get: {} } },
  }
  const eps = parseSpec(spec, "https://api.example.com/swagger.json", inScope)
  expect(eps).toEqual([{ method: "GET", url: "https://api.example.com/v2/orders", source: "openapi" }])
})

test("resolveBase resolves a relative v3 server against the spec origin", () => {
  const base = resolveBase({ openapi: "3.0.0", servers: [{ url: "/api" }] }, "https://app.example.com/openapi.json")
  expect(base).toBe("https://app.example.com/api")
})

test("parseSpec drops an out-of-scope base host", () => {
  const spec = { openapi: "3.0.0", servers: [{ url: "https://evil.com" }], paths: { "/x": { get: {} } } }
  expect(parseSpec(spec, "https://app.example.com/openapi.json", inScope)).toEqual([])
})
