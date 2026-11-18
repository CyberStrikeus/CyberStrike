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

// Response headers that disclose the stack/tech (and often a version) — a recon leak that narrows an
// attacker's search. HOST-SCOPED enumeration: the same banner leaks on every endpoint of a host, so the
// corpus rules (rules/headers.ts) fire ONCE per host off these fields. Split so a versioned banner
// (Apache/2.4.49 → maps to CVEs, feeds the version-CVE probe) reads `low` and a bare one (Apache) `info`
// (#5). Server / X-Powered-By keep canonical casing; framework headers keep the detector's lowercase (#15).
const DISCLOSURE: { name: string; label: string }[] = [
  { name: "server", label: "Server" },
  { name: "x-powered-by", label: "X-Powered-By" },
  { name: "x-aspnet-version", label: "x-aspnet-version" },
  { name: "x-aspnetmvc-version", label: "x-aspnetmvc-version" },
  { name: "x-generator", label: "x-generator" },
  { name: "x-runtime", label: "x-runtime" },
  { name: "via", label: "via" },
  { name: "x-backend-server", label: "x-backend-server" },
  { name: "x-served-by", label: "x-served-by" },
  { name: "x-drupal-dynamic-cache", label: "x-drupal-dynamic-cache" },
]
const VERSION_RX = /\d+\.\d+/

// The disclosure headers present on this response, as "Label: value" tokens. `versioned` selects the ones
// carrying a dotted version (low); the complement are bare (info). [] when none — mirrors missingHeaders so
// a corpus `where`/`having` gates on != "" and {detail} interpolates the list. Commas in a value are
// neutralized so the detail tokenizer (which splits on ",") keeps each banner whole.
export function disclosedBanners(tx: Transaction, versioned: boolean): string[] {
  if (!tx.response) return []
  const out: string[] = []
  for (const d of DISCLOSURE) {
    const value = header(tx.response.headers, d.name)
    if (!value) continue
    if (VERSION_RX.test(value) !== versioned) continue
    out.push(`${d.label}: ${value.replace(/,/g, ";")}`)
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
