import { describe, expect, test } from "bun:test"
import type { Transaction, Vortex } from "../src/index"
import { MemoryStore, defaultRegistry, forAgent, agentCapabilities, Httpql, Engine } from "../src/index"

const b64u = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url")
function tx(id: string, over: Partial<Transaction["request"]> & { identity?: string; status?: number; respBody?: string }): Transaction {
  return {
    id,
    source: "browser",
    host: "app.test",
    identity: over.identity,
    request: { method: over.method ?? "GET", url: `https://app.test${over.url ?? "/x"}`, headers: over.headers ?? [] },
    response: { status: over.status ?? 200, headers: [], body: over.respBody ?? "" },
  }
}

function seeded(): { store: MemoryStore; api: Vortex } {
  const store = new MemoryStore()
  store.add(tx("sql", { method: "POST", url: "/api/orders/42", status: 500, respBody: "You have an error in your SQL syntax" }))
  // same object (accounts/9988) reached under two roles → a cross-role (IDOR) object
  store.add(tx("owner", { url: "/api/accounts/9988", identity: "org1", respBody: '{"balance":1}' }))
  store.add(tx("attacker", { url: "/api/accounts/9988", identity: "org2", respBody: '{"balance":1}' }))
  store.addSignals(defaultRegistry().analyze(store.all()))
  return { store, api: forAgent(store) }
}

describe("forAgent — the narrow agent facade", () => {
  test("leads() returns pre-computed findings with function/objects; category filter works", () => {
    const { api } = seeded()
    const all = api.leads()
    expect(all.length).toBeGreaterThan(0)
    const sql = api.leads({ category: "injection" }).find((l) => l.signal.ruleId === "sql-error-signature")!
    expect(sql.function.endpoint).toBe("POST app.test/api/orders/{id}")
    expect(sql.objects.map((o) => o.ref)).toContain("orders:42")
  })
  test("inspect() returns verbatim raw for one id", () => {
    const { api } = seeded()
    expect(api.inspect("sql")!.response).toContain("SQL syntax")
    expect(api.inspect("nope")).toBeUndefined()
  })
  test("search() is HTTPQL, grep-gated (raw rejected)", () => {
    const { api } = seeded()
    expect(api.search("resp.status:500").map((t) => t.id)).toEqual(["sql"])
    expect(() => api.search('raw:~"x"')).toThrow(Httpql.QueryError) // agent scope: no grep-everywhere
  })
  test("objects() + crossRole() surface the IDOR candidate", () => {
    const { api } = seeded()
    expect(api.objects({ resource: "accounts" }).length).toBeGreaterThan(0)
    // accounts:9988 reached under org1 AND org2 → cross-role (IDOR candidate)
    expect(api.crossRole().objects.some((o) => o.ref === "accounts:9988")).toBe(true)
  })
  test("whereValue() finds where a value flows across transactions", () => {
    const { api } = seeded()
    const occ = api.whereValue("9988")
    expect(occ.map((o) => o.transactionId).sort()).toEqual(["attacker", "owner"])
  })
  test("send() replays a captured request (via a transport stub) and returns a result", async () => {
    const { api } = seeded()
    const r = await api.send("sql", { transport: async () => ({ response: { version: "HTTP/1.1", status: 200, reason: "OK", headers: [], body: new TextEncoder().encode("ok") }, timing: { totalMs: 3 } }) })
    expect(r.result.response?.status).toBe(200)
    expect(r.transaction.source).toBe("replay") // a NEW transaction, original untouched
  })
})

describe("agentCapabilities — framework-neutral tool descriptors", () => {
  test("a curated, bounded set: names + descriptions + zod input, incl the two open-ended ones", () => {
    const names = agentCapabilities.map((c) => c.name)
    expect(names).toContain("vortex_query") // open-ended read
    expect(names).toContain("http_replay") // open-ended act
    expect(names).toContain("vortex_leads")
    expect(names).toContain("vortex_cross_role")
    for (const c of agentCapabilities) {
      expect(c.description.length).toBeGreaterThan(20)
      expect(typeof c.input.parse).toBe("function") // a real zod schema
    }
  })
  test("vortex_query capability runs against the facade", () => {
    const { api } = seeded()
    const cap = agentCapabilities.find((c) => c.name === "vortex_query")!
    const rows = cap.run(api, { httpql: "resp.status:500" }) as { id: string }[]
    expect(rows.map((r) => r.id)).toEqual(["sql"])
  })
  test("http_replay capability returns trimmed facts (via a stubbed facade)", async () => {
    const stub: Vortex = {
      ...forAgent(new MemoryStore()),
      send: async () =>
        ({
          transaction: { id: "vx_1", source: "replay", host: "app.test", request: { method: "GET", url: "https://app.test/x", headers: [] }, response: { status: 201, headers: [], body: "done" }, timing: { ms: 5 } },
          result: { response: { version: "HTTP/1.1", status: 201, reason: "", headers: [], body: new Uint8Array() }, timing: { totalMs: 5 } },
        }) as never,
    }
    const cap = agentCapabilities.find((c) => c.name === "http_replay")!
    const facts = (await cap.run(stub, { request_id: "x" })) as { status: number; transaction_id: string }
    expect(facts.status).toBe(201)
    expect(facts.transaction_id).toBe("vx_1")
  })
})
