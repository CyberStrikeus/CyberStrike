import { describe, expect, test } from "bun:test"
import { ApiProbe } from "../../../src/session/web/api-probe"
import { HttpMessage } from "../../../src/replay/message"
import { Send } from "../../../src/replay/send"
import { WebRetest } from "../../../src/session/web/web-retest"
import { Request } from "../../../src/session/request"
import { Session } from "../../../src/session"
import { Instance } from "../../../src/project/instance"
import { tmpdir } from "../../fixture/fixture"

async function withSession(fn: (sid: string) => Promise<void>) {
  await using dir = await tmpdir({ git: true })
  await Instance.provide({ directory: dir.path, fn: async () => fn((await Session.create({})).id) })
}

const raw = (line: string, extraHeaders = "") =>
  `${line} HTTP/1.1\r\nHost: app.example.com\r\n${extraHeaders}Accept: */*\r\n\r\n`

// A fake Send.Result carrying a response body + headers.
function reply(status: number, body: string, headers: Record<string, string> = {}): Send.Result {
  return {
    response: {
      version: "HTTP/1.1",
      status,
      reason: "",
      headers: Object.entries(headers).map(([name, value]) => ({ name, value })),
      body: new TextEncoder().encode(body),
    },
    timing: { totalMs: 1 },
    attempts: 1,
  }
}

describe("ApiProbe probe builders — pure request mutation", () => {
  test("auth-strip removes auth headers; skips an already-anonymous request", () => {
    const authed = HttpMessage.parse(raw("GET /api/x", "Authorization: Bearer t\r\nCookie: s=1\r\n"))
    const stripped = ApiProbe.PROBES.find((p) => p.name === "auth-strip")!.build(authed)!
    expect(stripped.headers.some((h) => h.name.toLowerCase() === "authorization")).toBe(false)
    expect(stripped.headers.some((h) => h.name.toLowerCase() === "cookie")).toBe(false)
    // no auth headers → probe does not apply
    expect(ApiProbe.PROBES.find((p) => p.name === "auth-strip")!.build(HttpMessage.parse(raw("GET /api/x")))).toBeNull()
  })

  test("error-canary injects a quote into query params; skips a param-less request", () => {
    const withQuery = HttpMessage.parse(raw("GET /api/search?q=hello&page=1"))
    const canary = ApiProbe.PROBES.find((p) => p.name === "error-canary")!.build(withQuery)!
    expect(canary.target).toContain("q=") // param preserved as a key
    expect(canary.target).toContain("'") // the raw quote is injected into the query (classic SQLi probe)
    expect(ApiProbe.PROBES.find((p) => p.name === "error-canary")!.build(HttpMessage.parse(raw("GET /api/noparams")))).toBeNull()
  })

  test("method-matrix swaps the method; skips when already that method", () => {
    const get = HttpMessage.parse(raw("GET /api/x"))
    expect(ApiProbe.PROBES.find((p) => p.name === "method-PUT")!.build(get)!.method).toBe("PUT")
    const put = HttpMessage.parse(raw("PUT /api/x"))
    expect(ApiProbe.PROBES.find((p) => p.name === "method-PUT")!.build(put)).toBeNull()
  })
})

describe("ApiProbe.runEndpoint — deterministic probe → signal fabric → specialist retest on hit", () => {
  test("an error-canary that elicits a SQL error queues a retest for the injection specialist", async () => {
    await withSession(async (sid) => {
      // A real captured endpoint carrying a query param (so the canary applies).
      const req = Request.add({ sessionID: sid, method: "GET", normalizedPath: "/api/items", keyHash: "k_items" })!
      const rawReq = raw("GET /api/items?id=1")

      // Fake sender: the error-canary (id=') elicits a DBMS error; everything else is clean.
      const send: ApiProbe.Sender = async (msg) => {
        if (msg.target.includes("'")) return reply(500, "You have an error in your SQL syntax near ''")
        return reply(200, "{}")
      }

      const results = await ApiProbe.runEndpoint({
        sessionID: sid,
        requestId: req.id,
        rawRequest: rawReq,
        origin: "https://app.example.com",
        send,
      })
      // the canary probe reported at least one signal
      const canary = results.find((r) => r.probe === "error-canary")!
      expect(canary.signals).toBeGreaterThan(0)

      // and a specialist retest was queued for this endpoint, routed to injection (sql_error owner)
      const pending = WebRetest.getPending(sid).find((r) => r.key_hash === "k_items")
      expect(pending).toBeDefined()
      expect(pending!.flags.signal?.some((v) => v.includes("sql_error") && v.includes("injection"))).toBe(true)
    })
  })

  test("all-clean probes queue nothing (no false retests)", async () => {
    await withSession(async (sid) => {
      const req = Request.add({ sessionID: sid, method: "GET", normalizedPath: "/api/ok", keyHash: "k_ok" })!
      const send: ApiProbe.Sender = async () => reply(200, "{}", { "content-type": "application/json" })
      await ApiProbe.runEndpoint({ sessionID: sid, requestId: req.id, rawRequest: raw("GET /api/ok?x=1"), origin: "https://app.example.com", send })
      expect(WebRetest.getPending(sid).length).toBe(0)
    })
  })
})
