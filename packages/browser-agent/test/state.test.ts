import { test, expect } from "bun:test"
import {
  createGlobalState,
  markPageEmpty,
  drainEmptyStateQueue,
  drainOnMutation,
  hasSuccessfulMutation,
  MAX_REVISITS_PER_URL,
  ANY_MUTATION,
  normalizeUrl,
} from "../src/state.ts"

// ============================================================
// Aşama 13 — Empty-State Revisit helpers (§3.5.1)
// ============================================================

test("markPageEmpty: adds URL with ANY_MUTATION keyword on first call", () => {
  const s = createGlobalState()
  const queued = markPageEmpty(s, "/basket")
  expect(queued).toBe(true)
  expect(s.emptyStateQueue.get("/basket")).toBe(ANY_MUTATION)
})

test("markPageEmpty: stores provided expectedMutation keyword", () => {
  const s = createGlobalState()
  markPageEmpty(s, "/basket", "cart-item-added")
  expect(s.emptyStateQueue.get("/basket")).toBe("cart-item-added")
})

test("markPageEmpty: idempotent on same URL within hard limit", () => {
  const s = createGlobalState()
  markPageEmpty(s, "/basket")
  markPageEmpty(s, "/basket")
  expect(s.emptyStateQueue.size).toBe(1)
})

test("markPageEmpty: rejects URL once hard limit reached", () => {
  const s = createGlobalState()
  // Simulate 2 revisits already happened
  s.revisitCount.set("/basket", MAX_REVISITS_PER_URL)
  const queued = markPageEmpty(s, "/basket")
  expect(queued).toBe(false)
  expect(s.emptyStateQueue.has("/basket")).toBe(false)
})

test("markPageEmpty: second call with new keyword overwrites previous", () => {
  const s = createGlobalState()
  markPageEmpty(s, "/basket")  // ANY_MUTATION
  markPageEmpty(s, "/basket", "cart-item-added")
  expect(s.emptyStateQueue.get("/basket")).toBe("cart-item-added")
})

test("drainEmptyStateQueue: moves URLs to pageQueue front + increments count", () => {
  const s = createGlobalState()
  s.pageQueue.push("/home")
  markPageEmpty(s, "/basket")
  markPageEmpty(s, "/orders")

  const drained = drainEmptyStateQueue(s)

  expect(drained.sort()).toEqual(["/basket", "/orders"])
  expect(s.emptyStateQueue.size).toBe(0)
  // Drained URLs are at the front (priority), original /home after
  expect(s.pageQueue[s.pageQueue.length - 1]).toBe("/home")
  expect(s.pageQueue.includes("/basket")).toBe(true)
  expect(s.pageQueue.includes("/orders")).toBe(true)
  expect(s.revisitCount.get("/basket")).toBe(1)
  expect(s.revisitCount.get("/orders")).toBe(1)
})

test("drainEmptyStateQueue: idempotent on empty queue", () => {
  const s = createGlobalState()
  const drained = drainEmptyStateQueue(s)
  expect(drained).toEqual([])
  expect(s.pageQueue.length).toBe(0)
})

test("drainEmptyStateQueue: respects hard limit across multiple drains", () => {
  const s = createGlobalState()

  // 1st mark + drain
  markPageEmpty(s, "/basket")
  drainEmptyStateQueue(s)
  expect(s.revisitCount.get("/basket")).toBe(1)

  // 2nd mark + drain — still allowed (count=1, below limit=2)
  const second = markPageEmpty(s, "/basket")
  expect(second).toBe(true)
  drainEmptyStateQueue(s)
  expect(s.revisitCount.get("/basket")).toBe(2)

  // 3rd mark rejected by hard limit
  const third = markPageEmpty(s, "/basket")
  expect(third).toBe(false)
  expect(s.emptyStateQueue.has("/basket")).toBe(false)
})

// ============================================================
// Aşama 13 Mutation Matching — drainOnMutation keyword behavior
// ============================================================

test("drainOnMutation: ANY_MUTATION URLs drain on any keyword (or none)", () => {
  const s = createGlobalState()
  markPageEmpty(s, "/basket")  // ANY_MUTATION (no keyword)
  markPageEmpty(s, "/orders")  // ANY_MUTATION

  const drained = drainOnMutation(s, "cart-item-added")
  expect(drained.sort()).toEqual(["/basket", "/orders"])
})

test("drainOnMutation: keyword URLs drain ONLY on exact match", () => {
  const s = createGlobalState()
  markPageEmpty(s, "/basket", "cart-item-added")
  markPageEmpty(s, "/users",  "user-created")

  const drained = drainOnMutation(s, "cart-item-added")
  expect(drained).toEqual(["/basket"])
  // /users should still be pending (no match)
  expect(s.emptyStateQueue.get("/users")).toBe("user-created")
})

