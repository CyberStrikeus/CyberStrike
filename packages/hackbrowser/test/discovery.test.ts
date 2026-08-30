import { test, expect } from "bun:test"
import { makeMatcher } from "../src/scope.ts"
import { toScopedPages } from "../src/discovery/url.ts"

const inScope = makeMatcher(["*.example.com"])
const base = "https://app.example.com/dash/#/home"

test("toScopedPages resolves relative paths against the base origin", () => {
  const out = toScopedPages(["/admin", "/users"], base, inScope)
  expect(out).toContain("https://app.example.com/admin")
  expect(out).toContain("https://app.example.com/users")
})

test("toScopedPages drops out-of-scope hosts", () => {
  const out = toScopedPages(["https://evil.com/x", "https://app.example.com/ok"], base, inScope)
  expect(out.some((u) => u.includes("evil.com"))).toBe(false)
  expect(out).toContain("https://app.example.com/ok")
})

test("toScopedPages strips fragments and de-duplicates", () => {
  const out = toScopedPages(["/a#section", "/a", "https://app.example.com/a"], base, inScope)
  expect(out).toEqual(["https://app.example.com/a"])
})

test("toScopedPages skips non-http(s) and malformed values", () => {
  const out = toScopedPages(["mailto:a@b.c", "javascript:void(0)", "", "http://"], base, inScope)
  expect(out).toEqual([])
})
