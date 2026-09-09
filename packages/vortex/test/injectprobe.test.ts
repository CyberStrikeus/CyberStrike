import { describe, expect, test } from "bun:test"
import type { Transaction, SendResult, Sender } from "../src/index"
import { injectPoints, probeInjectPoints } from "../src/index"

function tx(id: string, url: string): Transaction {
  return { id, session: "s1", source: "browser", host: "app.test", request: { method: "GET", url, headers: [] }, response: { status: 200, headers: [], body: "ok" } }
}

type Reply = { body?: string; canaryReflected?: boolean; canaryToken?: string }
type Opts = { mutations?: { op: string; name?: string; value?: string }[]; canary?: unknown } | undefined

// A network-free sender. `reply(input, opts)` decides the probe response from the mutation it was
// asked to send; opts === undefined is the baseline call. Records calls for assertions.
function makeSender(reply: (input: Transaction, opts: Opts) => Reply): { send: Sender; calls: { input: Transaction; opts: Opts }[] } {
  const calls: { input: Transaction; opts: Opts }[] = []
  const send: Sender = async (input, opts) => {
    calls.push({ input: input as Transaction, opts: opts as Opts })
    const r = reply(input as Transaction, opts as Opts)
    const txn: Transaction = { ...(input as Transaction), response: { status: 200, headers: [], body: r.body ?? "ok" } }
    return {
      transaction: txn,
      result: { response: { version: "HTTP/1.1", status: 200, reason: "OK", headers: [], body: new Uint8Array() }, timing: { totalMs: 1 }, attempts: 1 },
      canaryReflected: r.canaryReflected,
      canary: r.canaryToken ? ({ token: r.canaryToken, kind: "generic", vulnClass: "injection" } as never) : undefined,
    } as SendResult
  }
  return { send, calls }
}

function resolver(...txs: Transaction[]) {
  const m = new Map(txs.map((t) => [t.id, t]))
  return (id: string) => m.get(id)
}

describe("probeInjectPoints — inventory-driven injection probing", () => {
  test("SQL error surfaced by a query-param payload → sqli-error signal naming the param", async () => {
    const t = tx("q1", "https://app.test/items?id=5")
    const pts = injectPoints(t)
    const s = makeSender((_i, opts) => {
      const m = opts?.mutations?.[0]
      if (m?.op === "set-query" && m.name === "id") return { body: "Warning: you have an error in your SQL syntax near ''' at line 1" }
      return { body: "ok" } // baseline + non-triggering payloads
    })
    const sigs = await probeInjectPoints(pts, resolver(t), s.send)
    const sql = sigs.filter((x) => x.ruleId === "sqli-error")
    expect(sql).toHaveLength(1)
    expect(sql[0].severity).toBe("high")
    expect(sql[0].evidence).toContain("query.id")
    expect(sql[0].title).toContain("(query id)")
  })

  test("no signal when nothing repros (clean body everywhere)", async () => {
    const t = tx("q2", "https://app.test/items?id=5&q=x")
    const s = makeSender(() => ({ body: "ok clean" }))
    const sigs = await probeInjectPoints(injectPoints(t), resolver(t), s.send)
    expect(sigs).toHaveLength(0)
  })

  test("error detection is DIFFERENTIAL — an error already in the baseline is not a finding", async () => {
    const t = tx("q3", "https://app.test/items?id=5")
    // Baseline ALSO contains the SQL error string → payload doesn't introduce it → no signal.
    const s = makeSender(() => ({ body: "you have an error in your SQL syntax (always shown)" }))
    const sigs = await probeInjectPoints(injectPoints(t), resolver(t), s.send)
    expect(sigs.filter((x) => x.ruleId === "sqli-error")).toHaveLength(0)
  })

  test("reflected canary on a query param → xss-reflected signal", async () => {
    const t = tx("x1", "https://app.test/search?q=hello")
    const s = makeSender((_i, opts) => (opts?.canary ? { body: "reflected", canaryReflected: true, canaryToken: "TOK" } : { body: "ok" }))
    const sigs = await probeInjectPoints(injectPoints(t), resolver(t), s.send)
    const xss = sigs.filter((x) => x.ruleId === "xss-reflected")
    expect(xss).toHaveLength(1)
    expect(xss[0].evidence).toContain("query.q")
  })

  test("replay-unsafe request (auth endpoint) is never probed", async () => {
    const t = tx("a1", "https://app.test/api/login?next=x")
    const s = makeSender(() => ({ body: "you have an error in your SQL syntax" }))
    const sigs = await probeInjectPoints(injectPoints(t), resolver(t), s.send)
    expect(s.calls).toHaveLength(0) // guard fired before any send
    expect(sigs).toHaveLength(0)
  })

  test("path-param SQLi (the id-in-path case) fires with the path index named", async () => {
    const t = tx("p1", "https://app.test/orders/12345")
    const pts = injectPoints(t)
    const s = makeSender((_i, opts) => {
      const m = opts?.mutations?.[0]
      if (m?.op === "set-path-param" && m.name === "2") return { body: "ORA-00933: SQL command not properly ended" }
      return { body: "ok" }
    })
    const sigs = await probeInjectPoints(pts, resolver(t), s.send)
    const sql = sigs.filter((x) => x.ruleId === "sqli-error")
    expect(sql).toHaveLength(1)
    expect(sql[0].evidence).toContain("path.2")
  })
})