test("drainOnMutation: mixed ANY + keyword — both drain on matching keyword", () => {
  const s = createGlobalState()
  markPageEmpty(s, "/basket", "cart-item-added")
  markPageEmpty(s, "/wishlist")  // ANY_MUTATION

  const drained = drainOnMutation(s, "cart-item-added")
  expect(drained.sort()).toEqual(["/basket", "/wishlist"])
})

test("drainOnMutation: no-keyword task drains ONLY ANY_MUTATION URLs", () => {
  const s = createGlobalState()
  markPageEmpty(s, "/basket", "cart-item-added")  // specific
  markPageEmpty(s, "/wishlist")                   // ANY_MUTATION

  // Task had no keyword — only ANY_MUTATION URLs drain (backward-compat)
  const drained = drainOnMutation(s, undefined)
  expect(drained).toEqual(["/wishlist"])
  expect(s.emptyStateQueue.get("/basket")).toBe("cart-item-added")
})

test("drainOnMutation: unmatched keyword URLs remain pending", () => {
  const s = createGlobalState()
  markPageEmpty(s, "/users", "user-created")

  const drained = drainOnMutation(s, "cart-item-added")
  expect(drained).toEqual([])
  expect(s.emptyStateQueue.get("/users")).toBe("user-created")
})

test("drainOnMutation: drained URLs get fingerprint cleared", () => {
  const s = createGlobalState()
  s.pageFingerprints.set("/basket", "old-fp")
  markPageEmpty(s, "/basket")

  drainOnMutation(s, "anything")
  expect(s.pageFingerprints.has("/basket")).toBe(false)
})

test("hasSuccessfulMutation: detects POST 2xx", () => {
  expect(hasSuccessfulMutation(["POST /api/Users/ [201]"])).toBe(true)
  expect(hasSuccessfulMutation(["PUT /api/Users/1 [200]"])).toBe(true)
  expect(hasSuccessfulMutation(["PATCH /api/Users/1 [204]"])).toBe(true)
  expect(hasSuccessfulMutation(["DELETE /api/Users/1 [200]"])).toBe(true)
})

test("hasSuccessfulMutation: ignores GET and non-2xx", () => {
  expect(hasSuccessfulMutation(["GET /api/Users/ [200]"])).toBe(false)
  expect(hasSuccessfulMutation(["POST /api/Users/ [401]"])).toBe(false)
  expect(hasSuccessfulMutation(["POST /api/Users/ [500]"])).toBe(false)
})

test("hasSuccessfulMutation: mixed list finds one mutation", () => {
  const mixed = [
    "GET /api/config [200]",
    "GET /api/user/me [200]",
    "POST /api/BasketItems/ [201]",
    "GET /api/products [200]",
  ]
  expect(hasSuccessfulMutation(mixed)).toBe(true)
})

test("hasSuccessfulMutation: handles undefined/empty", () => {
  expect(hasSuccessfulMutation(undefined)).toBe(false)
  expect(hasSuccessfulMutation([])).toBe(false)
})

test("hasSuccessfulMutation: rejects malformed lines", () => {
  expect(hasSuccessfulMutation(["garbage line"])).toBe(false)
  expect(hasSuccessfulMutation(["POST /api/x"])).toBe(false)
})

// ============================================================
// BUG-5 / Aşama 13 — normalizeUrl hash routing unification
// ============================================================

test("normalizeUrl: '/' and '/#/' and '/#' unify to root", () => {
  const a = normalizeUrl("http://x.com/")
  const b = normalizeUrl("http://x.com/#/")
  const c = normalizeUrl("http://x.com/#")
  expect(a).toBe(b)
  expect(b).toBe(c)
  expect(a).toBe("http://x.com/")
})

test("normalizeUrl: trailing slash in hash route stripped", () => {
  expect(normalizeUrl("http://x.com/#/cart/"))
    .toBe(normalizeUrl("http://x.com/#/cart"))
})

test("normalizeUrl: different hash routes stay distinct", () => {
  expect(normalizeUrl("http://x.com/#/cart"))
    .not.toBe(normalizeUrl("http://x.com/#/products"))
})

test("normalizeUrl: non-hash URLs preserve pathname distinctions", () => {
  expect(normalizeUrl("http://x.com/cart"))
    .not.toBe(normalizeUrl("http://x.com/products"))
})

test("normalizeUrl: query params preserved and sorted", () => {
  expect(normalizeUrl("http://x.com/search?b=2&a=1"))
    .toBe(normalizeUrl("http://x.com/search?a=1&b=2"))
})
