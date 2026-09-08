// Baseline header/cookie hygiene rules — deterministic, run on every response. These exist because
// this exact class (missing security headers, weak cookie flags, banner disclosure) was being
// missed for whole sessions: the passive layer couldn't see headers and the misconfig agent only
// eyeballed the one endpoint it happened to replay. A rule fires on EVERY transaction that has a
// response, so coverage no longer depends on agent initiative.
import type { Transaction } from "../transaction"
import { header, headerAll } from "../transaction"
import type { Rule, Signal } from "../rule"
import { endpointKey } from "../endpoint"
import { isContentResponse } from "../scope"

function sig(ruleId: string, tx: Transaction, over: Partial<Signal> & Pick<Signal, "severity" | "category" | "title">): Signal {
  return { ruleId, transactionId: tx.id, ...over }
}

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
]

export const missingSecurityHeaders: Rule = {
  id: "missing-security-headers",
  title: "Missing security response headers",
  category: "misconfiguration",
  severity: "low",
  evaluate(tx) {
    // Only real content responses — not redirects, not static assets (a .js bundle or a 301 doesn't
    // need CSP the way a document/API does; firing there is pure noise).
    if (!isContentResponse(tx)) return []
    const headers = tx.response!.headers
    const csp = header(headers, "content-security-policy")
    const missing: string[] = []
    for (const req of REQUIRED) {
      if (header(headers, req.name)) continue
      if (req.alt && req.alt(csp)) continue
      missing.push(req.label)
    }
    if (missing.length === 0) return []
    return [
      sig(this.id, tx, {
        severity: "low",
        category: "misconfiguration",
        title: "Missing security headers",
        evidence: `missing: ${missing.join(", ")}`,
        // Endpoint + which headers — so 100 instances of one endpoint collapse to one signal.
        dedupKey: `${this.id}:${endpointKey(tx)}:${missing.join(",")}`,
      }),
    ]
  },
}

// One cookie should carry HttpOnly + Secure + SameSite. A session/auth cookie without these is
// exposed to XSS theft / CSRF / MITM. We flag per Set-Cookie the flags it lacks.
export const weakCookieFlags: Rule = {
  id: "weak-cookie-flags",
  title: "Cookie set without hardening flags",
  category: "misconfiguration",
  severity: "medium",
  evaluate(tx) {
    if (!tx.response) return []
    const out: Signal[] = []
    for (const raw of headerAll(tx.response.headers, "set-cookie")) {
      const name = raw.split("=", 1)[0]?.trim() || "(cookie)"
      // Attributes are ";"-separated and case-insensitive; checking the attribute tokens avoids a
      // false match when the cookie's NAME/VALUE happens to contain "secure"/"samesite".
      const attrs = raw
        .split(";")
        .slice(1)
        .map((a) => a.trim().toLowerCase())
      const lacks: string[] = []
      if (!attrs.includes("httponly")) lacks.push("HttpOnly")
      if (!attrs.includes("secure")) lacks.push("Secure")
      if (!attrs.some((a) => a.startsWith("samesite"))) lacks.push("SameSite")
      if (lacks.length === 0) continue
      out.push(
        sig(this.id, tx, {
          severity: "medium",
          category: "misconfiguration",
          title: `Cookie "${name}" missing ${lacks.join(", ")}`,
          evidence: raw.slice(0, 120),
          dedupKey: `${this.id}:${endpointKey(tx)}:${name}`,
        }),
      )
    }
    return out
  },
}

// Server / X-Powered-By disclose the stack (and often a version) — an info-level recon leak that
// narrows an attacker's search. Low value alone, but deterministic and free to surface.
export const serverBanner: Rule = {
  id: "server-banner",
  title: "Server / technology banner disclosed",
  category: "misconfiguration",
  severity: "info",
  evaluate(tx) {
    if (!tx.response) return []
    const out: Signal[] = []
    const server = header(tx.response.headers, "server")
    const powered = header(tx.response.headers, "x-powered-by")
    // A banner is per-SERVER, not per-endpoint — dedup by host+value so one host yields one signal,
    // not one per request.
    if (server) out.push(sig(this.id, tx, { severity: "info", category: "misconfiguration", title: "Server banner disclosed", evidence: `Server: ${server}`, dedupKey: `${this.id}:${tx.host}:server:${server}` }))
    if (powered) out.push(sig(this.id, tx, { severity: "info", category: "misconfiguration", title: "X-Powered-By disclosed", evidence: `X-Powered-By: ${powered}`, dedupKey: `${this.id}:${tx.host}:powered:${powered}` }))
    return out
  },
}

// The baseline header rule pack — everything OSS.
export const headerRules: Rule[] = [missingSecurityHeaders, weakCookieFlags, serverBanner]
