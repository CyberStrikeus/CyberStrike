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

  test("GraphQL: function = operation root field + CRUD; objects from id-shaped variables, named by the operation", () => {
    const s = subjects(
      tx(
        {
          method: "POST",
          url: "https://api.test/graphql",
          headers: [{ name: "content-type", value: "application/json" }],
          body: JSON.stringify({ operationName: "UpdateOrder", query: "mutation UpdateOrder($id: ID!, $qty: Int!){ updateOrder(id:$id, qty:$qty){ id } }", variables: { id: "550e8400-e29b-41d4-a716-446655440000", qty: 3 } }),
        },
      ),
    )
    expect(s.function).toEqual({ method: "POST", endpoint: "POST api.test/graphql#updateOrder", crud: "update" })
    expect(s.objects.map((o) => o.ref)).toEqual(["order:550e8400-e29b-41d4-a716-446655440000"]) // NOT "variables:..."; qty (not id) skipped
  })

  test("GraphQL query root field infers read", () => {
    const s = subjects(tx({ method: "POST", url: "https://api.test/graphql", headers: [{ name: "content-type", value: "application/json" }], body: JSON.stringify({ query: "query { listUsers { id } }" }) }))
    expect(s.function.crud).toBe("read")
    expect(s.function.endpoint).toBe("POST api.test/graphql#listUsers")
  })

  test("JWT bearer: role = subject, plus roles + scopes from claims", () => {
    const payload = Buffer.from(JSON.stringify({ sub: "user-4021", roles: ["admin", "billing"], scope: "orders:write orders:read" })).toString("base64url")
    const jwt = `${Buffer.from(JSON.stringify({ alg: "HS256" })).toString("base64url")}.${payload}.sig`
    const s = subjects(tx({ url: "https://app.test/api/me", headers: [{ name: "authorization", value: `Bearer ${jwt}` }] }))
    expect(s.role).toBe("user-4021")
    expect(s.roles).toEqual(["admin", "billing"])
    expect(s.scopes).toEqual(["orders:write", "orders:read"])
  })

  test("explicit identity wins over the JWT subject", () => {
    const jwt = `x.${Buffer.from(JSON.stringify({ sub: "token-sub" })).toString("base64url")}.s`
    const s = subjects(tx({ url: "https://app.test/x", headers: [{ name: "authorization", value: `Bearer ${jwt}` }] }, "assigned-role"))
    expect(s.role).toBe("assigned-role")
  })

  test("comprehensive real browser request: path + query + nested body + id-ish headers, clean resource names", () => {
    const s = subjects(
      tx(
        {
          method: "POST",
          url: "https://app.test/api/v2/orgs/12/users/550e8400-e29b-41d4-a716-446655440000/orders?ref=ORD-99&limit=20",
          headers: [
            { name: "Content-Type", value: "application/json" },
            { name: "X-Account-Id", value: "88" }, // hyphenated header → clean lowercased resource, no dangling "-"
            { name: "Cookie", value: "session=abc; theme=dark" }, // not id-ish → not an object
          ],
          body: JSON.stringify({
            customer: { id: 4021, email: "b@x.com" },
            items: [{ productId: "6512a1b2c3d4e5f60718293a" }, { productId: 7 }],
            shipping: { addressId: 55 }, // must be "address", NOT "addres" (sid mid-word bug)
          }),
        },
        "org12-admin",
      ),
    )
    const refs = s.objects.map((o) => o.ref)
    expect(s.function.endpoint).toBe("POST app.test/api/v2/orgs/{id}/users/{uuid}/orders")
    expect(s.function.crud).toBe("create")
    expect(s.role).toBe("org12-admin")
    expect(refs).toContain("orgs:12")
    expect(refs).toContain("users:550e8400-e29b-41d4-a716-446655440000")
    expect(refs).toContain("customer:4021") // nested object
    expect(refs).toContain("product:6512a1b2c3d4e5f60718293a") // nested array, objectid shape
    expect(refs).toContain("product:7") // nested array, int
    expect(refs).toContain("address:55") // regression: NOT "addres"
    expect(refs).toContain("x-account:88") // regression: NOT "x-account-", lowercased
    expect(refs.some((r) => r.startsWith("session"))).toBe(false) // cookie not mined as object
    expect(refs).not.toContain("limit:20") // not id-ish, not id-shaped
  })
})

function crudFor(method: string) {
  return subjects(tx({ method, url: "https://app.test/x" })).function.crud
}
