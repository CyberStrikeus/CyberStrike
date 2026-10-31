// Computed security-hygiene details shared by the field layer (fields.ts exposes these as the
// `missing_security_headers` / `weak_cookies` computed fields) and read by the declarative
// header rules (rules/headers.ts). The logic is COMPUTED (it applies the alt-satisfies rule and parses
// cookie flags), which is exactly the detail a plain `when` can't express — so it lives as a field the
// rule DSL can reference, keeping the rules themselves pure data (#16).
import type { Transaction } from "./transaction"
import { header } from "./transaction"
import { isContentResponse } from "./scope"
import { responseCookies } from "./cookies"

// The security response headers a hardened app is expected to set. `alt` lets one requirement be
// satisfied by an equivalent (X-Frame-Options OR a CSP frame-ancestors directive).
const REQUIRED: { name: string; label: string; alt?: (csp: string | undefined) => boolean }[] = [
  { name: "strict-transport-security", label: "HSTS" },
  { name: "content-security-policy", label: "CSP" },
  { name: "x-content-type-options", label: "X-Content-Type-Options" },
  {
    name: "x-frame-options",
    label: "X-Frame-Options",
    alt: (csp) => !!csp && /frame-ancestors/i.test(csp),
  },
  { name: "referrer-policy", label: "Referrer-Policy" },
  { name: "permissions-policy", label: "Permissions-Policy" },
]

// Which required security headers a content response is missing (applying the alt rule), or [] if none.
export function missingHeaders(tx: Transaction): string[] {
  if (!isContentResponse(tx)) return []
  const headers = tx.response!.headers
  const csp = header(headers, "content-security-policy")
  const out: string[] = []
  for (const req of REQUIRED) {
    if (header(headers, req.name)) continue
    if (req.alt && req.alt(csp)) continue
    out.push(req.label)
  }
  return out
}

// Which hardening flags a Set-Cookie lacks, summarized per cookie for this response, or [] if all good.
export function weakCookies(tx: Transaction): string[] {
  if (!tx.response) return []
  const out: string[] = []
  for (const cookie of responseCookies(tx)) {
    const lacks: string[] = []
    if (!cookie.httpOnly) lacks.push("HttpOnly")
    if (!cookie.secure) lacks.push("Secure")
    if (!cookie.sameSite) lacks.push("SameSite")
    if (lacks.length) out.push(`${cookie.name || "(cookie)"} (${lacks.join("+")})`)
  }
  return out
}
