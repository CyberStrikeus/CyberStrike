// Value correlation (taint / dataflow). The strong way to find a chain across thousands of
// requests is NOT to guess the field name (token? code? t?) — it's to correlate by VALUE: a
// token-like value that appears in response A and later appears in request B, wherever it sits.
// The field name is unknown; the value is the invariant. `responseValues` / `requestValues` pull
// the candidate values out of each side; `sharedValues` is their intersection.
import type { Transaction } from "./transaction"
import { header, headerAll } from "./transaction"
import { params } from "./params"
import { responseFields } from "./params"
import { requestCookies } from "./cookies"

// Is a value worth correlating? Filters out the sea of short/common values so a coincidental match
// (a "1", a status word) is not treated as dataflow. Token-ish charset + length/entropy.
export function correlatable(v: string): boolean {
  if (v.length < 8 || v.length > 4096) return false
  if (!/^[A-Za-z0-9._=\/+-]+$/.test(v)) return false
  if (/^\d+$/.test(v)) return v.length >= 12 // long numeric ids ok; short numbers too noisy
  if (v.length >= 16) return true // uuid / jwt / long hex / opaque id
  return /[A-Za-z]/.test(v) && /\d/.test(v) // 8–15 chars: require a letter+digit mix
}

// Candidate values a RESPONSE exposes (flattened body fields + Set-Cookie values), filtered to the
// correlatable ones — these are what could leak downstream.
export function responseValues(tx: Transaction): Set<string> {
  const out = new Set<string>()
  if (!tx.response) return out
  for (const v of Object.values(responseFields(tx))) if (correlatable(v)) out.add(v)
  for (const raw of headerAll(tx.response.headers, "set-cookie")) {
    const val = raw.split(";", 1)[0]?.split("=").slice(1).join("=") ?? ""
    if (correlatable(val)) out.add(val)
  }
  return out
}

// Every value a REQUEST carries — query, body fields, cookies, path segments, and the token parts
// of auth-ish headers (Authorization/X-Api-Key/X-CSRF split on whitespace so "Bearer <t>" yields
// "<t>"). Unfiltered on the way in; correlation happens by intersecting with correlatable response
// values, so a bare token in any position is caught.
export function requestValues(tx: Transaction): Set<string> {
  const out = new Set<string>()
  const p = params(tx)
  for (const v of Object.values(p.query)) out.add(v)
  for (const v of Object.values(p.body)) out.add(v)
  for (const v of Object.values(requestCookies(tx))) out.add(v)
  for (const seg of new URL(tx.request.url, "https://x").pathname.split("/")) if (seg) out.add(seg)
  for (const name of ["authorization", "x-api-key", "x-csrf-token", "x-auth-token"]) {
    const h = header(tx.request.headers, name)
    if (h) for (const part of h.split(/\s+/)) if (part) out.add(part)
  }
  return out
}

// Correlatable values present in `src`'s response AND reused anywhere in `sink`'s request.
export function sharedValues(src: Transaction, sink: Transaction): string[] {
  const carried = requestValues(sink)
  const out: string[] = []
  for (const v of responseValues(src)) if (carried.has(v)) out.push(v)
  return out
}
