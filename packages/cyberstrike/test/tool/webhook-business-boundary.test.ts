import { describe, expect, test } from "bun:test"
import { BoundaryValues, type FieldClass } from "../../src/tool/webhook/business/boundary"

describe("BoundaryValues.select", () => {
  test("returns all categories by default", () => {
    const all = BoundaryValues.select()
    const cats = new Set(all.map((v) => v.category))
    expect(cats.size).toBe(5)
    expect(cats.has("integer")).toBe(true)
    expect(cats.has("price")).toBe(true)
    expect(cats.has("quantity")).toBe(true)
    expect(cats.has("string")).toBe(true)
    expect(cats.has("id")).toBe(true)
    expect(all.length).toBeGreaterThan(30)
  })

  test("filters by category", () => {
    const prices = BoundaryValues.select({ categories: ["price"] })
    expect(prices.every((v) => v.category === "price")).toBe(true)
    expect(prices.length).toBeGreaterThanOrEqual(8)

    const priceAndQty = BoundaryValues.select({ categories: ["price", "quantity"] })
    expect(priceAndQty.every((v) => v.category === "price" || v.category === "quantity")).toBe(true)
  })

  test("respects limit", () => {
    const limited = BoundaryValues.select({ limit: 5 })
    expect(limited).toHaveLength(5)
  })

  test("limit larger than values returns all", () => {
    const all = BoundaryValues.select()
    const huge = BoundaryValues.select({ limit: 99999 })
    expect(huge).toHaveLength(all.length)
  })

  test("every value has a non-empty label", () => {
    for (const v of BoundaryValues.select()) {
      expect(v.label.length).toBeGreaterThan(0)
      expect(v.value).toBeDefined()
    }
  })
})

describe("BoundaryValues.forField", () => {
  const cases: [string, FieldClass][] = [
    ["price", "price"],
    ["total_price", "price"],
    ["amount", "price"],
    ["subtotal", "price"],
    ["discount_amount", "price"],
    ["quantity", "quantity"],
    ["item_count", "quantity"],
    ["num_tickets", "quantity"],
    ["seats", "quantity"],
    ["user_id", "id"],
    ["userId", "id"],
    ["uuid", "id"],
    ["page", "integer"],
    ["limit", "integer"],
    ["offset", "integer"],
    ["age", "integer"],
    ["width", "integer"],
    ["score", "integer"],
    ["foo_bar", "string"],
    ["description", "string"],
    ["name", "string"],
  ]

  for (const [field, expected] of cases) {
    test(`"${field}" → ${expected}`, () => {
      expect(BoundaryValues.forField(field)).toBe(expected)
    })
  }
})

describe("boundary values — edge case coverage", () => {
  test("integer set includes overflow boundaries", () => {
    const ints = BoundaryValues.select({ categories: ["integer"] })
    const labels = ints.map((v) => v.label)
    expect(labels).toContain("int32-max")
    expect(labels).toContain("int32-min")
    expect(labels).toContain("int32-overflow")
    expect(labels).toContain("js-max-safe")
    expect(labels).toContain("js-max-safe+1")
    expect(labels).toContain("nan")
    expect(labels).toContain("infinity")
  })

  test("price set includes manipulation values", () => {
    const prices = BoundaryValues.select({ categories: ["price"] })
    const labels = prices.map((v) => v.label)
    expect(labels).toContain("negative-price")
    expect(labels).toContain("zero-price")
    expect(labels).toContain("sub-cent")
    expect(labels).toContain("huge-price")
  })

  test("string set includes type-confusion values", () => {
    const strings = BoundaryValues.select({ categories: ["string"] })
    const labels = strings.map((v) => v.label)
    expect(labels).toContain("null-string")
    expect(labels).toContain("undefined-string")
    expect(labels).toContain("empty-array")
    expect(labels).toContain("empty-object")
    expect(labels).toContain("long-string-10k")
  })
})
