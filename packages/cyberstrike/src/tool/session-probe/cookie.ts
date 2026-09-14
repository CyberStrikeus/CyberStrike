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

// ── Set-Cookie attribute analysis (WSTG-SESS-02) — read-only, no replay ────────────────────────────

export interface SetCookie {
  name: string
  value: string
  secure: boolean
  httpOnly: boolean
  sameSite?: string
  domain?: string
  path?: string
}

// Split a (possibly record-collapsed) Set-Cookie header value into individual cookies. Splits on a comma
// that introduces a new `name=` pair, so the comma inside `Expires=Wed, 09 Jun 2021 …` does not split.
export function splitSetCookies(raw: string): string[] {
  return raw
    .split(/,(?=\s*[^;=,\s]+=)/)
    .map((s) => s.trim())
    .filter(Boolean)
}

export function parseSetCookie(line: string): SetCookie {
  const parts = line.split(";").map((p) => p.trim())
  const first = parts[0] ?? ""
  const eq = first.indexOf("=")
  const attrs = parts.slice(1)
  const attr = (k: string) => attrs.find((a) => a.toLowerCase() === k || a.toLowerCase().startsWith(k + "="))
  const attrVal = (k: string) => {
    const a = attr(k)
    if (!a) return undefined
    const i = a.indexOf("=")
    return i < 0 ? "" : a.slice(i + 1).trim()
  }
  return {
    name: eq < 0 ? first : first.slice(0, eq),
    value: eq < 0 ? "" : first.slice(eq + 1),
    secure: !!attr("secure"),
    httpOnly: !!attr("httponly"),
    sameSite: attrVal("samesite"),
    domain: attrVal("domain"),
    path: attrVal("path"),
  }
}

export interface CookieAttrFinding {
  kind: string
  note: string
}

// Deterministic attribute weaknesses on a SESSION Set-Cookie. `scheme` is the request scheme, so a
// missing Secure over https/http can be judged for interception. Complements the passive
// weak_cookie_flags signal with prefix-misuse and domain-scope checks.
export function analyzeCookieAttributes(scheme: string, c: SetCookie): CookieAttrFinding[] {
  const out: CookieAttrFinding[] = []
  if (!c.httpOnly) out.push({ kind: "cookie-missing-httponly", note: `session cookie "${c.name}" has no HttpOnly — readable by JavaScript, so an XSS steals the session` })
  if (!c.secure) out.push({ kind: "cookie-missing-secure", note: `session cookie "${c.name}" has no Secure — it is sent over cleartext HTTP and can be intercepted${scheme === "http" ? " (this capture WAS over http)" : ""}` })
  const ss = (c.sameSite ?? "").toLowerCase()
  if (!ss) out.push({ kind: "cookie-samesite-absent", note: `session cookie "${c.name}" has no SameSite — cross-site requests carry it (CSRF exposure unless otherwise mitigated)` })
  else if (ss === "none" && !c.secure) out.push({ kind: "cookie-samesite-none-insecure", note: `session cookie "${c.name}" is SameSite=None without Secure — invalid; browsers may drop it and it is cross-site + cleartext` })
  if (c.domain && c.domain.startsWith(".")) out.push({ kind: "cookie-domain-too-broad", note: `session cookie "${c.name}" is scoped to Domain=${c.domain} (all subdomains) — a single vulnerable subdomain can read the session` })
  // Cookie-prefix contract: __Host- requires Secure + Path=/ + NO Domain; __Secure- requires Secure.
  if (c.name.startsWith("__Host-") && (!c.secure || c.domain || c.path !== "/"))
    out.push({ kind: "cookie-host-prefix-violated", note: `"${c.name}" claims the __Host- prefix but violates its contract (needs Secure, Path=/, no Domain) — the prefix's protection is void` })
  if (c.name.startsWith("__Secure-") && !c.secure)
    out.push({ kind: "cookie-secure-prefix-violated", note: `"${c.name}" claims the __Secure- prefix but is not Secure — prefix protection void` })
  return out
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
