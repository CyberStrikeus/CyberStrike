import { describe, expect, test } from "bun:test"
import type { Transaction } from "../src/index"
import { MemoryStore, inventory, crossRoleObjects, crossRoleFunctions, objectsByResource, objectsForRole, transactionsForObject } from "../src/index"

function tx(id: string, url: string, identity?: string, method = "GET"): Transaction {
  return { id, source: "browser", host: "app.test", identity, request: { method, url: `https://app.test${url}`, headers: [] } }
}

describe("inventory — corpus object & function graph the agent queries", () => {
  const store = new MemoryStore()
  // order:42 reached by org1 AND org2 (IDOR candidate); user:7 only org1; orders list function by both roles.
  store.add(tx("a", "/api/orders/42", "org1"))
  store.add(tx("b", "/api/orders/42", "org2"))
  store.add(tx("c", "/api/users/7", "org1"))
  store.add(tx("d", "/api/orders/99", "org2"))
  const inv = inventory(store)

  test("objects are canonicalized by ref across transactions, carrying roles + txs", () => {
    const order42 = inv.objects.find((o) => o.ref === "orders:42")!
    expect(order42.roles.sort()).toEqual(["org1", "org2"])
    expect(order42.transactions.sort()).toEqual(["a", "b"])
    expect(order42.resource).toBe("orders")
  })

  test("crossRoleObjects surfaces the IDOR/BOLA lead: same object under >1 role", () => {
    expect(crossRoleObjects(inv).map((o) => o.ref)).toEqual(["orders:42"]) // NOT users:7 (one role) / orders:99 (one role)
  })

  test("crossRoleFunctions surfaces the BFLA surface: same function under >1 role", () => {
    const cf = crossRoleFunctions(inv)
    expect(cf.map((f) => f.endpoint)).toContain("GET app.test/api/orders/{id}") // org1 + org2 both hit it
    expect(cf.find((f) => f.endpoint === "GET app.test/api/orders/{id}")!.objects.sort()).toEqual(["orders:42", "orders:99"])
  })

  test("agent lookups: by resource, by role, and the txs to replay for an object", () => {
    expect(objectsByResource(inv, "orders").map((o) => o.ref).sort()).toEqual(["orders:42", "orders:99"])
    expect(objectsForRole(inv, "org2").map((o) => o.ref).sort()).toEqual(["orders:42", "orders:99"])
    expect(transactionsForObject(inv, "orders:42").sort()).toEqual(["a", "b"]) // agent replays these under another role to confirm
  })
})
