// session_probe — deterministic session-management probe (WSTG-SESS). Complements the passive
// weak_cookie_flags signal with active, confirm-not-eyeball checks against captured session material:
//   • JWT tampering — alg:none acceptance, signature-not-validated (tampered claim, old sig), and a
//     weak-HMAC-secret dictionary attack (a hit forges arbitrary tokens — a static break, no replay).
//   • Session-identifier strength — Shannon entropy + structure of the session cookie.
// The JWT acceptance checks REPLAY forged tokens with a no-token control, so "accepted" is only claimed
// when the same request without a session is denied. All classifiers are pure + unit-tested.
//
// SAFETY: mirrors access_probe — a state-changing request IS tested by default (that is where a forged
// session does real damage) and the result flags that a write ran; set safe_only to skip writes.
import z from "zod"
import { Tool } from "../tool"
import { Session } from "../../session"
import { Request } from "../../session/request"
import { HttpMessage } from "../../replay/message"
import { Mutate } from "../../replay/mutate"
import { originOf, inScope, stripAuthHeaders, sendGoverned } from "../http-replay"
import { findJwts, analyzeJwtStatic, forgeNone, forgeTamperedClaim, forgeResigned, forgeAlgConfusion, forgeKidEmptyKey, findWeakSecret, type FoundJwt } from "./jwt"
import { parseCookieHeader, isSessionCookie, classifyCookieEntropy } from "./cookie"
import { runJwtAcceptance, type SessResp } from "./probe"

const SAFE_METHODS = new Set(["GET", "HEAD"])

function headerValue(msg: HttpMessage.Request, name: string): string | undefined {
  return msg.headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value
}

// Put a new token into the request at the location a JWT was found (cookie value or auth header),
// leaving everything else byte-identical so the only variable is the session material.
export function replaceToken(msg: HttpMessage.Request, location: string, token: string): HttpMessage.Request {
  if (location.startsWith("cookie:")) {
    const target = location.slice("cookie:".length)
    const raw = headerValue(msg, "cookie") ?? ""
    const rebuilt = parseCookieHeader(raw)
      .map((c) => (c.name === target ? `${c.name}=${token}` : `${c.name}=${c.value}`))
      .join("; ")
    return Mutate.setHeader(msg, "Cookie", rebuilt)
  }
  const name = location.slice("header:".length)
  if (name === "authorization") {
    const had = headerValue(msg, "authorization") ?? ""
    const prefix = /^Bearer\s+/i.test(had) ? "Bearer " : ""
    return Mutate.setHeader(msg, "authorization", `${prefix}${token}`)
  }
  return Mutate.setHeader(msg, name, token)
}

async function sendDecoded(msg: HttpMessage.Request, origin: string, abort: AbortSignal): Promise<SessResp> {
  const r = await sendGoverned(msg, origin, { signal: abort })
  if (r.error || !r.response) return { error: r.error?.message ?? "no response (transport error)" }
  return { status: r.response.status, body: new TextDecoder("latin1").decode(r.response.body) }
}

