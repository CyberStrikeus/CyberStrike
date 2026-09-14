import { describe, test, expect } from "bun:test"
import { probeMassAssign } from "../../../src/tool/inject-probe/probe/mass-assign"
import type { HttpSender } from "../../../src/tool/inject-probe/send"
import type { ResolvedRequest, SendBudget } from "../../../src/tool/inject-probe/types"

const makeR = (opts: Partial<ResolvedRequest> = {}): ResolvedRequest => ({
  method: opts.method ?? "POST",
  url: opts.url ?? new URL("http://example.com/api/users"),
  headers: opts.headers ?? {},
  body: opts.body ?? `{"name":"alice"}`,
  contentType: opts.contentType ?? "application/json",
  auth: { source: "none" },
  provenance: { fromRaw: false, reconstructed: false, bodyMaybeTruncated: false },
})
const budget = (max = 60): SendBudget => ({ sent: 0, max })
const sig = () => new AbortController().signal

// A naive API that echoes the SUBMITTED object back — i.e. it binds every field it's given (mass-assignment).
const echoSender: HttpSender = { send: async (req) => ({ status: 200, body: req.body ?? "", headers: {} }) }
// A safe API that ignores the body and returns a fixed object (unknown fields dropped).
const safeSender: HttpSender = { send: async () => ({ status: 200, body: `{"id":1,"name":"alice"}`, headers: {} }) }

describe("probeMassAssign (WSTG-INPV-20)", () => {
  test("JSON body that echoes back → privileged fields report as BOUND", async () => {
    const obs = await probeMassAssign(echoSender, makeR(), sig(), 0, budget())
    expect(obs.content_type).toBe("json")
    const boundFields = obs.bound.map((b) => b.field)
    expect(boundFields).toContain("role")
    expect(boundFields).toContain("is_admin")
    expect(obs.bound[0]!.evidence.length).toBeGreaterThan(0) // an excerpt around the echoed marker
  })

  test("safe API that drops unknown fields → nothing bound", async () => {
    const obs = await probeMassAssign(safeSender, makeR(), sig(), 0, budget())
    expect(obs.bound).toEqual([])
    expect(obs.tried).toBeGreaterThan(0) // it DID probe (not a false negative from skipping)
  })

  test("form-urlencoded body is supported", async () => {
    const r = makeR({ contentType: "application/x-www-form-urlencoded", body: "name=alice" })
    const obs = await probeMassAssign(echoSender, r, sig(), 0, budget())
    expect(obs.content_type).toBe("form")
    expect(obs.bound.map((b) => b.field)).toContain("role")
  })

  test("GET request → no probing, explains it needs a write body", async () => {
    const obs = await probeMassAssign(echoSender, makeR({ method: "GET", body: "" }), sig(), 0, budget())
    expect(obs.note).toContain("write body")
    expect(obs.tried).toBe(0) // the write-method guard fires before any field is probed
  })

  test("non-JSON/non-form body → unsupported with a note, no sends", async () => {
    const r = makeR({ contentType: "text/xml", body: "<user><name>alice</name></user>" })
    const obs = await probeMassAssign(echoSender, r, sig(), 0, budget())
    expect(obs.content_type).toBe("unsupported")
    expect(obs.tried).toBe(0)
  })

  test("blocked baseline (403) → flagged blocked, no field probing", async () => {
    const blocker: HttpSender = { send: async () => ({ status: 403, body: "forbidden", headers: {} }) }
    const obs = await probeMassAssign(blocker, makeR(), sig(), 0, budget())
    expect(obs.blocked).toBe(true)
    expect(obs.tried).toBe(0)
  })

  test("respects the send budget", async () => {
    const b = budget(3) // baseline + 2 fields
    const obs = await probeMassAssign(echoSender, makeR(), sig(), 0, b)
    expect(obs.tried).toBeLessThanOrEqual(2)
    expect(b.sent).toBeLessThanOrEqual(3)
  })
})
