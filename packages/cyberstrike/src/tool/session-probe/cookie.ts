// Session-cookie deterministic analysis core (WSTG-SESS-03 session-identifier strength). Pure.
// A session identifier must be long and unpredictable. This flags identifiers that are short, low-
// entropy, or structured (a base64/hex wrapper around a small integer, username, or sequential value) —
// all of which let an attacker guess or forge another user's session.

export interface Cookie {
  name: string
  value: string
}

// Parse a `Cookie:` header value into name/value pairs (order preserved).
export function parseCookieHeader(value: string): Cookie[] {
  const out: Cookie[] = []
  for (const pair of value.split(";")) {
    const eq = pair.indexOf("=")
    if (eq < 0) continue
    const name = pair.slice(0, eq).trim()
    if (!name) continue
    out.push({ name, value: pair.slice(eq + 1).trim() })
  }
  return out
}

// Names that conventionally hold the session identifier. Matched case-insensitively as a substring so
// `PHPSESSID`, `connect.sid`, `myapp_session`, `XSRF-TOKEN` (excluded — that's CSRF) are handled.
const SESSION_NAME = /(jsessionid|phpsessid|asp\.net_sessionid|connect\.sid|sessionid|session_id|session|sess|sid|auth.?token|access.?token|__session)/i
const CSRF_NAME = /(csrf|xsrf)/i

export function isSessionCookie(name: string): boolean {
  return SESSION_NAME.test(name) && !CSRF_NAME.test(name)
}

// Shannon entropy of the string in BITS: H(per-char) × length. This is the theoretical upper bound of
// the value's unpredictability given its own character distribution — a long value drawn from a tiny
// alphabet (e.g. all digits) scores lower than the same length in base64.
export function shannonBits(value: string): number {
  if (value.length === 0) return 0
  const freq = new Map<string, number>()
  for (const ch of value) freq.set(ch, (freq.get(ch) ?? 0) + 1)
  let perChar = 0
  for (const c of freq.values()) {
    const p = c / value.length
    perChar -= p * Math.log2(p)
  }
  return perChar * value.length
}

// Does the value decode to something small/guessable? Try base64 and hex → if the decoded bytes are a
// plain integer, a short printable string (username-ish), or all-numeric, the identifier is structured.
export function decodedStructure(value: string): string | undefined {
  // Pure integer / short numeric id
  if (/^\d{1,10}$/.test(value)) return `plain numeric id "${value}" — sequential/guessable`
  // base64 / base64url wrapper
  if (/^[A-Za-z0-9_+/=-]{4,}$/.test(value) && value.length % 4 !== 1) {
    try {
      const dec = Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")
      if (dec && /^[\x20-\x7e]+$/.test(dec)) {
        if (/^\d+$/.test(dec)) return `base64 of a numeric id ("${dec}") — sequential/guessable`
        if (/^[\w.@-]{1,32}$/.test(dec) && /[a-z]/i.test(dec)) return `base64 of a printable value ("${dec}") — not opaque/random`
      }
    } catch {
      /* not base64 */
    }
  }
  return undefined
}

export interface CookieVerdict {
  name: string
  bits: number
  length: number
  verdict: "weak" | "structured" | "ok"
  note: string
}

// Deterministic verdict for one session cookie. Thresholds: a session id should carry ≳64 bits of
// entropy over ≳16 chars (OWASP ASVS 3.2). Structure short-circuits to a break regardless of length.
export function classifyCookieEntropy(name: string, value: string, minBits = 64): CookieVerdict {
  const bits = shannonBits(value)
  const base = { name, bits: Math.round(bits * 10) / 10, length: value.length }
  const structure = decodedStructure(value)
  if (structure) return { ...base, verdict: "structured", note: `session id is ${structure} — predictable, not a random token` }
  if (value.length < 16 || bits < minBits)
    return { ...base, verdict: "weak", note: `session id is weak: ${value.length} chars, ~${base.bits} bits entropy (want ≥16 chars / ≥${minBits} bits) — brute-forceable` }
  return { ...base, verdict: "ok", note: `session id looks opaque: ${value.length} chars, ~${base.bits} bits entropy` }
}
