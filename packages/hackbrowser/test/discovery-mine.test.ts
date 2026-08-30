import { test, expect } from "bun:test"
import { makeMatcher } from "../src/scope.ts"
import { mineEndpoints } from "../src/discovery/mine.ts"

const inScope = makeMatcher(["*.example.com"])
const origin = "https://app.example.com"

function keys(text: string): Set<string> {
  return new Set(mineEndpoints(text, origin, inScope).map((e) => `${e.method} ${e.url}`))
}

test("mines HTTP client call sites with their method", () => {
  const src = `this.http.get("/api/users");axios.post('/api/orders',b);x.delete("/api/users/5")`
  const set = keys(src)
  expect(set.has("GET https://app.example.com/api/users")).toBe(true)
  expect(set.has("POST https://app.example.com/api/orders")).toBe(true)
  expect(set.has("DELETE https://app.example.com/api/users/5")).toBe(true)
})

test("mines fetch() as GET and normalizes template segments", () => {
  const src = "fetch(`/api/users/${id}/roles`)"
  const set = keys(src)
  expect(set.has("GET https://app.example.com/api/users/{}/roles")).toBe(true)
})

test("harvests bare API path literals and resolves against origin", () => {
  const src = `const R={list:"/api/reports",graph:"/graphql"};`
  const set = keys(src)
  expect(set.has("GET https://app.example.com/api/reports")).toBe(true)
  expect(set.has("GET https://app.example.com/graphql")).toBe(true)
})

test("path-literal prefix must be a whole segment (no /user-guide, /username)", () => {
  const src = `a="/users";b="/user-guide";c="/username";d="/session/abc"`
  const set = keys(src)
  expect(set.has("GET https://app.example.com/users")).toBe(true)
  expect(set.has("GET https://app.example.com/session/abc")).toBe(true)
  expect(set.has("GET https://app.example.com/user-guide")).toBe(false)
  expect(set.has("GET https://app.example.com/username")).toBe(false)
})

test("skips static assets, non-http schemes, and out-of-scope hosts", () => {
  const src = `fetch("/app.js");fetch("data:text/js");axios.get("https://evil.com/api/x");img="/logo.png"`
  expect(keys(src).size).toBe(0)
})

test("keeps an absolute in-scope URL and dedupes repeats", () => {
  const src = `fetch("https://api.example.com/v2/ping");fetch("https://api.example.com/v2/ping")`
  const eps = mineEndpoints(src, origin, inScope)
  expect(eps).toEqual([{ method: "GET", url: "https://api.example.com/v2/ping", source: "js-api" }])
})
