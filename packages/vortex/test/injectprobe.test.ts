import { describe, expect, test } from "bun:test"
import type { Transaction, SendResult, Sender, Header } from "../src/index"
import { injectPoints, probeInjectPoints, probeSession, leads, MemoryStore } from "../src/index"

function tx(id: string, url: string): Transaction {
  return { id, session: "s1", source: "browser", host: "app.test", request: { method: "GET", url, headers: [] }, response: { status: 200, headers: [], body: "ok" } }
}

type Reply = { body?: string; canaryReflected?: boolean; canaryToken?: string; status?: number; headers?: Header[]; ms?: number }
type Opts = { mutations?: { op: string; name?: string; value?: string }[]; canary?: unknown } | undefined

// A network-free sender. `reply(input, opts)` decides the probe response from the mutation it was
// asked to send; opts === undefined is the baseline call. Records calls for assertions. A reply may set
// response `status`/`headers` (redirect + CRLF detection) and `ms` (time-based detection).
function makeSender(reply: (input: Transaction, opts: Opts) => Reply): { send: Sender; calls: { input: Transaction; opts: Opts }[] } {
  const calls: { input: Transaction; opts: Opts }[] = []
  const send: Sender = async (input, opts) => {
    calls.push({ input: input as Transaction, opts: opts as Opts })
    const r = reply(input as Transaction, opts as Opts)
    const txn: Transaction = {
      ...(input as Transaction),
      response: { status: r.status ?? 200, headers: r.headers ?? [], body: r.body ?? "ok" },
      timing: r.ms !== undefined ? { ms: r.ms } : undefined,
    }
    return {
      transaction: txn,
      result: { response: { version: "HTTP/1.1", status: r.status ?? 200, reason: "OK", headers: [], body: new Uint8Array() }, timing: { totalMs: r.ms ?? 1 }, attempts: 1 },
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

describe("name/type targeting (#88 Phase B) — the select narrows a class to applicable points", () => {
  test("path-traversal fires on a file-ish STRING param but is SKIPPED on a numeric id", async () => {
    // `file` is a string → traversal applies; `id` is numeric → traversal skipped (no send for it).
    const t = tx("t1", "https://app.test/download?file=a.txt&id=5")
    const cov: { paramId: string; payloadClass: string; result: string }[] = []
    const s = makeSender((_i, opts) => {
      const m = opts?.mutations?.find((x) => x.op === "set-query" && x.name === "file")
      return m && m.value !== "a.txt" && m.value !== "" ? { body: "root:x:0:0:root:/root:/bin/bash" } : { body: "ok" }
    })
    const sigs = await probeInjectPoints(injectPoints(t), resolver(t), s.send, { onResult: (c) => cov.push(c) })
    // the traversal hit is on `file`, never attempted on `id`
    expect(sigs.some((x) => x.ruleId === "path-traversal" && x.param?.dotpath === "file")).toBe(true)
    expect(cov.some((c) => c.paramId === "t1:query:file" && c.payloadClass === "path-traversal")).toBe(true)
    expect(cov.some((c) => c.paramId === "t1:query:id" && c.payloadClass === "path-traversal")).toBe(false)
  })

  test("the numeric id is STILL anchored by the universal classes (no coverage lost)", async () => {
    const t = tx("t2", "https://app.test/items?id=5")
    const cov: { paramId: string; payloadClass: string }[] = []
    const s = makeSender(() => ({ body: "ok" }))
    await probeInjectPoints(injectPoints(t), resolver(t), s.send, { onResult: (c) => cov.push(c) })
    const forId = cov.filter((c) => c.paramId === "t2:query:id").map((c) => c.payloadClass).sort()
    expect(forId).toEqual(["sqli-error", "ssti", "xss-reflected"]) // universal classes still probe it
  })

  test("targeting REDUCES the attempted (point × class) matrix — the budget win", async () => {
    // One numeric + one id-shaped param: path-traversal matches neither → fewer sends than the
    // untargeted 2×4 matrix would make.
    const t = tx("t3", "https://app.test/items?id=5&page=2")
    const cov: { paramId: string; payloadClass: string }[] = []
    const s = makeSender(() => ({ body: "ok" }))
    await probeInjectPoints(injectPoints(t), resolver(t), s.send, { onResult: (c) => cov.push(c) })
    expect(cov.some((c) => c.payloadClass === "path-traversal")).toBe(false) // neither param is file-ish+string
    expect(cov.length).toBe(6) // 2 params × 3 universal classes, not 2×4
  })
})

describe("Phase A classes (#88) — open-redirect / CRLF / command-injection, end-to-end", () => {
  test("open-redirect: Location → the injected canary host fires on a `next` param", async () => {
    const t = tx("or1", "https://app.test/go?next=/home")
    const s = makeSender((_i, opts) => {
      const m = opts?.mutations?.find((x) => x.op === "set-query" && x.name === "next")
      // The redirect payload carries the canary host; the vulnerable app 302s to it.
      if (m?.value?.includes("vxredir")) return { status: 302, headers: [{ name: "location", value: "https://TOK.vxredir.test/x" }], canaryToken: "TOK" }
      return { body: "ok" }
    })
    const sigs = await probeInjectPoints(injectPoints(t), resolver(t), s.send)
    const redir = sigs.filter((x) => x.ruleId === "open-redirect")
    expect(redir).toHaveLength(1)
    expect(redir[0].param).toEqual({ location: "query", dotpath: "next", name: "next" })
    expect(redir[0].evidence).toContain("Location")
  })

  test("open-redirect is NOT attempted on a numeric id (targeting)", async () => {
    const t = tx("or2", "https://app.test/items?id=5")
    const cov: { payloadClass: string }[] = []
    const s = makeSender(() => ({ body: "ok" }))
    await probeInjectPoints(injectPoints(t), resolver(t), s.send, { onResult: (c) => cov.push(c) })
    expect(cov.some((c) => c.payloadClass === "open-redirect")).toBe(false)
  })

  test("CRLF: an injected header carrying the canary surfaces in the response → crlf-header", async () => {
    const t = tx("cr1", "https://app.test/r?url=/next")
    const s = makeSender((_i, opts) => {
      const m = opts?.mutations?.find((x) => x.op === "set-query" && x.name === "url")
      if (m?.value?.includes("x-vxcrlf")) return { headers: [{ name: "x-vxcrlf", value: "TOK" }], canaryToken: "TOK" }
      return { body: "ok" }
    })
    const sigs = await probeInjectPoints(injectPoints(t), resolver(t), s.send)
    const crlf = sigs.filter((x) => x.ruleId === "crlf-header")
    expect(crlf).toHaveLength(1)
    expect(crlf[0].severity).toBe("high")
    expect(crlf[0].param?.dotpath).toBe("url")
  })

  test("command-injection: a sleep payload that delays the response past the threshold → critical", async () => {
    const t = tx("ci1", "https://app.test/ping?host=127.0.0.1")
    const s = makeSender((_i, opts) => {
      const m = opts?.mutations?.find((x) => x.op === "set-query" && x.name === "host")
      if (m?.value?.includes("sleep")) return { ms: 6000 } // payload-induced delay
      return { ms: 10, body: "ok" } // baseline + non-sleep payloads are fast
    })
    const sigs = await probeInjectPoints(injectPoints(t), resolver(t), s.send)
    const ci = sigs.filter((x) => x.ruleId === "command-injection")
    expect(ci).toHaveLength(1)
    expect(ci[0].severity).toBe("critical")
    expect(ci[0].evidence).toContain("delayed")
  })

  test("command-injection does NOT fire when the response is fast (no false positive)", async () => {
    const t = tx("ci2", "https://app.test/ping?host=127.0.0.1")
    const s = makeSender(() => ({ ms: 12, body: "ok" })) // every send is fast, incl. the sleep payload
    const sigs = await probeInjectPoints(injectPoints(t), resolver(t), s.send)
    expect(sigs.filter((x) => x.ruleId === "command-injection")).toHaveLength(0)
  })

  test("command-injection is NOT attempted on a non-cmd param (targeting)", async () => {
    const t = tx("ci3", "https://app.test/search?title=hello")
    const cov: { payloadClass: string }[] = []
    const s = makeSender(() => ({ body: "ok" }))
    await probeInjectPoints(injectPoints(t), resolver(t), s.send, { onResult: (c) => cov.push(c) })
    expect(cov.some((c) => c.payloadClass === "command-injection")).toBe(false)
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

describe("resilience — send failures + baseline gaps (C1 / B2)", () => {
  test("C1: a throwing send is skipped, not fatal — other txs still probed", async () => {
    const tA = tx("bad", "https://app.test/a?id=1")
    const tB = tx("good", "https://app.test/b?id=2")
    const s: Sender = async (input, opts) => {
      const t = input as Transaction
      if (t.id === "bad") throw new Error("connection reset") // every send for tA fails
      const isPayload = (opts?.mutations ?? []).some((m) => (m as { op: string; name?: string; value?: string }).op === "set-query" && (m as { name?: string }).name === "id" && (m as { value?: string }).value !== "")
      return {
        transaction: { ...t, response: { status: 200, headers: [], body: isPayload ? "you have an error in your SQL syntax" : "ok" } },
        result: { response: { version: "HTTP/1.1", status: 200, reason: "OK", headers: [], body: new Uint8Array() }, timing: { totalMs: 1 }, attempts: 1 },
      } as SendResult
    }
    const points = [...injectPoints(tA), ...injectPoints(tB)]
    const sigs = await probeInjectPoints(points, resolver(tA, tB), s, { classes: ["sqli-error"] })
    expect(sigs.some((x) => x.transactionId === "good")).toBe(true) // tB found despite tA throwing on every send
    expect(sigs.some((x) => x.transactionId === "bad")).toBe(false)
  })

  test("B2: no baseline (baseline send failed) does NOT fire an error signal (avoids false positive)", async () => {
    const t = tx("nb", "https://app.test/x?id=1")
    const s: Sender = async (input, opts) => {
      if (!opts?.mutations) throw new Error("baseline timeout") // baseline send fails → baseline undefined
      // every probe returns an error string — but with no baseline we cannot diff, so must not fire
      return {
        transaction: { ...(input as Transaction), response: { status: 200, headers: [], body: "you have an error in your SQL syntax" } },
        result: { response: { version: "HTTP/1.1", status: 200, reason: "OK", headers: [], body: new Uint8Array() }, timing: { totalMs: 1 }, attempts: 1 },
      } as SendResult
    }
    const sigs = await probeInjectPoints(injectPoints(t), resolver(t), s, { classes: ["sqli-error"] })
    expect(sigs.filter((x) => x.ruleId === "sqli-error")).toHaveLength(0)
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
    // coverage: one row per class ATTEMPTED on the point. The point is a numeric `id`, so the
    // targeted path-traversal class (file/path-ish names, string/empty types — #88) is SKIPPED: no
    // send, no coverage row. The universal classes still anchor the point.
    const cov = store.coverage({ transactionId: "S1" })
    expect(cov.length).toBe(3) // sqli-error, xss-reflected, ssti — NOT path-traversal (skipped by select)
    expect(cov.find((c) => c.payloadClass === "path-traversal")).toBeUndefined()
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