export const SessionProbeTool = Tool.define("session_probe", {
  description:
    "Deterministic session-management probe (WSTG-SESS). On a captured, authenticated request it: (1) finds the JWT in the Cookie/Authorization header and tests it for alg:none, signature-not-validated (tampered claim), weak-HMAC-secret dictionary, kid path-traversal-to-empty-key, expired-token acceptance, and — with a supplied public_key — RS256→HS256 alg confusion; it also flags jku/x5u/jwk key-resolution surface (SSRF/OOB); (2) scores the session cookie's entropy/structure. JWT acceptance is proven by replaying forged tokens against a no-token control (only claims 'accepted' when the same request WITHOUT a session is denied). A weak-secret hit is a standalone break (arbitrary token forgery). Pass a request that carries the session (post-login). Safe methods are replayed freely; a write is tested too (flagged) unless safe_only=true.",
  parameters: z.object({
    request_id: z.string().describe("A captured, authenticated request that carries the session token (cookie or Authorization header)."),
    public_key: z
      .string()
      .optional()
      .describe("PEM public key for the token's RSA/EC signature, if you discovered one (e.g. /.well-known/jwks.json, a cert). Enables the RS256→HS256 alg-confusion test (re-sign HS256 with the public key as the HMAC secret)."),
    safe_only: z
      .boolean()
      .optional()
      .default(false)
      .describe("If true, skip the live acceptance replay on state-changing methods (POST/PUT/PATCH/DELETE). Default false — a forged session on a write is the highest-impact case, so it IS tested and the result flags that a write ran. The static checks (weak secret, entropy) run regardless."),
  }),
  async execute(params, ctx) {
    const sessionID = Session.root(ctx.sessionID)
    const out = (output: string, metadata: Record<string, unknown> = {}) => ({ title: "session_probe", output, metadata })

    const request = Request.get(sessionID).find((r) => r.id === params.request_id)
    if (!request) return out(`Request "${params.request_id}" not found in this session.`)
    if (!request.raw_request) return out(`Request "${params.request_id}" has no raw_request to replay.`)

    const o = originOf(request)
    if (typeof o !== "string") return out(o.error)
    const origin = o
    const host = (() => {
      try {
        return new URL(origin).hostname
      } catch {
        return ""
      }
    })()
    if (!inScope(sessionID, host)) return out(`Refusing host "${host}": not among this session's captured in-scope hosts.`)

    let baseMsg: HttpMessage.Request
    try {
      baseMsg = HttpMessage.parse(request.raw_request)
    } catch (e) {
      return out(`Could not parse request: ${e instanceof Error ? e.message : String(e)}`)
    }

    // ── Static, deterministic findings (no replay) ────────────────────────────────
    const jwts = findJwts(baseMsg.headers)
    const staticFindings: Record<string, unknown>[] = []
    for (const f of jwts) {
      const s = analyzeJwtStatic(f.jwt)
      if (s.alg_none_issued) staticFindings.push({ kind: "jwt-alg-none-issued", location: f.location, note: `the server ISSUED an unsigned (alg:none) token at ${f.location} — no integrity at all` })
      if (s.weak_secret) staticFindings.push({ kind: "jwt-weak-secret", location: f.location, severity: "critical", note: `the HS* signing secret is the weak/known value "${s.weak_secret}" — an attacker can forge ANY token (full auth bypass). Deterministic: the secret verifies the captured token's signature.` })
      if (s.expired) staticFindings.push({ kind: "jwt-expired-token-in-use", location: f.location, note: `the presented token is past its exp (${s.exp}) — if the server still honors it (see acceptance), expiry is not enforced` })
      if (s.header_surface.length) staticFindings.push({ kind: "jwt-key-resolution-surface", location: f.location, params: s.header_surface, note: `token header carries attacker-influenceable key-resolution params (${s.header_surface.join(", ")}): kid → path/SQL injection into key lookup (kid-empty-key is tested below); jku/x5u → fetch a key from a URL (SSRF + key substitution, OOB — use a collaborator); jwk/x5c → embedded self-signed key. Test each.` })
      if (s.rsa && !params.public_key) staticFindings.push({ kind: "jwt-alg-confusion-candidate", location: f.location, note: `asymmetric alg (${s.alg}) — RS→HS alg confusion is possible if the server verifies with its public key regardless of alg. Re-run with public_key=<PEM> (from jwks.json / a cert) to test it deterministically.` })
    }

    const cookieHdr = headerValue(baseMsg, "cookie")
    const cookieFindings: Record<string, unknown>[] = []
    if (cookieHdr) {
      for (const c of parseCookieHeader(cookieHdr)) {
        if (!isSessionCookie(c.name)) continue
        const v = classifyCookieEntropy(c.name, c.value)
        if (v.verdict !== "ok") cookieFindings.push({ kind: `session-cookie-${v.verdict}`, name: v.name, bits: v.bits, length: v.length, note: v.note })
      }
    }

    // ── Active JWT-acceptance replay (with a no-token control) ────────────────────
    const stateChanging = !SAFE_METHODS.has(request.method.toUpperCase())
    let acceptance: unknown = "no JWT found in this request — acceptance replay skipped (cookie-entropy + static checks still ran)"
    let acceptanceWarning: string | undefined
    if (jwts.length > 0) {
      if (stateChanging && params.safe_only) {
        acceptance = `safe_only is set and this is a ${request.method} (state-changing) request — acceptance replay skipped. Re-run with safe_only=false to test forged-token acceptance (a write will run), or confirm manually.`
      } else {
        const target: FoundJwt = jwts[0] // the primary session token
        const weak = findWeakSecret(target.jwt)
        const variants: { name: string; msg: HttpMessage.Request }[] = [
          { name: "alg:none", msg: replaceToken(baseMsg, target.location, forgeNone(target.jwt)) },
          { name: "tampered-claim", msg: replaceToken(baseMsg, target.location, forgeTamperedClaim(target.jwt, { _cs_probe: 1 })) },
          { name: "kid-empty-key", msg: replaceToken(baseMsg, target.location, forgeKidEmptyKey(target.jwt, undefined, { _cs_probe: 1 })) },
        ]
        if (weak) variants.push({ name: "weak-secret-resign", msg: replaceToken(baseMsg, target.location, forgeResigned(target.jwt, weak, { _cs_probe: 1 })) })
        if (params.public_key) variants.push({ name: "alg-confusion(RS→HS)", msg: replaceToken(baseMsg, target.location, forgeAlgConfusion(target.jwt, params.public_key, { _cs_probe: 1 })) })

        const run = await runJwtAcceptance(
          { ownerMsg: baseMsg, controlMsg: stripAuthHeaders(baseMsg), variants },
          (msg) => sendDecoded(msg, origin, ctx.abort),
        )
        // Expired-token acceptance: the owner baseline replays the ORIGINAL captured token now. If it is
        // past its exp yet still returns 2xx, expiry is not enforced (WSTG-SESS-07). Deterministic from
        // the baseline — no forging needed.
        const stat = analyzeJwtStatic(target.jwt)
        if (stat.expired && run.owner.status != null && run.owner.status >= 200 && run.owner.status < 300)
          run.results.push({ variant: "expired-token(original)", verdict: "broken", forged_status: run.owner.status, similarity: 1, note: `the presented token is past its exp (${stat.exp}) yet the server returned ${run.owner.status} — token expiry is NOT enforced.` })
        acceptance = { target: target.location, owner_status: run.owner.status, control_status: run.control.status, results: run.results }
        if (stateChanging) acceptanceWarning = `STATE-CHANGING (${request.method}): forged tokens were replayed against this endpoint, so a write may have run under a forged session — verify side effects.`
      }
    }

    const brokenAcceptance = jwts.length > 0 && typeof acceptance === "object" && acceptance !== null && "results" in acceptance
      ? (acceptance as { results: { verdict: string }[] }).results.filter((r) => r.verdict === "broken")
      : []
    const criticalStatic = staticFindings.filter((f) => f.kind === "jwt-weak-secret")
    const totalBreaks = brokenAcceptance.length + criticalStatic.length

    const evidence = {
      note: "OBSERVATIONS ONLY — a weak-secret hit and a 'broken' acceptance are strong deterministic leads; confirm before reporting. Acceptance is judged against a no-token control so a non-gated endpoint cannot produce a false positive.",
      warning: acceptanceWarning,
      request_id: params.request_id,
      method: request.method,
      jwts_found: jwts.map((j) => ({ location: j.location, alg: j.jwt.header.alg })),
      static_findings: staticFindings.length ? staticFindings : ["no static JWT weakness (alg:none / weak secret / expired)"],
      cookie_findings: cookieFindings.length ? cookieFindings : ["no weak/structured session cookie detected"],
      jwt_acceptance: acceptance,
    }
    const title =
      totalBreaks > 0
        ? `session_probe: ${totalBreaks} BROKEN session finding(s) (verify)`
        : staticFindings.length + cookieFindings.length > 0
          ? `session_probe: ${staticFindings.length + cookieFindings.length} weakness lead(s) to verify`
          : `session_probe: no deterministic session weakness found`
    return { title, output: JSON.stringify(evidence, null, 2), metadata: {} }
  },
})
