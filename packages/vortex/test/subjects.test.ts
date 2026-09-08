import { describe, expect, test } from "bun:test"
import type { Transaction } from "../src/index"
import { subjects } from "../src/index"

const UUID = "550e8400-e29b-41d4-a716-446655440000"

function tx(over: Partial<Transaction["request"]> & { method?: string }, identity?: string): Transaction {
  return {
    id: "t",
    source: "browser",
    host: "app.test",
    identity,
    request: {
      method: over.method ?? "GET",
      url: over.url ?? "https://app.test/x",
      headers: over.headers ?? [],
      body: over.body,
    },
  }
}

describe("subjects — deterministic object/function/role extraction", () => {
  test("function = method + endpoint + CRUD; role = identity", () => {
    const s = subjects(tx({ method: "DELETE", url: "https://app.test/api/orders/42" }, "org1-admin"))
    expect(s.function).toEqual({ method: "DELETE", endpoint: "DELETE app.test/api/orders/{id}", crud: "delete" })
    expect(s.role).toBe("org1-admin")
    expect(crudFor("POST")).toBe("create")
    expect(crudFor("PUT")).toBe("update")
  })

  test("PATH ids are named by the preceding resource segment", () => {
    const s = subjects(tx({ url: `https://app.test/api/users/42/orders/${UUID}` }))
    expect(s.objects).toEqual([
      { ref: "users:42", value: "42", shape: "int", in: "path", name: "users", resource: "users" },
      { ref: `orders:${UUID}`, value: UUID, shape: "uuid", in: "path", name: "orders", resource: "orders" },
    ])
  })

  test("QUERY: id-ish name (any value) or strong shape under any name", () => {
    const s = subjects(tx({ url: "https://app.test/s?accountId=99&q=hello&token=abc" }))
    const refs = s.objects.map((o) => o.ref)
    expect(refs).toContain("account:99") // accountId → id-ish name, int value
    expect(refs).not.toContain("q:hello") // not id-ish, not id-shaped → skipped
    // a bare uuid value under a non-id name IS still an object ref (strong shape)
    const s2 = subjects(tx({ url: `https://app.test/s?ref=${UUID}` }))
    expect(s2.objects[0]!.ref).toBe(`ref:${UUID}`)
  })

  test("BODY nested structures are mined via the flattened dotpath map", () => {
    const s = subjects(
      tx({
        method: "POST",
        url: "https://app.test/api/orders",
        headers: [{ name: "content-type", value: "application/json" }],
        body: JSON.stringify({ order: { id: UUID }, items: [{ productId: 7 }], note: "gift" }),
      }),
    )
    const byName = Object.fromEntries(s.objects.map((o) => [o.name, o]))
    expect(byName["order.id"]!.ref).toBe(`order:${UUID}`)
    expect(byName["order.id"]!.in).toBe("body")
    expect(byName["items.0.productId"]!.ref).toBe("product:7") // nested array + camelCase id
    expect(byName["note"]).toBeUndefined() // plain text field, not an id
  })

  test("HEADERS: only explicitly id-ish header names", () => {
    const s = subjects(tx({ url: "https://app.test/x", headers: [{ name: "x-tenant-id", value: "5" }, { name: "accept", value: "*/*" }] }))
    expect(s.objects.map((o) => o.ref)).toEqual(["x-tenant:5"])
    expect(s.objects[0]!.in).toBe("header")
  })

  test("id-ish name with an opaque (non-standard) value still counts", () => {
    const s = subjects(tx({ url: "https://app.test/s?orderId=ORD-2024-XY" }))
    expect(s.objects[0]).toMatchObject({ ref: "order:ORD-2024-XY", shape: "opaque", in: "query" })
  })
})

function crudFor(method: string) {
  return subjects(tx({ method, url: "https://app.test/x" })).function.crud
}
