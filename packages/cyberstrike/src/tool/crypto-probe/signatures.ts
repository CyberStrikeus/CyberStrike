// Cryptography deterministic checks (WSTG-CRYP), read-only over captured traffic — no I/O, no sends.
// Focus: sensitive data on an unencrypted channel (CRYP-03), transport hardening posture (HSTS, CRYP-01),
// secrets exposed in URLs, and mixed content. Channel-encryption lens (is it protected in transit?),
// distinct from secret-leakage (Vortex secret-in-response) and cookie flags (session_probe).

// Field names that carry credentials/secrets/PII. Matched as a JSON key ("name":) or a form/query pair
// (name=), case-insensitive.
const SENSITIVE_KEY =
  /(?:"|&|\?|^|\b)(password|passwd|passphrase|pwd|secret|api[_-]?key|apikey|access[_-]?token|refresh[_-]?token|auth[_-]?token|token|credential|card[_-]?number|cardno|cardnum|cvv|cvc|ssn|otp|pin)(?:"\s*:|=)/gi

// A run of 13–19 digits (optionally space/dash grouped) — a credit-card candidate, confirmed by Luhn.
const CARD_CANDIDATE = /\b(?:\d[ -]?){13,19}\b/g

export function luhnValid(raw: string): boolean {
  const digits = raw.replace(/\D/g, "")
  if (digits.length < 13 || digits.length > 19) return false
  let sum = 0
  let dbl = false
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48
    if (dbl) {
      d *= 2
      if (d > 9) d -= 9
    }
    sum += d
    dbl = !dbl
  }
  return sum % 10 === 0
}

export interface Sensitive {
  kind: "credential-field" | "credit-card"
  where: string // "query" | "body" | "header"
  detail: string
}

// Scan a chunk of request text (a query string, a body, or a header value) for sensitive material.
// Deduped by (kind, detail). Does not judge the channel — the caller applies the scheme.
export function findSensitive(where: string, text: string): Sensitive[] {
  const out: Sensitive[] = []
  const seen = new Set<string>()
  const push = (kind: Sensitive["kind"], detail: string) => {
    const key = `${kind}:${detail}`
    if (seen.has(key)) return
    seen.add(key)
    out.push({ kind, where, detail })
  }
  for (const m of text.matchAll(SENSITIVE_KEY)) push("credential-field", m[1].toLowerCase())
  for (const m of text.matchAll(CARD_CANDIDATE)) if (luhnValid(m[0])) push("credit-card", `${m[0].replace(/\D/g, "").length}-digit Luhn-valid number`)
  return out
}

export interface HstsVerdict {
  verdict: "missing" | "weak" | "ok"
  note: string
}

// HSTS posture on an HTTPS response (WSTG-CRYP-01 downgrade protection). max-age below ~6 months, or no
// includeSubDomains, is weak. `value` is the Strict-Transport-Security header value (or undefined).
export function classifyHsts(value: string | undefined): HstsVerdict {
  if (!value) return { verdict: "missing", note: "no Strict-Transport-Security header — the site is exposed to SSL-strip / downgrade on the next request" }
  const maxAgeMatch = value.match(/max-age\s*=\s*(\d+)/i)
  const maxAge = maxAgeMatch ? Number(maxAgeMatch[1]) : 0
  const includeSub = /includeSubDomains/i.test(value)
  if (maxAge < 15552000) return { verdict: "weak", note: `HSTS max-age=${maxAge} is below 6 months (15552000s) — too short for durable downgrade protection` }
  if (!includeSub) return { verdict: "weak", note: "HSTS lacks includeSubDomains — subdomains remain downgrade-exposed" }
  return { verdict: "ok", note: `HSTS present (max-age=${maxAge}, includeSubDomains)` }
}

// http:// subresources referenced from an HTTPS response body (mixed content — WSTG-CRYP-03). Returns the
// distinct insecure URLs seen in src=/href= attributes.
export function findMixedContent(body: string): string[] {
  const out = new Set<string>()
  for (const m of body.matchAll(/(?:src|href)\s*=\s*["']?(http:\/\/[^"'\s>]+)/gi)) out.add(m[1])
  return [...out]
}
