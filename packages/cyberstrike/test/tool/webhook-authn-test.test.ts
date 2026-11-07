import { describe, expect, test } from "bun:test"
import { AuthnTest, extractBearer } from "../../src/tool/webhook/authn/authn-test"
import { Jwt } from "../../src/tool/webhook/authn/jwt"
import type { HttpSender, ProbeRequest, ProbeResponse } from "../../src/tool/webhook/authn/probe"

const SECRET = "secret" // deliberately weak — in Jwt.WEAK_SECRETS
const REAL = Jwt.signHS256({ typ: "JWT" }, { sub: "5", role: "user" }, SECRET)

function authValue(headers: Record<string, string>): string | undefined {
  for (const k in headers) if (k.toLowerCase() === "authorization") return headers[k]
  return undefined
}

// Vulnerable gated server: accepts a valid HS256 signature AND (the bug) alg:none.
function vulnServer(): HttpSender {
  return {
    async send(req: ProbeRequest): Promise<ProbeResponse> {
      const auth = authValue(req.headers)
      if (!auth) return { status: 401, headers: {}, body: "no token" }
      const tok = auth.replace(/^Bearer /, "")
      const d = Jwt.tryDecode(tok)
      const isNone = !("error" in d) && String(d.header.alg).toLowerCase() === "none"
      if (isNone || Jwt.verifyHS256(tok, SECRET)) return { status: 200, headers: {}, body: "ok" }
      return { status: 401, headers: {}, body: "bad sig" }
    },
  }
}

const baseReq = (): ProbeRequest => ({
  method: "GET",
  url: "https://api.example.com/me",
  headers: { Authorization: `Bearer ${REAL}` },
})

describe("extractBearer", () => {
  test("pulls a Bearer token, a bare JWT, and rejects non-JWT", () => {
    expect(extractBearer({ Authorization: `Bearer ${REAL}` })).toBe(REAL)
    expect(extractBearer({ authorization: REAL })).toBe(REAL) // bare, case-insensitive key
    expect(extractBearer({ Authorization: "Basic dXNlcjpwYXNz" })).toBeNull()
    expect(extractBearer({ "x-other": "v" })).toBeNull()
  })
})

describe("AuthnTest.run", () => {
  test("detects the weak secret, mints a valid-signature forgery, and flags accepted candidates", async () => {
    const report = await AuthnTest.run({ request: baseReq(), token: REAL, authHeader: "authorization" }, vulnServer())
    if ("error" in report) throw new Error(report.error)

    expect(report.weakSecret).toBe("secret")
    expect(report.analysis.symmetric).toBe(true)
    expect(report.candidateCount).toBeGreaterThan(1)
    // alg:none is accepted by the vuln server; the cracked-secret re-sign is accepted too.
    expect(report.acceptedCandidates).toContain("alg-none")
    expect(report.acceptedCandidates).toContain("weak-secret-resign")
    expect(report.probe.authGated).toBe(true)
  })

  test("adds an RS256→HS256 confusion candidate when a public key is supplied", async () => {
    const report = await AuthnTest.run(
      { request: baseReq(), token: REAL, authHeader: "authorization", publicKey: "-----BEGIN PUBLIC KEY-----\nFAKE\n-----END PUBLIC KEY-----" },
      vulnServer(),
    )
    if ("error" in report) throw new Error(report.error)
    const names = report.probe.results.map((r) => r.candidate)
    expect(names).toContain("rs256-hs256-confusion")
  })

  test("a secure server accepts no forgery", async () => {
    const secure: HttpSender = {
      async send(req) {
        const tok = (authValue(req.headers) ?? "").replace(/^Bearer /, "")
        // Strong server: only a properly-signed token with an UNKNOWN-to-us secret passes.
        return Jwt.verifyHS256(tok, "the-real-strong-secret") ? { status: 200, headers: {}, body: "ok" } : { status: 401, headers: {}, body: "no" }
      },
    }
    const strong = Jwt.signHS256({}, { sub: "5", role: "user" }, "the-real-strong-secret")
    const report = await AuthnTest.run({ request: { ...baseReq(), headers: { Authorization: `Bearer ${strong}` } }, token: strong, authHeader: "authorization" }, secure)
    if ("error" in report) throw new Error(report.error)
    expect(report.weakSecret).toBeNull()
    expect(report.acceptedCandidates).toHaveLength(0)
  })

  test("a non-JWT token returns an error", async () => {
    const report = await AuthnTest.run({ request: baseReq(), token: "not-a-jwt", authHeader: "authorization" }, vulnServer())
    expect("error" in report).toBe(true)
  })
})
