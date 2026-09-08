// Replay safety — stop a replay from DESTROYING the live session. Some IdPs expire the whole
// session the instant a single-use token is reused: the browser used it once (legit), and a replay
// is the second use → the IdP kills the session → the assessment loses auth. Vortex can't defeat
// that server policy, but it can refuse to replay the requests that trigger it. This is a guard, not
// a detector of vulnerabilities.
//
//   replaySafety(tx).safe === false  → do NOT replay (default): auth-exchange endpoint, a response
//                                       that minted/rotated a session cookie, or a hard single-use
//                                       token (OAuth code / PKCE / refresh_token / grant_type).
//   .singleUse                       → the single-use / rotating token fields found (csrf, nonce,
//                                       code, …) so the caller can substitute FRESH values at send
//                                       time (SendOptions.resolveToken) instead of the stale capture.
//   isAuthStale(tx)                  → the (benign) "session expired" signal: 401 or a redirect to a
//                                       login page → the host should refresh, then retry.
import type { Transaction } from "./transaction"
import { header } from "./transaction"
import { params } from "./params"
import { requestCookies, responseCookies } from "./cookies"

export type TokenKind = "oauth-code" | "pkce" | "grant" | "refresh-token" | "id-token" | "csrf" | "nonce" | "state" | "otp" | "session-cookie"
export type TokenSite = "query" | "body" | "header" | "cookie"
export interface TokenRef {
  name: string
  in: TokenSite
  kind: TokenKind
}
export interface ReplaySafety {
  safe: boolean
  reason?: string // why it's unsafe to replay (present only when !safe)
  singleUse: TokenRef[] // single-use / rotating token fields (for fresh substitution)
}

export class ReplayUnsafeError extends Error {}

// A path segment that means "this request runs an auth exchange" (session-minting / one-time).
const AUTH_SEG = new Set([
  "login", "log-in", "signin", "sign-in", "logout", "signout", "sign-out", "token", "oauth", "oauth2", "authorize", "authorization", "authenticate",
  "session", "sessions", "sso", "saml", "openid", "connect", "callback", "refresh", "revoke", "userinfo",
])
// A Set-Cookie name that means the response established/rotated a session → replay re-mints it.
const SESSION_COOKIE = /(^|[._-])(session|sess|sid|jsessionid|phpsessid|auth|token|jwt|access|refresh)([._-]|$)|connect\.sid|asp\.?net.?sessionid/i
// Unambiguous single-use fields — hard block regardless of endpoint.
const HARD_FIELD: Record<string, TokenKind> = { code_verifier: "pkce", grant_type: "grant", refresh_token: "refresh-token", id_token: "id-token" }
// Rotating / one-time fields — advisory (fresh-substitute); don't block on their own.
const SOFT_FIELD: { re: RegExp; kind: TokenKind }[] = [
  { re: /(^|[._-])(csrf|xsrf)([._-]|token|$)|authenticity_token|requestverificationtoken|anti.?forgery/i, kind: "csrf" },
  { re: /nonce/i, kind: "nonce" },
  { re: /(^|[._-])state$/i, kind: "state" },
  { re: /(otp|one.?time)/i, kind: "otp" },
]

function classifyField(name: string): { kind: TokenKind; hard: boolean } | undefined {
  const lower = name.toLowerCase()
  const last = lower.split(/[._-]/).pop() ?? lower
  const hard = HARD_FIELD[lower] ?? HARD_FIELD[last]
  if (hard) return { kind: hard, hard: true }
  if (lower === "code" || last === "code") return { kind: "oauth-code", hard: false } // hardness decided by endpoint
  for (const s of SOFT_FIELD) if (s.re.test(lower)) return { kind: s.kind, hard: false }
  return undefined
}

function pathname(url: string): string {
  try {
    return new URL(url).pathname
  } catch {
    const q = url.indexOf("?")
    return q === -1 ? url : url.slice(0, q)
  }
}

export function replaySafety(tx: Transaction): ReplaySafety {
  const singleUse: TokenRef[] = []
  let hard = false
  let reason: string | undefined
  const mark = (r: string) => {
    hard = true
    reason ??= r
  }

  const segs = pathname(tx.request.url).toLowerCase().split("/").filter(Boolean)
  const authEndpoint = segs.some((s) => AUTH_SEG.has(s))
  if (authEndpoint) mark("auth-exchange endpoint — replay re-runs a session-minting / one-time exchange")

  for (const c of responseCookies(tx)) {
    if (SESSION_COOKIE.test(c.name)) {
      mark(`response set a session cookie (${c.name}) — replay re-mints/rotates the session`)
      break
    }
  }

  const scan = (names: Iterable<string>, where: TokenSite) => {
    for (const name of names) {
      const c = classifyField(name)
      if (!c) continue
      if (c.kind === "oauth-code" && !authEndpoint) continue // bare "code" off an auth endpoint is likely a coupon/product code, not an OAuth code
      singleUse.push({ name, in: where, kind: c.kind })
      if (c.hard || (c.kind === "oauth-code" && authEndpoint)) mark(`single-use ${c.kind} in ${where}.${name}`)
    }
  }
  const p = params(tx)
  scan(Object.keys(p.query), "query")
  scan(Object.keys(p.body), "body")
  scan(
    tx.request.headers.map((h) => h.name),
    "header",
  )
  scan(Object.keys(requestCookies(tx)), "cookie")

  return { safe: !hard, reason, singleUse }
}

const LOGIN_LOCATION = /\/(login|log-in|signin|sign-in|auth|authorize|sso|saml|account\/login|session\/new|oauth)/i

// The benign "session expired" signal — the host should refresh auth and retry (vs. replaySafety,
// which is the DESTRUCTIVE-replay guard). Conservative: a 401, or a redirect aimed at a login page.
export function isAuthStale(tx: Transaction): boolean {
  const r = tx.response
  if (!r) return false
  if (r.status === 401) return true
  if (r.status >= 300 && r.status < 400) return LOGIN_LOCATION.test(header(r.headers, "location") ?? "")
  return false
}
