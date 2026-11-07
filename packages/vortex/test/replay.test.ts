import { describe, expect, test } from "bun:test"
import type { Transaction } from "../src/index"
import { send, toRequest, buildRequest, defaultRegistry, MemoryStore, Engine } from "../src/index"

const enc = new TextEncoder()
// A stubbed transport: records what it was asked to send, returns a canned response. No network.
function stub(status = 200, headers: { name: string; value: string }[] = [], body = "") {
  const seen: { req: Engine.HttpMessage.Request; origin: string }[] = []
  const transport = async (req: Engine.HttpMessage.Request, origin: string): Promise<Engine.ReplayResponse.Result> => {
    seen.push({ req, origin })
    return { response: { version: "HTTP/1.1", status, reason: status === 200 ? "OK" : "", headers, body: enc.encode(body) }, timing: { totalMs: 3 } }
  }
  return { transport, seen }
}

const captured: Transaction = {
  id: "orig-1",
  session: "s",
  source: "browser",
  host: "app.test",
  identity: "org1",
  request: { method: "POST", url: "https://app.test/api/run?debug=1", headers: [{ name: "authorization", value: "Bearer secret" }, { name: "content-type", value: "application/json" }], body: '{"a":1}' },
  response: { status: 200, headers: [], body: "{}" },
}

describe("toRequest / buildRequest", () => {
  test("captured transaction → raw request + origin", () => {
    const { req, origin } = toRequest(captured)
    expect(origin).toBe("https://app.test")
    expect(req.method).toBe("POST")
    expect(req.target).toBe("/api/run?debug=1")
    expect(req.headers.some((h) => h.name === "authorization")).toBe(true)
  })
  test("fresh spec → raw request built from scratch", () => {
    const { req, origin } = buildRequest({ method: "get", url: "https://api.test/v1/x?q=1", headers: { "X-Api-Key": "k" } })
    expect(origin).toBe("https://api.test")
    expect(req.method).toBe("GET")
    expect(req.headers).toEqual([{ name: "X-Api-Key", value: "k" }])
  })
})

describe("send() — bridge to the engine (mock transport)", () => {
  test("replays a captured request and returns a 'replay' transaction derivedFrom the origin", async () => {
    const t = stub(200, [{ name: "server", value: "nginx" }], '{"ok":true}')
    const { transaction, result } = await send(captured, { transport: t.transport })
    expect(result.response?.status).toBe(200)
    expect(transaction.source).toBe("replay")
    expect(transaction.derivedFrom).toBe("orig-1")
    expect(transaction.identity).toBe("org1") // identity carried from the origin
    expect(transaction.session).toBe("s")
    expect(transaction.response?.status).toBe(200)
    expect(transaction.response?.body).toBe('{"ok":true}')
  })

  test("applies mutations before sending (auth-strip) — the transport sees the mutated request", async () => {
    const t = stub(401)
    await send(captured, { transport: t.transport, mutations: [{ op: "remove-header", name: "authorization" }] })
    expect(t.seen).toHaveLength(1)
    expect(t.seen[0].req.headers.some((h) => h.name.toLowerCase() === "authorization")).toBe(false)
  })

  test("a fresh built request can be sent", async () => {
    const t = stub(200, [], "pong")
    const { transaction } = await send({ url: "https://api.test/ping" }, { transport: t.transport, identity: "svc" })
    expect(transaction.request.url).toBe("https://api.test/ping")
    expect(transaction.identity).toBe("svc")
    expect(transaction.response?.body).toBe("pong")
  })

  test("the replay transaction drops into the store and the SAME rules run over it", async () => {
    const t = stub(200, [{ name: "content-type", value: "application/json" }], "{}") // no security headers, no server banner set here
    const { transaction } = await send(captured, { transport: t.transport })
    const store = new MemoryStore()
    store.add(transaction)
    const signals = defaultRegistry().analyze(store.all())
    // a bare API response → missing-security-headers fires on the replayed transaction, deterministically
    expect(signals.some((s) => s.ruleId === "missing-security-headers")).toBe(true)
  })
})
