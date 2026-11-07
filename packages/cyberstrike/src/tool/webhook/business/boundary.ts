// Boundary-value library (plan §05 business_test). Value sets for testing
// numeric boundaries, price manipulation, quantity abuse, and string edge
// cases. Pure data + selection — no I/O, no sends. The probe orchestrator
// picks a field, selects a value set, and sweeps via the shared HttpSender.

export type FieldClass = "integer" | "price" | "quantity" | "string" | "id"

export interface BoundaryValue {
  value: string
  category: FieldClass
  label: string
}

const INTEGER_VALUES: BoundaryValue[] = [
  { value: "0", category: "integer", label: "zero" },
  { value: "-1", category: "integer", label: "negative-one" },
  { value: "-0", category: "integer", label: "negative-zero" },
  { value: "2147483647", category: "integer", label: "int32-max" },
  { value: "-2147483648", category: "integer", label: "int32-min" },
  { value: "2147483648", category: "integer", label: "int32-overflow" },
  { value: "9007199254740991", category: "integer", label: "js-max-safe" },
  { value: "9007199254740992", category: "integer", label: "js-max-safe+1" },
  { value: "99999999999999999", category: "integer", label: "large-number" },
  { value: "1e308", category: "integer", label: "float-huge" },
  { value: "NaN", category: "integer", label: "nan" },
  { value: "Infinity", category: "integer", label: "infinity" },
  { value: "-Infinity", category: "integer", label: "neg-infinity" },
]

const PRICE_VALUES: BoundaryValue[] = [
  { value: "0", category: "price", label: "zero-price" },
  { value: "-1", category: "price", label: "negative-price" },
  { value: "0.001", category: "price", label: "sub-cent" },
  { value: "0.01", category: "price", label: "one-cent" },
  { value: "0.99", category: "price", label: "under-dollar" },
  { value: "-0.01", category: "price", label: "neg-cent" },
  { value: "99999999.99", category: "price", label: "huge-price" },
  { value: "1e10", category: "price", label: "scientific-price" },
  { value: "0.1+0.2", category: "price", label: "float-rounding" },
  { value: "0.000001", category: "price", label: "micro-price" },
]

const QUANTITY_VALUES: BoundaryValue[] = [
  { value: "0", category: "quantity", label: "zero-qty" },
  { value: "-1", category: "quantity", label: "negative-qty" },
  { value: "999999", category: "quantity", label: "huge-qty" },
  { value: "0.5", category: "quantity", label: "fractional-qty" },
  { value: "-999999", category: "quantity", label: "huge-negative-qty" },
  { value: "1", category: "quantity", label: "one" },
  { value: "2147483647", category: "quantity", label: "int32-max-qty" },
]

const STRING_VALUES: BoundaryValue[] = [
  { value: "", category: "string", label: "empty" },
  { value: " ", category: "string", label: "space" },
  { value: "null", category: "string", label: "null-string" },
  { value: "undefined", category: "string", label: "undefined-string" },
  { value: "true", category: "string", label: "bool-true" },
  { value: "false", category: "string", label: "bool-false" },
  { value: "[]", category: "string", label: "empty-array" },
  { value: "{}", category: "string", label: "empty-object" },
  { value: "A".repeat(10000), category: "string", label: "long-string-10k" },
]

const ID_VALUES: BoundaryValue[] = [
  { value: "0", category: "id", label: "zero-id" },
  { value: "1", category: "id", label: "first-id" },
  { value: "-1", category: "id", label: "neg-id" },
  { value: "999999", category: "id", label: "high-id" },
  { value: "00000000-0000-0000-0000-000000000000", category: "id", label: "nil-uuid" },
  { value: "admin", category: "id", label: "admin-id" },
]

const ALL_VALUES: ReadonlyMap<FieldClass, readonly BoundaryValue[]> = new Map([
  ["integer", INTEGER_VALUES],
  ["price", PRICE_VALUES],
  ["quantity", QUANTITY_VALUES],
  ["string", STRING_VALUES],
  ["id", ID_VALUES],
])

export namespace BoundaryValues {
  export function select(opts?: { categories?: FieldClass[]; limit?: number }): BoundaryValue[] {
    const cats = opts?.categories ?? (["integer", "price", "quantity", "string", "id"] as FieldClass[])
    let out: BoundaryValue[] = []
    for (const c of cats) out = out.concat(ALL_VALUES.get(c) ?? [])
    if (opts?.limit && opts.limit > 0) out = out.slice(0, opts.limit)
    return out
  }

  export function forField(fieldName: string): FieldClass {
    const lower = fieldName.toLowerCase()
    if (/price|cost|amount|total|fee|charge|payment|balance|credit|debit|tax|discount|subtotal/.test(lower)) return "price"
    if (/qty|quantity|count|num|number|units|items|seats|tickets/.test(lower)) return "quantity"
    if (/^id$|_id$|Id$|ID$|uuid|guid/.test(fieldName)) return "id"
    if (/age|year|month|day|hour|minute|second|page|limit|offset|skip|size|width|height|length|weight|index|step|level|rank|score|rating|version|priority|order/.test(lower)) return "integer"
    return "string"
  }
}
