import { test, expect } from "bun:test"
import { validateIntelligence } from "../src/navigator.ts"

// ============================================================
// Aşama 13 — PagePlan v2 Intelligence validation (§3.3.1)
// ============================================================

test("validateIntelligence: valid empty + reason passes through", () => {
  const out = validateIntelligence({
    pageState: "empty",
    revisitAfter: "any-mutation",
    revisitReason: "basket is empty",
  })
  expect(out.pageState).toBe("empty")
  expect(out.revisitAfter).toBe("any-mutation")
  expect(out.revisitReason).toBe("basket is empty")
})

test("validateIntelligence: valid populated passes through", () => {
  const out = validateIntelligence({
    pageState: "populated",
    revisitAfter: null,
  })
  expect(out.pageState).toBe("populated")
  expect(out.revisitAfter).toBe(null)
})

test("validateIntelligence: missing fields → all undefined (safe default)", () => {
  const out = validateIntelligence({ tasks: [] })
  expect(out.pageState).toBeUndefined()
  expect(out.revisitAfter).toBeUndefined()
  expect(out.revisitReason).toBeUndefined()
})

test("validateIntelligence: invalid pageState → undefined", () => {
  const out = validateIntelligence({ pageState: "weird-value" })
  expect(out.pageState).toBeUndefined()
})

test("validateIntelligence: invalid revisitAfter → undefined", () => {
  const out = validateIntelligence({ revisitAfter: "specific-endpoint" })
  expect(out.revisitAfter).toBeUndefined()
})

test("validateIntelligence: empty revisitReason string ignored", () => {
  const out = validateIntelligence({
    pageState: "populated",
    revisitReason: "",
  })
  expect(out.revisitReason).toBeUndefined()
})

test("validateIntelligence: empty WITHOUT reason → downgrades to unknown (safety refinement)", () => {
  const out = validateIntelligence({
    pageState: "empty",
    revisitAfter: "any-mutation",
    // revisitReason missing
  })
  expect(out.pageState).toBe("unknown")
  expect(out.revisitAfter).toBe(null)
})

test("validateIntelligence: unknown pageState does not require reason", () => {
  const out = validateIntelligence({ pageState: "unknown" })
  expect(out.pageState).toBe("unknown")
  expect(out.revisitReason).toBeUndefined()
})

test("validateIntelligence: revisitOn keyword preserved when provided", () => {
  const out = validateIntelligence({
    pageState: "empty",
    revisitAfter: "any-mutation",
    revisitReason: "basket is empty",
    revisitOn: "cart-item-added",
  })
  expect((out as any).revisitOn).toBe("cart-item-added")
})

test("validateIntelligence: empty revisitOn string ignored", () => {
  const out = validateIntelligence({
    pageState: "empty",
    revisitAfter: "any-mutation",
    revisitReason: "basket is empty",
    revisitOn: "",
  })
  expect((out as any).revisitOn).toBeUndefined()
})

test("validateIntelligence: revisitOn cleared when empty downgraded to unknown", () => {
  const out = validateIntelligence({
    pageState: "empty",
    // revisitReason missing → downgrades to unknown
    revisitOn: "cart-item-added",
  })
  expect(out.pageState).toBe("unknown")
  expect((out as any).revisitOn).toBeUndefined()
})
