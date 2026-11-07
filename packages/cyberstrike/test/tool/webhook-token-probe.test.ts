import { describe, expect, test } from "bun:test"
import { TokenAcceptanceProbe, type HttpSender, type ProbeRequest, type ProbeResponse } from "../../src/tool/webhook/authn/probe"
import { Jwt } from "../../src/tool/webhook/authn/jwt"

const SECRET = "serversecret"
const REAL = Jwt.signHS256({ typ: "JWT" }, { sub: "5", role: "user" }, SECRET)

function authValue(headers: Record<string, string>): string | undefined {
  for (const k in headers) if (k.toLowerCase() === "authorization") return headers[k]
  return undefined
}

// A sender that models a real, auth-gated server: it accepts a valid HS256 signature
// AND (the vuln) an unsigned alg:none token; everything else is 401.
function gatedServer(): HttpSender {
  return {
    async send(req: ProbeRequest): Promise<ProbeResponse> {
      const auth = authValue(req.headers)
      if (!auth) return { status: 401, headers: {}, body: "missing token" }
      const tok = auth.replace(/^Bearer /, "")
      const d = Jwt.tryDecode(tok)
      const isNone = !("error" in d) && String(d.header.alg).toLowerCase() === "none"
      if (isNone || Jwt.verifyHS256(tok, SECRET)) return { status: 200, headers: {}, body: "authorized" }
      return { status: 401, headers: {}, body: "bad signature" }
    },
  }
}

const baseReq = (): ProbeRequest => ({
  method: "GET",
  url: "https://api.example.com/me",
  headers: { Authorization: `Bearer ${REAL}`, Accept: "application/json" },
})

