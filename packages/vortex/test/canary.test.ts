import { describe, expect, test } from "bun:test"
import type { Transaction, Canary } from "../src/index"
import { send, MemoryStore, scanStored, scanCanaries, mintCanary, Engine } from "../src/index"

// A transport that ECHOES the request back in the response body (so an injected canary reflects).
const echo = async (req: Engine.HttpMessage.Request): Promise<Engine.ReplayResponse.Result> => {
  const raw = new TextDecoder().decode(Engine.HttpMessage.serialize(req))
  return { response: { version: "HTTP/1.1", status: 200, reason: "OK", headers: [], body: new TextEncoder().encode(raw) }, timing: { totalMs: 1 } }
}
const silent = async (): Promise<Engine.ReplayResponse.Result> => ({ response: { version: "HTTP/1.1", status: 200, reason: "OK", headers: [], body: new TextEncoder().encode("nothing here") }, timing: { totalMs: 1 } })

const target: Transaction = {
  id: "orig",
  session: "s",
  source: "browser",
  host: "app.test",
  request: { method: "GET", url: "https://app.test/search?q=hi", headers: [] },
  response: { status: 200, headers: [], body: "" },
}

describe("mintCanary", () => {
  test("tokens are unique + alphanumeric (survive encoding)", () => {
    const a = mintCanary(),
      b = mintCanary()
    expect(a).not.toBe(b)
    expect(a).toMatch(/^cs[a-z0-9]+$/)
  })
})

describe("send() canary — same-request reflection", () => {
  test("substitutes {canary} into the payload and detects same-request reflection", async () => {
    const r = await send(target, { mutations: [{ op: "set-query", name: "q", value: "<x>{canary}</x>" }], canary: { field: "q", vulnClass: "xss" }, transport: echo })
    expect(r.canary).toBeDefined()
    expect(r.canaryReflected).toBe(true) // echoed back
    expect(r.transaction.request.url).toContain(r.canary!.token) // {canary} was substituted with the real token
  })
  test("canaryReflected is false when the response does not echo it", async () => {
    const r = await send(target, { mutations: [{ op: "set-query", name: "q", value: "{canary}" }], canary: {}, transport: silent })
    expect(r.canaryReflected).toBe(false)
  })
})

describe("scanCanaries / scanStored — cross-request (stored) reflection", () => {
  test("a canary rendered in a DIFFERENT observed response → stored-reflection signal", async () => {
    const store = new MemoryStore()
    const r = await send(target, { mutations: [{ op: "set-query", name: "q", value: "{canary}" }], canary: { field: "q" }, transport: silent })
    store.addCanaries([r.canary!]) // register the injection
    // later, an OBSERVED page renders that token (e.g. an admin activity feed)
    const rendered: Transaction = { id: "feed", source: "browser", host: "app.test", request: { method: "GET", url: "https://app.test/admin/feed", headers: [] }, response: { status: 200, headers: [], body: `latest search: ${r.canary!.token}` } }
    store.add(rendered)
    const sigs = scanStored(store)
    expect(sigs).toHaveLength(1)
    expect(sigs[0].ruleId).toBe("stored-reflection")
    expect(store.signals({ ruleId: "stored-reflection" })).toHaveLength(1)
  })

  test("same-request reflection is NOT counted as stored", () => {
    const c: Canary = { token: "cstok1", kind: "reflect", originRequestId: "t1", endpoint: "GET app.test/x", createdAt: 0 }
    const sameReq: Transaction = { id: "t1", source: "browser", host: "app.test", request: { method: "GET", url: "https://app.test/x", headers: [] }, response: { status: 200, headers: [], body: "echo cstok1" } }
    expect(scanCanaries([sameReq], [c])).toHaveLength(0) // same id as originRequestId
  })

  test("agent-safety: a replay echo is NOT counted (only observed responses scanned)", () => {
    const c: Canary = { token: "cstok2", kind: "reflect", originRequestId: "orig", endpoint: "GET app.test/x", createdAt: 0 }
    const replayEcho: Transaction = { id: "vx_9", source: "replay", host: "app.test", request: { method: "GET", url: "https://app.test/x", headers: [] }, response: { status: 200, headers: [], body: "echo cstok2" } }
    expect(scanCanaries([replayEcho], [c])).toHaveLength(0) // replay excluded
  })
})
