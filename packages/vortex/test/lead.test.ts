import { describe, expect, test } from "bun:test"
import type { Transaction, Signal } from "../src/index"
import { lead, leads, MemoryStore } from "../src/index"

function tx(id: string, over: Partial<Transaction["request"]> & { method?: string }, identity?: string, response?: Transaction["response"]): Transaction {
  return { id, source: "browser", host: "app.test", identity, request: { method: over.method ?? "GET", url: over.url ?? "https://app.test/x", headers: over.headers ?? [], body: over.body }, response }
}
const sig = (transactionId: string, over: Partial<Signal> = {}): Signal => ({ ruleId: "sql-error", transactionId, severity: "high", category: "injection", title: "SQL error", evidence: "500", ...over })

describe("lead — the agent boundary object", () => {
  test("bundles signal + function + objects + role + replay-safety + inline raw", () => {
    const t = tx("tx_42", { method: "POST", url: "https://app.test/api/orders/42", headers: [{ name: "content-type", value: "application/json" }], body: '{"note":"x"}' }, "org1-admin", { status: 500, headers: [], body: "SQL syntax error" })
    const l = lead(t, sig("tx_42"))
    expect(l.transactionId).toBe("tx_42")
    expect(l.signal.title).toBe("SQL error")
    expect(l.function).toEqual({ method: "POST", endpoint: "POST app.test/api/orders/{id}", crud: "create" })
    expect(l.objects.map((o) => o.ref)).toEqual(["orders:42"])
    expect(l.role).toBe("org1-admin")
    expect(l.replaySafe).toBe(true)
    expect(l.raw.request).toContain("POST https://app.test/api/orders/42") // raw INLINE
    expect(l.raw.response).toContain("SQL syntax error")
  })

  test("carries the replay-safety verdict so the agent knows before it tries", () => {
    const t = tx("tx_login", { method: "POST", url: "https://app.test/oauth/token" }, undefined, { status: 200, headers: [], body: "" })
    const l = lead(t, sig("tx_login"))
    expect(l.replaySafe).toBe(false)
    expect(l.reason).toContain("auth-exchange")
  })

  test("leads() resolves each signal's transaction from the store and skips missing ones", () => {
    const store = new MemoryStore()
    store.add(tx("a", { url: "https://app.test/api/users/7" }))
    store.add(tx("b", { url: "https://app.test/api/orders/9" }))
    store.addSignals([sig("a"), sig("b", { ruleId: "cors" }), sig("gone")]) // "gone" has no transaction
    const out = leads(store)
    expect(out.map((l) => l.transactionId).sort()).toEqual(["a", "b"]) // "gone" skipped
    expect(out.find((l) => l.transactionId === "a")!.objects.map((o) => o.ref)).toEqual(["users:7"])
  })

  test("leads() accepts a pre-filtered signal set (e.g. store.signals({category}))", () => {
    const store = new MemoryStore()
    store.add(tx("a", { url: "https://app.test/x" }))
    store.addSignals([sig("a", { category: "injection" }), sig("a", { ruleId: "hdr", category: "misconfiguration", title: "hdr" })])
    const injection = leads(store, store.signals({ category: "injection" }))
    expect(injection).toHaveLength(1)
    expect(injection[0]!.signal.category).toBe("injection")
  })
})