describe("TokenAcceptanceProbe — acceptance oracle", () => {
  test("flags an accepted alg:none forgery, not a properly-rejected one", async () => {
    const probe = new TokenAcceptanceProbe(gatedServer())
    const candidates = [
      { name: "alg-none", token: Jwt.encodeNone({ alg: "HS256" }, { sub: "5", role: "admin" }) },
      { name: "hs-wrongkey", token: Jwt.signHS256({}, { sub: "5", role: "admin" }, "wrongkey") },
    ]
    const report = await probe.run({ request: baseReq(), authHeader: "authorization", candidates })

    expect(report.authGated).toBe(true) // no-token → 401
    expect(report.baselineStatus).toBe(200)
    expect(report.unauthStatus).toBe(401)

    const none = report.results.find((r) => r.candidate === "alg-none")!
    const bad = report.results.find((r) => r.candidate === "hs-wrongkey")!
    expect(none.accepted).toBe(true)
    expect(none.status).toBe(200)
    expect(bad.accepted).toBe(false)
    expect(bad.status).toBe(401)
  })

  test("redirect-based auth (302 → /login) is a gate, and a 3xx is not an acceptance", async () => {
    // Server redirects unauthenticated/invalid tokens to /login (302); serves 200 only to valid.
    const redirectServer: HttpSender = {
      async send(req): Promise<ProbeResponse> {
        const tok = (authValue(req.headers) ?? "").replace(/^Bearer /, "")
        const d = Jwt.tryDecode(tok)
        const isNone = !("error" in d) && String(d.header.alg).toLowerCase() === "none"
        if (isNone || Jwt.verifyHS256(tok, SECRET)) return { status: 200, headers: {}, body: "ok" }
        return { status: 302, headers: { location: "/login" }, body: "" }
      },
    }
    const probe = new TokenAcceptanceProbe(redirectServer)
    const report = await probe.run({
      request: baseReq(),
      authHeader: "authorization",
      candidates: [
        { name: "alg-none", token: Jwt.encodeNone({}, { sub: "5", role: "admin" }) },
        { name: "hs-wrongkey", token: Jwt.signHS256({}, { sub: "5" }, "wrongkey") },
      ],
    })
    expect(report.authGated).toBe(true) // unauth → 302, NOT 2xx → gated
    expect(report.results.find((r) => r.candidate === "alg-none")!.accepted).toBe(true) // 200
    expect(report.results.find((r) => r.candidate === "hs-wrongkey")!.accepted).toBe(false) // 302 = not accepted
  })

  test("a PUBLIC endpoint (not auth-gated) never reports acceptance — the 'both 200' false positive", async () => {
    const publicServer: HttpSender = { async send() { return { status: 200, headers: {}, body: "public" } } }
    const probe = new TokenAcceptanceProbe(publicServer)
    const report = await probe.run({
      request: baseReq(),
      authHeader: "authorization",
      candidates: [{ name: "alg-none", token: Jwt.encodeNone({}, { sub: "5" }) }],
    })
    expect(report.authGated).toBe(false)
    expect(report.notGatedReason).toBeDefined()
    expect(report.results.every((r) => r.accepted === false)).toBe(true)
  })

  test("a secure server (rejects every forgery) yields no acceptances", async () => {
    const secure: HttpSender = {
      async send(req) {
        const auth = authValue(req.headers)
        const tok = (auth ?? "").replace(/^Bearer /, "")
        if (Jwt.verifyHS256(tok, SECRET)) return { status: 200, headers: {}, body: "ok" }
        return { status: 401, headers: {}, body: "no" }
      },
    }
    const probe = new TokenAcceptanceProbe(secure)
    const report = await probe.run({
      request: baseReq(),
      authHeader: "authorization",
      candidates: Jwt.escalationCandidates(REAL), // all alg:none forgeries
    })
    expect(report.authGated).toBe(true)
    expect(report.results.length).toBeGreaterThan(0)
    expect(report.results.every((r) => r.accepted === false)).toBe(true)
  })

  test("a transport error on a candidate is captured, not thrown", async () => {
    const flaky: HttpSender = {
      async send(req) {
        const auth = authValue(req.headers) ?? ""
        if (auth.includes("BOOM")) return { error: "connection reset" }
        if (!authValue(req.headers)) return { status: 401, headers: {}, body: "" }
        return { status: 200, headers: {}, body: "ok" }
      },
    }
    const probe = new TokenAcceptanceProbe(flaky)
    const report = await probe.run({
      request: baseReq(),
      authHeader: "authorization",
      candidates: [{ name: "boom", token: "BOOM" }],
    })
    const boom = report.results[0]
    expect(boom.error).toBe("connection reset")
    expect(boom.accepted).toBe(false)
    expect(boom.status).toBeNull()
  })

  test("auth header is swapped case-insensitively — exactly one auth header, carrying the forgery", async () => {
    let lastHeaders: Record<string, string> = {}
    const recorder: HttpSender = {
      async send(req) {
        lastHeaders = req.headers
        return authValue(req.headers) ? { status: 200, headers: {}, body: "" } : { status: 401, headers: {}, body: "" }
      },
    }
    const probe = new TokenAcceptanceProbe(recorder)
    await probe.run({
      request: baseReq(), // header key is "Authorization"
      authHeader: "authorization", // lower-case target
      candidates: [{ name: "x", token: "FORGED" }],
    })
    // last send = the candidate; must carry exactly one authorization header = the forgery
    const authKeys = Object.keys(lastHeaders).filter((k) => k.toLowerCase() === "authorization")
    expect(authKeys).toHaveLength(1)
    expect(lastHeaders[authKeys[0]]).toBe("Bearer FORGED")
  })

  test("empty tokenPrefix supports bare-token / non-Bearer headers", async () => {
    let seen = ""
    const recorder: HttpSender = {
      async send(req) {
        seen = authValue(req.headers) ?? ""
        return { status: 401, headers: {}, body: "" }
      },
    }
    const probe = new TokenAcceptanceProbe(recorder)
    await probe.run({
      request: baseReq(),
      authHeader: "authorization",
      candidates: [{ name: "x", token: "RAW" }],
      tokenPrefix: "",
    })
    expect(seen).toBe("RAW")
  })
})
