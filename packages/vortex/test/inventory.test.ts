import { describe, expect, test } from "bun:test"
import type { Transaction, Source } from "../src/index"
import { MemoryStore, inventory, crossRoleObjects, crossRoleFunctions, allRolesCrawled, objectsByResource, objectsForRole, transactionsForObject } from "../src/index"

function tx(id: string, url: string, identity?: string, method = "GET", source: Source = "browser"): Transaction {
  return { id, source, host: "app.test", identity, request: { method, url: `https://app.test${url}`, headers: [] } }
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

  test("roleProvenance tracks crawl source for objects and functions", () => {
    const order42 = inv.objects.find((o) => o.ref === "orders:42")!
    expect(order42.roleProvenance).toEqual({ org1: "crawl", org2: "crawl" })
    const fn = inv.functions.find((f) => f.endpoint === "GET app.test/api/orders/{id}")!
    expect(fn.roleProvenance).toEqual({ org1: "crawl", org2: "crawl" })
  })
})

describe("inventory — navigation provenance (shared vs forced endpoints)", () => {
  test("shared=true when BOTH roles discovered the endpoint via crawl (browser)", () => {
    const store = new MemoryStore()
    store.add(tx("a", "/api/cover-letters", "admin", "GET", "browser"))
    store.add(tx("b", "/api/cover-letters", "member", "GET", "browser"))
    const inv = inventory(store)
    const cf = crossRoleFunctions(inv)
    const fn = cf.find((f) => f.endpoint.includes("cover-letters"))!
    expect(fn.roleProvenance).toEqual({ admin: "crawl", member: "crawl" })
    expect(allRolesCrawled(fn.roleProvenance)).toBe(true)
  })

  test("shared=false when one role only reached the endpoint via replay", () => {
    const store = new MemoryStore()
    store.add(tx("a", "/api/admin/users", "admin", "GET", "browser"))
    store.add(tx("b", "/api/admin/users", "member", "GET", "replay"))
    const inv = inventory(store)
    const cf = crossRoleFunctions(inv)
    const fn = cf.find((f) => f.endpoint.includes("admin"))!
    expect(fn.roleProvenance).toEqual({ admin: "crawl", member: "forced" })
    expect(allRolesCrawled(fn.roleProvenance)).toBe(false)
  })

  test("proxy source counts as crawl (organic MITM capture)", () => {
    const store = new MemoryStore()
    store.add(tx("a", "/api/data", "admin", "GET", "proxy"))
    store.add(tx("b", "/api/data", "member", "GET", "browser"))
    const inv = inventory(store)
    const fn = inv.functions.find((f) => f.endpoint.includes("data"))!
    expect(fn.roleProvenance).toEqual({ admin: "crawl", member: "crawl" })
    expect(allRolesCrawled(fn.roleProvenance)).toBe(true)
  })

  test("import/cloud sources count as forced", () => {
    const store = new MemoryStore()
    store.add(tx("a", "/api/resource", "admin", "GET", "browser"))
    store.add(tx("b", "/api/resource", "member", "GET", "import"))
    const inv = inventory(store)
    const fn = inv.functions.find((f) => f.endpoint.includes("resource"))!
    expect(fn.roleProvenance).toEqual({ admin: "crawl", member: "forced" })
    expect(allRolesCrawled(fn.roleProvenance)).toBe(false)
  })

  test("role with both crawl AND replay → provenance 'both', still treated as crawled", () => {
    const store = new MemoryStore()
    store.add(tx("a", "/api/items", "admin", "GET", "browser"))
    store.add(tx("b", "/api/items", "member", "GET", "browser"))
    store.add(tx("c", "/api/items", "member", "GET", "replay"))
    const inv = inventory(store)
    const fn = inv.functions.find((f) => f.endpoint.includes("items"))!
    expect(fn.roleProvenance).toEqual({ admin: "crawl", member: "both" })
    expect(allRolesCrawled(fn.roleProvenance)).toBe(true)
  })

  test("object-level provenance tracks per-role source", () => {
    const store = new MemoryStore()
    store.add(tx("a", "/api/orders/42", "admin", "GET", "browser"))
    store.add(tx("b", "/api/orders/42", "member", "GET", "replay"))
    const inv = inventory(store)
    const obj = inv.objects.find((o) => o.ref === "orders:42")!
    expect(obj.roleProvenance).toEqual({ admin: "crawl", member: "forced" })
    expect(allRolesCrawled(obj.roleProvenance)).toBe(false)
  })
})

