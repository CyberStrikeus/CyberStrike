// Faz 2 — value redactor.
//
// The observed-value store accumulates CONCRETE request values on real production
// traffic, so it must never persist secrets/PII. The rule: the valueHash (a digest,
// non-sensitive) is ALWAYS computed so dedup still works, but a concrete value is
// retained only when it is structurally safe. Sensitive values keep their slot
// (presence + name) so mass-assignment/shape signal survives — only the value is
// dropped.
//
// Deny is conservative and identifier-friendly: it targets secret-by-NAME keys and
// secret-by-SHAPE values (JWT, card numbers), plus an oversize cap. It deliberately
// does NOT entropy-redact, so high-entropy identifiers (UUIDs, hashids, ObjectIds)
// — the IDOR cross-replay material — are preserved. Entropy refinement can ride on
// the idLike classifier in Faz 4.

import { createHash } from "crypto"
import type { ParamSlot } from "./types"

const MAX_PARAMS = 24
const MAX_VALUE_LEN = 128

// Whole-segment secret key names (matched against keyPath tokens like input.password).
const DENY_TOKENS: ReadonlySet<string> = new Set([
  "password", "passwd", "pwd", "secret", "token", "tokens", "otp", "cvv", "cvc", "ssn",
  "pin", "auth", "authorization", "cookie", "apikey", "credential", "credentials",
  "privatekey", "clientsecret", "refresh", "sessionid", "accesskey",
])

const JWT_RE = /^ey[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/
const SECRET_SUFFIX_RE = /(secret|token|password|passwd|apikey|api_key|privatekey)$/i

function denyByName(name: string): boolean {
  const tokens = name.toLowerCase().split(/[._\-[\]]+/).filter(Boolean)
  if (tokens.some((t) => DENY_TOKENS.has(t))) return true
  return SECRET_SUFFIX_RE.test(name)
}

// Luhn-valid digit run of card length — a payment card number, never stored.
function looksLikeCard(v: string): boolean {
  const digits = v.replace(/[\s-]/g, "")
  if (!/^\d{13,19}$/.test(digits)) return false
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

function denyByValue(v: string): boolean {
  return JWT_RE.test(v) || looksLikeCard(v)
}

export interface RedactResult {
  observedParams: ParamSlot[]
  valueHash: string | undefined // sha16 of the full value-set; the dedup unit (Faz 3)
}

/**
 * Compute the value-set digest over ALL slots, then return slots with each value
 * gated: retained=false (value blanked) when secret-by-name/shape or oversized.
 * Deterministic and pure.
 */
export function redactSlots(slots: ParamSlot[]): RedactResult {
  if (slots.length === 0) return { observedParams: [], valueHash: undefined }

  const sig = slots
    .map((s) => `${s.loc}:${s.name}=${s.value}`)
    .sort()
    .join(" ")
  const valueHash = createHash("sha256").update(sig).digest("hex").slice(0, 16)

  const observedParams: ParamSlot[] = slots.slice(0, MAX_PARAMS).map((s) => {
    const retained = !denyByName(s.name) && !denyByValue(s.value) && s.value.length <= MAX_VALUE_LEN
    return { loc: s.loc, name: s.name, value: retained ? s.value : "", retained }
  })

  return { observedParams, valueHash }
}
