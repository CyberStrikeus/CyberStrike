import { describe, expect, test } from "bun:test"
import type { Transaction, SendResult, Sender } from "../src/index"
import { injectPoints, probeInjectPoints, probeSession, leads, MemoryStore } from "../src/index"

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

  test("phase 3: probe signal carries structured param, and leads() surfaces it as lead.parameter", async () => {
    const t = tx("L1", "https://app.test/items?id=5")
    const store = new MemoryStore()
    store.add(t)
    const s = makeSender((_i, opts) => (opts?.mutations?.[0]?.op === "set-query" ? { body: "you have an error in your SQL syntax" } : { body: "ok" }))
    const sigs = await probeInjectPoints(injectPoints(t), (id) => store.get(id), s.send)
    const sql = sigs.find((x) => x.ruleId === "sqli-error")!
    // signal carries the exact parameter, not just prose
    expect(sql.param).toEqual({ location: "query", dotpath: "id", name: "id" })
    // and a lead surfaces it structurally for the agent
    store.addSignals(sigs)
    const injectionLeads = leads(store, store.signals({ category: "injection" }))
    const lead = injectionLeads.find((l) => l.signal.ruleId === "sqli-error")!
    expect(lead.parameter).toEqual({ location: "query", dotpath: "id", name: "id" })
    expect(lead.transactionId).toBe("L1")
    expect(lead.replaySafe).toBe(true)
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

describe("probe strategies — full vs isolated", () => {
  test("a sibling param masks the sink in full context; the isolated pass reaches it", async () => {
    const t = tx("iso1", "https://app.test/items?id=5&gate=block")
    const cov: { paramId: string; payloadClass: string; result: string; strategy?: string }[] = []
    // The SQL error only surfaces when `gate` is blanked (isolation) AND `id` carries a real payload.
    const s = makeSender((_i, opts) => {
      const muts = opts?.mutations ?? []
      const idMut = muts.find((m) => m.op === "set-query" && m.name === "id")
      const gateBlanked = muts.some((m) => m.op === "set-query" && m.name === "gate" && m.value === "")
      if (idMut && idMut.value !== "" && gateBlanked) return { body: "you have an error in your SQL syntax" }
      return { body: "ok" }
    })
    const sigs = await probeInjectPoints(injectPoints(t), resolver(t), s.send, { classes: ["sqli-error"], onResult: (c) => cov.push(c) })
    const sql = sigs.filter((x) => x.ruleId === "sqli-error")
    expect(sql).toHaveLength(1)
    expect(sql[0].evidence).toContain("[isolated]")
    expect(sql[0].param).toEqual({ location: "query", dotpath: "id", name: "id" })
    const idCov = cov.find((c) => c.paramId === "iso1:query:id")
    expect(idCov?.result).toBe("hit")
    expect(idCov?.strategy).toBe("isolated")
  })

  test("full-context hit does not escalate to isolation (strategy=full)", async () => {
    const t = tx("iso2", "https://app.test/items?id=5&other=x")
    const cov: { paramId: string; strategy?: string }[] = []
    const s = makeSender((_i, opts) => (opts?.mutations?.some((m) => m.op === "set-query" && m.name === "id" && m.value !== "") ? { body: "you have an error in your SQL syntax" } : { body: "ok" }))
    const sigs = await probeInjectPoints(injectPoints(t), resolver(t), s.send, { classes: ["sqli-error"], onResult: (c) => cov.push(c) })
    expect(sigs.find((x) => x.ruleId === "sqli-error")?.evidence).toContain("[full]")
    expect(cov.find((c) => c.paramId === "iso2:query:id")?.strategy).toBe("full")
  })
})

describe("probeSession — store-driven probing + coverage (phase 4)", () => {
  test("persists signals + per-(param,class) coverage and marks points probed", async () => {
    const store = new MemoryStore()
    const t = tx("S1", "https://app.test/items?id=5")
    store.add(t)
    store.addInjectPoints(injectPoints(t)) // 1 query point "id"
    const s = makeSender((_i, opts) => (opts?.mutations?.[0]?.op === "set-query" ? { body: "you have an error in your SQL syntax" } : { body: "ok" }))

    const res = await probeSession(store, s.send)

    // a signal was produced + persisted
    expect(res.signals.some((x) => x.ruleId === "sqli-error")).toBe(true)
    expect(store.signals({ category: "injection" }).length).toBeGreaterThan(0)
    // coverage: one row per class attempted on the point; the sqli one is a hit, the rest clean
    const cov = store.coverage({ transactionId: "S1" })
    expect(cov.length).toBe(4) // sqli-error, xss-reflected, ssti, path-traversal
    expect(cov.find((c) => c.payloadClass === "sqli-error")?.result).toBe("hit")
    expect(cov.find((c) => c.payloadClass === "xss-reflected")?.result).toBe("clean")
    // the point is now marked probed
    expect(store.injectPoints({ probed: true }).length).toBe(1)
    expect(store.injectPoints({ probed: false }).length).toBe(0)
  })

  test("onlyUnprobed default skips already-probed points on a second pass", async () => {
    const store = new MemoryStore()
    const t = tx("S2", "https://app.test/items?id=5")
    store.add(t)
    store.addInjectPoints(injectPoints(t))
    const s = makeSender(() => ({ body: "ok" }))
    await probeSession(store, s.send) // marks probed
    const before = s.calls.length
    await probeSession(store, s.send) // second pass: nothing unprobed → no new sends
    expect(s.calls.length).toBe(before)
  })

  test("replay-unsafe points are never marked probed (retryable later)", async () => {
    const store = new MemoryStore()
    const t = tx("S3", "https://app.test/api/login?next=x")
    store.add(t)
    store.addInjectPoints(injectPoints(t))
    const s = makeSender(() => ({ body: "ok" }))
    const res = await probeSession(store, s.send)
    expect(res.probed).toBe(0)
    expect(store.injectPoints({ probed: true }).length).toBe(0)
    expect(store.coverage().length).toBe(0)
  })
})