describe("inventory — DOM-level provenance (pageVisitedBy / elementRoles)", () => {
  function txDom(id: string, url: string, identity: string, opts: { pageVisitedBy?: string[]; elementRoles?: string[]; source?: Source }): Transaction {
    return { id, source: opts.source ?? "browser", host: "app.test", identity, request: { method: "GET", url: `https://app.test${url}`, headers: [] }, pageVisitedBy: opts.pageVisitedBy, elementRoles: opts.elementRoles }
  }

  test("pageVisitedBy overrides tx.source: browser source but role not in pageVisitedBy → forced", () => {
    const store = new MemoryStore()
    store.add(txDom("a", "/api/admin/users", "admin", { pageVisitedBy: ["admin", "member"] }))
    store.add(txDom("b", "/api/admin/users", "member", { pageVisitedBy: ["admin"] }))
    const inv = inventory(store)
    const fn = inv.functions.find((f) => f.endpoint.includes("admin"))!
    expect(fn.roleProvenance).toEqual({ admin: "crawl", member: "forced" })
    expect(allRolesCrawled(fn.roleProvenance)).toBe(false)
  })

  test("pageVisitedBy includes both roles → shared=true even without elementRoles", () => {
    const store = new MemoryStore()
    store.add(txDom("a", "/api/dashboard", "admin", { pageVisitedBy: ["admin", "member"] }))
    store.add(txDom("b", "/api/dashboard", "member", { pageVisitedBy: ["admin", "member"] }))
    const inv = inventory(store)
    const fn = inv.functions.find((f) => f.endpoint.includes("dashboard"))!
    expect(fn.roleProvenance).toEqual({ admin: "crawl", member: "crawl" })
    expect(allRolesCrawled(fn.roleProvenance)).toBe(true)
  })

  test("elementRoles takes precedence over pageVisitedBy: page shared but button admin-only", () => {
    const store = new MemoryStore()
    store.add(txDom("a", "/api/users/42", "admin", { pageVisitedBy: ["admin", "member"], elementRoles: ["admin"] }))
    store.add(txDom("b", "/api/users/42", "member", { pageVisitedBy: ["admin", "member"], elementRoles: ["admin"] }))
    const inv = inventory(store)
    const fn = inv.functions.find((f) => f.endpoint.includes("users"))!
    expect(fn.roleProvenance).toEqual({ admin: "crawl", member: "forced" })
    expect(allRolesCrawled(fn.roleProvenance)).toBe(false)
  })

  test("elementRoles includes both roles → shared=true", () => {
    const store = new MemoryStore()
    store.add(txDom("a", "/api/profile", "admin", { elementRoles: ["admin", "member"] }))
    store.add(txDom("b", "/api/profile", "member", { elementRoles: ["admin", "member"] }))
    const inv = inventory(store)
    const fn = inv.functions.find((f) => f.endpoint.includes("profile"))!
    expect(fn.roleProvenance).toEqual({ admin: "crawl", member: "crawl" })
    expect(allRolesCrawled(fn.roleProvenance)).toBe(true)
  })

  test("no DOM signals → falls back to tx.source as before", () => {
    const store = new MemoryStore()
    store.add(txDom("a", "/api/settings", "admin", {}))
    store.add(txDom("b", "/api/settings", "member", { source: "replay" }))
    const inv = inventory(store)
    const fn = inv.functions.find((f) => f.endpoint.includes("settings"))!
    expect(fn.roleProvenance).toEqual({ admin: "crawl", member: "forced" })
    expect(allRolesCrawled(fn.roleProvenance)).toBe(false)
  })

  test("object-level DOM provenance: admin-only button triggers request on shared page", () => {
    const store = new MemoryStore()
    store.add(txDom("a", "/api/orders/42", "admin", { pageVisitedBy: ["admin", "member"], elementRoles: ["admin"] }))
    store.add(txDom("b", "/api/orders/42", "member", { pageVisitedBy: ["admin", "member"], elementRoles: ["admin"] }))
    const inv = inventory(store)
    const obj = inv.objects.find((o) => o.ref === "orders:42")!
    expect(obj.roleProvenance).toEqual({ admin: "crawl", member: "forced" })
    expect(allRolesCrawled(obj.roleProvenance)).toBe(false)
  })
})
