import { describe, expect, test } from "bun:test"
import { ApiProbe } from "../../../src/session/web/api-probe"
import { HttpMessage } from "../../../src/replay/message"
import { Send } from "../../../src/replay/send"
import { WebRetest } from "../../../src/session/web/web-retest"
import { WebCredential } from "../../../src/session/web/web-credential"
import { WebScope } from "../../../src/session/web/scope"
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
        keyHash: "k_items", // a real captured row → signals queue a retest
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
      await ApiProbe.runEndpoint({ sessionID: sid, requestId: req.id, keyHash: "k_ok", rawRequest: raw("GET /api/ok?x=1"), origin: "https://app.example.com", send })
      expect(WebRetest.getPending(sid).length).toBe(0)
    })
  })
})

describe("ApiProbe — access-control evidence (deterministic replacement for cross-cred fan-out)", () => {
  test("auth-strip that still returns 2xx queues an access-control retest", async () => {
    await withSession(async (sid) => {
      const req = Request.add({ sessionID: sid, method: "GET", normalizedPath: "/api/me", keyHash: "k_me" })!
      // Every send returns 200 → the endpoint serves the same data with or without auth.
      const send: ApiProbe.Sender = async () => reply(200, "{}")
      await ApiProbe.runEndpoint({
        sessionID: sid,
        requestId: req.id,
        keyHash: "k_me",
        credentialId: "cred_owner",
        rawRequest: raw("GET /api/me", "Authorization: Bearer t\r\n"),
        origin: "https://app.example.com",
        send,
        accessControl: true,
      })
      const pending = WebRetest.getPending(sid).find((r) => r.key_hash === "k_me")
      expect(pending?.flags.signal?.some((v) => v.includes("unauth_access") && v.includes("access-control"))).toBe(true)
    })
  })

  test("cross-identity: another credential getting 2xx flags that credential (routes to authz+idor)", async () => {
    await withSession(async (sid) => {
      const req = Request.add({ sessionID: sid, method: "GET", normalizedPath: "/api/orders/1", keyHash: "k_ord" })!
      // org2 has auth for this host and gets 2xx to org1's resource → cross-tenant lead.
      const org2 = WebCredential.ensure({ sessionID: sid, label: "org2" })
      WebCredential.captureAuthFromRaw({ sessionID: sid, credentialID: org2.id, rawRequest: raw("GET /x", "Authorization: Bearer ORG2\r\n") })

      // baseline 2xx (owner), auth-strip 401 (auth enforced), cross-identity 2xx (BFLA).
      const send: ApiProbe.Sender = async (msg) => {
        const authz = msg.headers.find((h) => h.name.toLowerCase() === "authorization")?.value
        if (!authz) return reply(401, "unauthorized")
        return reply(200, "{}")
      }
      await ApiProbe.runEndpoint({
        sessionID: sid,
        requestId: req.id,
        keyHash: "k_ord",
        credentialId: "cred_org1",
        rawRequest: raw("GET /api/orders/1", "Authorization: Bearer ORG1\r\n"),
        origin: "https://app.example.com",
        send,
        accessControl: true,
      })
      const pending = WebRetest.getPending(sid).find((r) => r.key_hash === "k_ord")
      expect(pending?.flags.credential).toContain(org2.id) // the offending identity flagged
      // unauth was 401 → no unauth_access flag
      expect(pending?.flags.signal?.some((v) => v.includes("unauth_access"))).not.toBe(true)
    })
  })
})

describe("ApiProbe — mined-endpoint access-control scenario (authed + unauthed, materialize on hit)", () => {
  test("unauth JSON 2xx on a mined endpoint → materializes a js-mined row + flags broken access control", async () => {
    await withSession(async (sid) => {
      WebScope.ensure(sid, "https://app.example.com/")
      const org1 = WebCredential.ensure({ sessionID: sid, label: "org1" })
      WebCredential.captureAuthFromRaw({ sessionID: sid, credentialID: org1.id, rawRequest: raw("GET /x", "Authorization: Bearer ORG1\r\n") })

      // Endpoint returns JSON data with AND without auth → broken access control.
      const send: ApiProbe.Sender = async () => reply(200, '{"secret":"data"}', { "content-type": "application/json" })
      await ApiProbe.runEndpoint({
        sessionID: sid,
        requestId: "mined:GET:https://app.example.com/api/secrets",
        rawRequest: raw("GET /api/secrets"),
        origin: "https://app.example.com",
        method: "GET",
        send,
        minedAuthCheck: true,
      })
      // materialized as a real row so it can dispatch + report
      const req = Request.get(sid).find((r) => r.normalized_path === "/api/secrets")
      expect(req).toBeDefined()
      // flagged broken access control on that endpoint
      const pending = WebRetest.getPending(sid).find((r) => r.endpoint === "/api/secrets")
      expect(pending?.flags.signal?.some((v) => v.includes("unauth_access"))).toBe(true)
    })
  })

  test("SPA catch-all: unauth returns 200 + HTML shell → NOT flagged (no false positive)", async () => {
    await withSession(async (sid) => {
      WebScope.ensure(sid, "https://app.example.com/")
      const org1 = WebCredential.ensure({ sessionID: sid, label: "org1" })
      WebCredential.captureAuthFromRaw({ sessionID: sid, credentialID: org1.id, rawRequest: raw("GET /x", "Authorization: Bearer ORG1\r\n") })
      // Any path returns the SPA index.html with 200 — the classic false-positive trap.
      const send: ApiProbe.Sender = async () => reply(200, "<html>app shell</html>", { "content-type": "text/html" })
      await ApiProbe.runEndpoint({
        sessionID: sid,
        requestId: "mined:GET:https://app.example.com/api/whatever",
        rawRequest: raw("GET /api/whatever"),
        origin: "https://app.example.com",
        method: "GET",
        send,
        minedAuthCheck: true,
      })
      // HTML shell → not real API data → no materialization, no flag
      expect(Request.get(sid).find((r) => r.normalized_path === "/api/whatever")).toBeUndefined()
      expect(WebRetest.getPending(sid).length).toBe(0)
    })
  })
})

describe("ApiProbe.sweep — safety: only non-mutating methods are replayed autonomously", () => {
  test("probes GET endpoints; skips POST/PUT/DELETE (mutation left to the LLM)", async () => {
    await withSession(async (sid) => {
      const O = { origin: "https://app.example.com", scheme: "https" as const, host: "app.example.com" }
      Request.add({ sessionID: sid, method: "GET", normalizedPath: "/api/list", keyHash: "k_get", rawRequest: raw("GET /api/list?x=1"), ...O })
      Request.add({ sessionID: sid, method: "POST", normalizedPath: "/api/create", keyHash: "k_post", rawRequest: raw("POST /api/create"), ...O })
      Request.add({ sessionID: sid, method: "DELETE", normalizedPath: "/api/orders/1", keyHash: "k_del", rawRequest: raw("DELETE /api/orders/1"), ...O })

      const sent: string[] = []
      const send: ApiProbe.Sender = async (msg) => {
        sent.push(`${msg.method} ${msg.target}`)
        return reply(200, "{}")
      }
      const probed = await ApiProbe.sweep(sid, { send })
      expect(probed).toBe(1) // only the GET endpoint
      // no mutating method ever left the lane
      expect(sent.some((s) => s.startsWith("POST") || s.startsWith("PUT") || s.startsWith("DELETE"))).toBe(false)
    })
  })
})
