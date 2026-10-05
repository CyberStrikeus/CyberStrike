// Baseline header/cookie hygiene rules — deterministic, over the whole corpus. These exist because
// this exact class (missing security headers, weak cookie flags, banner disclosure) was being missed
// for whole sessions: the passive layer couldn't see headers and the misconfig agent only eyeballed
// the one endpoint it happened to replay.
//
// Missing-headers and weak-cookies are CONFIG-CLASS findings — a property of the HOST, not each URL
// (issue #87). They are authored in the "detect-once" format (see corpus.ts/rollupByHost): one signal
// per host, every affected endpoint listed in the evidence — full coverage, no per-endpoint spam.
import type { Transaction } from "../transaction"
import { header } from "../transaction"
import type { Rule, CorpusRule, Signal } from "../rule"
import { rollupByHost } from "../corpus"
import { isContentResponse } from "../scope"
import { responseCookies } from "../cookies"

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

// Which required security headers a content response is missing (applying the alt rule), or [] if none.
function missingHeaders(tx: Transaction): string[] {
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

// CONFIG-CLASS, detect-once (issue #87): missing security headers are a per-HOST property. One signal
// per host, listing every affected content endpoint + the union of headers missing anywhere on it —
// not one signal per URL (which flooded the queue with dozens of identical findings).
export const missingSecurityHeaders: CorpusRule = {
  id: "missing-security-headers",
  title: "Missing security response headers",
  category: "misconfiguration",
  severity: "low",
  evaluate(txs: Transaction[]): Signal[] {
    return rollupByHost(txs, {
      id: this.id,
      category: "misconfiguration",
      severity: "low",
      match: (tx) => {
        const missing = missingHeaders(tx)
        return missing.length ? missing.join(", ") : undefined
      },
      title: (host, n) => `Missing security headers on ${host} (${n} endpoint${n === 1 ? "" : "s"})`,
      evidence: (_host, endpoints, detail) => `Missing: ${detail}. Affected endpoints: ${endpoints}`,
    })
  },
}

// Which hardening flags a Set-Cookie lacks, summarized per cookie for this response, or [] if all good.
function weakCookies(tx: Transaction): string[] {
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

// CONFIG-CLASS, detect-once (issue #87): a cookie set without HttpOnly/Secure/SameSite is exposed to
// XSS theft / CSRF / MITM. The same cookie is set across many endpoints on a host, so roll up to ONE
// signal per host listing each weak cookie (+ its missing flags) and the affected endpoints.
export const weakCookieFlags: CorpusRule = {
  id: "weak-cookie-flags",
  title: "Cookie set without hardening flags",
  category: "misconfiguration",
  severity: "medium",
  evaluate(txs: Transaction[]): Signal[] {
    return rollupByHost(txs, {
      id: this.id,
      category: "misconfiguration",
      severity: "medium",
      match: (tx) => {
        const weak = weakCookies(tx)
        return weak.length ? weak.join(", ") : undefined
      },
      title: (host, n) => `Cookies missing hardening flags on ${host} (${n} endpoint${n === 1 ? "" : "s"})`,
      evidence: (_host, endpoints, detail) => `Weak cookies: ${detail}. Affected endpoints: ${endpoints}`,
    })
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
    // Framework/version banners the CS detector also surfaced (parity, #15).
    for (const name of ["x-aspnet-version", "x-aspnetmvc-version", "x-generator"]) {
      const v = header(tx.response.headers, name)
      if (v) out.push(sig(this.id, tx, { severity: "info", category: "misconfiguration", title: `${name} disclosed`, evidence: `${name}: ${v}`, dedupKey: `${this.id}:${tx.host}:${name}:${v}` }))
    }
    return out
  },
}

// Per-transaction header rules. serverBanner stays per-tx: it already dedups per host+value (one
// signal per distinct banner), so it is not a per-endpoint spam source.
export const headerRules: Rule[] = [serverBanner]

// Config-class header rules in the detect-once format (one signal per host). Registered as corpus
// rules (see index.ts → baselineCorpusRules).
export const headerCorpusRules: CorpusRule[] = [missingSecurityHeaders, weakCookieFlags]
