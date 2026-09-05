// Token-acceptance probe (Web Workflow 2.0, plan §05 authn_test). Given a set of
// forged tokens (minted by ./jwt.ts) it sends each at an auth-gated endpoint and
// classifies which the server ACCEPTS — the confirmation step JWT analysis alone
// cannot give ("the token is forgeable" ≠ "the server accepts the forgery").
//
// OO / invariant-2: all HTTP goes through an injected HttpSender (the http_replay
// engine in production, a mock in tests) — this module opens no socket, so it is
// fully unit-testable and composes cleanly into @cyberstrike/web.
//
// The oracle uses a NEGATIVE CONTROL: it first sends the request with NO token. If
// the endpoint answers the same unauthenticated (a public route), acceptance is
// meaningless and every forgery is reported not-accepted with that reason — this is
// the classic false-positive ("both return 200") the finding gate must avoid.

// The request/response DTOs + transport seam live in the shared ../transport module
// (reused by every webhook smart tool). Imported for local use and re-exported so
// authn callers and existing tests keep importing them from this authn barrel.
import type { ProbeRequest, ProbeResponse, HttpSender } from "../transport"
export type { ProbeRequest, ProbeResponse, HttpSender }

export interface TokenCandidate {
  name: string
  token: string
  note?: string
}

export interface AcceptanceResult {
  candidate: string
  note?: string
  status: number | null
  accepted: boolean // endpoint is auth-gated AND the forged token got in
  sameStatusAsBaseline: boolean // forged response status equals the real-token response
  error?: string
}

export interface ProbeReport {
  authGated: boolean // the endpoint rejected the no-token request (a real control)
  baselineStatus: number | null // status with the ORIGINAL (real) token
  unauthStatus: number | null // status with NO token (negative control)
  notGatedReason?: string
  results: AcceptanceResult[]
}

// ── case-insensitive header helpers (HTTP header names are case-insensitive) ────
function withHeader(headers: Record<string, string>, name: string, value: string): Record<string, string> {
  const out: Record<string, string> = {}
  const lower = name.toLowerCase()
  for (const k in headers) if (k.toLowerCase() !== lower) out[k] = headers[k]
  out[name] = value
  return out
}

function withoutHeader(headers: Record<string, string>, name: string): Record<string, string> {
  const out: Record<string, string> = {}
  const lower = name.toLowerCase()
  for (const k in headers) if (k.toLowerCase() !== lower) out[k] = headers[k]
  return out
}

function statusOf(r: ProbeResponse | { error: string }): number | null {
  return "error" in r ? null : r.status
}

// Acceptance = the resource was SERVED (2xx). A 3xx is treated as non-acceptance:
// the common auth case is a redirect to /login, which is a rejection, not access.
// (A rare legit authorized redirect is left for the agent to judge from the report.)
function isSuccess(status: number | null): boolean {
  return status !== null && status >= 200 && status < 300
}

export class TokenAcceptanceProbe {
  constructor(private readonly sender: HttpSender) {}

  /**
   * Send the real token (baseline), no token (control), then each forged candidate,
   * and classify acceptance. `tokenPrefix` is how the token sits in the header
   * (default "Bearer "). Empty prefix for a bare-token / cookie-style header.
   */
  async run(input: {
    request: ProbeRequest
    authHeader: string
    candidates: TokenCandidate[]
    tokenPrefix?: string
  }): Promise<ProbeReport> {
    const prefix = input.tokenPrefix ?? "Bearer "
    const req = input.request

    // Baseline: the request exactly as given (carries the real token).
    const baseline = await this.sender.send(req)
    const baselineStatus = statusOf(baseline)

    // Negative control: strip the auth header entirely.
    const unauth = await this.sender.send({ ...req, headers: withoutHeader(req.headers, input.authHeader) })
    const unauthStatus = statusOf(unauth)

    // Auth-gated = the endpoint refuses the no-token request. If it still succeeds
    // unauthenticated, it is not gated and "acceptance" of a forgery is not a finding.
    const authGated = !isSuccess(unauthStatus)

    const results: AcceptanceResult[] = []
    for (const c of input.candidates) {
      const resp = await this.sender.send({
        ...req,
        headers: withHeader(req.headers, input.authHeader, `${prefix}${c.token}`),
      })
      if ("error" in resp) {
        results.push({ candidate: c.name, note: c.note, status: null, accepted: false, sameStatusAsBaseline: false, error: resp.error })
        continue
      }
      const accepted = authGated && isSuccess(resp.status)
      results.push({
        candidate: c.name,
        note: c.note,
        status: resp.status,
        accepted,
        sameStatusAsBaseline: baselineStatus !== null && resp.status === baselineStatus,
      })
    }

    return {
      authGated,
      baselineStatus,
      unauthStatus,
      notGatedReason: authGated
        ? undefined
        : `endpoint answered ${unauthStatus ?? "error"} with NO token — not auth-gated, so forged-token acceptance is not a finding here`,
      results,
    }
  }
}
