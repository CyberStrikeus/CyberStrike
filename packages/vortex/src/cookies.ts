// Structured cookie model. Cookies drive both auth (session theft / fixation) and CSRF/SameSite
// analysis, so the engine needs them as parsed objects — not a raw Set-Cookie string a rule has to
// re-parse every time. `responseCookies` powers the cookie-hardening rule; `requestCookies` and the
// parsed attributes feed the DSL cookie fields.
import type { Transaction } from "./transaction"
import { header, headerAll } from "./transaction"

export interface Cookie {
  name: string
  value: string
  path?: string
  domain?: string
  expires?: string
  maxAge?: number
  httpOnly: boolean
  secure: boolean
  sameSite?: string // raw attribute value: "Strict" | "Lax" | "None"
}

// Parse ONE Set-Cookie header value into a structured cookie. The first ";"-part is name=value;
// the rest are attributes (case-insensitive names).
export function parseSetCookie(raw: string): Cookie {
  const parts = raw.split(";")
  const first = parts[0] ?? ""
  const eq = first.indexOf("=")
  const name = (eq === -1 ? first : first.slice(0, eq)).trim()
  const value = eq === -1 ? "" : first.slice(eq + 1).trim()
  const cookie: Cookie = { name, value, httpOnly: false, secure: false }
  for (const attr of parts.slice(1)) {
    const a = attr.trim()
    const ai = a.indexOf("=")
    const key = (ai === -1 ? a : a.slice(0, ai)).trim().toLowerCase()
    const val = ai === -1 ? "" : a.slice(ai + 1).trim()
    if (key === "httponly") cookie.httpOnly = true
    else if (key === "secure") cookie.secure = true
    else if (key === "samesite") cookie.sameSite = val
    else if (key === "path") cookie.path = val
    else if (key === "domain") cookie.domain = val
    else if (key === "expires") cookie.expires = val
    else if (key === "max-age") {
      const n = Number(val)
      if (!Number.isNaN(n)) cookie.maxAge = n
    }
  }
  return cookie
}

// Every cookie the response sets (one per Set-Cookie header).
export function responseCookies(tx: Transaction): Cookie[] {
  if (!tx.response) return []
  return headerAll(tx.response.headers, "set-cookie").map(parseSetCookie)
}

// The request's cookies as a name→value map (from the single Cookie header: "a=1; b=2").
export function requestCookies(tx: Transaction): Record<string, string> {
  const out: Record<string, string> = {}
  const raw = header(tx.request.headers, "cookie")
  if (!raw) return out
  for (const pair of raw.split(";")) {
    const p = pair.trim()
    if (!p) continue
    const eq = p.indexOf("=")
    if (eq === -1) {
      out[p] = ""
      continue
    }
    out[p.slice(0, eq).trim()] = p.slice(eq + 1).trim()
  }
  return out
}
