// Baseline header/cookie hygiene rules — now authored as DATA (#16), not coded Rule.evaluate logic.
// This exact class (missing security headers, weak cookie flags, banner disclosure) was being missed
// for whole sessions: the passive layer couldn't see headers and the misconfig agent only eyeballed
// the one endpoint it happened to replay.
//
// - server-banner  → per-header DECLARATIVE rules (DISCLOSURE_HEADERS × {bare, versioned}); the
//   computed "which headers/cookies" detail lives as the missing_security_headers / weak_cookies
//   FIELDS (fields.ts) so the rules stay pure data.
// - missing-security-headers / weak-cookie-flags → CONFIG-CLASS corpus rules (one signal per host,
//   listing affected endpoints + the union of the missing/weak detail — issue #87).
import type { Rule, CorpusRule } from "../rule"
import { compileRule, type DeclarativeRule } from "../declarative"
import { compileCorpusRule, type CorpusRuleDef } from "../corpus-rule"

// ── Banner disclosure (per-header declarative rules) ─────────────────────────
// Response headers that disclose the stack/tech (and often a version) — a recon leak that narrows an
// attacker's search. A banner carrying a version (Apache/2.4.49) maps to CVEs and feeds the version-CVE
// probe, so it is `low`; a bare one (Apache) is `info` (#5). name = the header looked up; label = how it
// reads. Server / X-Powered-By keep canonical casing; framework headers keep the CS detector's lowercase
// (#15 parity). All rules share id "server-banner" (one rule CLASS); dedup is per host+value.
const DISCLOSURE_HEADERS: { name: string; label: string }[] = [
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

// A dotted version in the banner (\d+\.\d+) — splitting each header into a versioned (low) and a bare
// (info) rule with mutually-exclusive `when` keeps the severity/title conditional as pure data.
const VERSION_RX = '\\d+\\.\\d+'

export const bannerRuleDefs: DeclarativeRule[] = DISCLOSURE_HEADERS.flatMap(({ name, label }) => {
  const field = `resp.header.${name}`
  const dedupBy = `{host}:{${field}}`
  const common = { id: "server-banner", category: "misconfiguration", evidence: `${label}: {${field}}`, dedupBy, tags: ["info-disclosure", "banner"] }
  return [
    {
      ...common,
      severity: "low" as const,
      when: `${field} && regex("${VERSION_RX}", ${field})`,
      message: `${label} version disclosed`,
    },
    {
      ...common,
      severity: "info" as const,
      when: `${field} && !regex("${VERSION_RX}", ${field})`,
      message: `${label} disclosed`,
    },
  ]
})

export const bannerRules: Rule[] = bannerRuleDefs.map(compileRule)

// ── Config-class corpus rules (detect-once per host — issue #87) ─────────────
export const headerCorpusRuleDefs: CorpusRuleDef[] = [
  {
    id: "missing-security-headers",
    title: "Missing security response headers",
    category: "misconfiguration",
    severity: "low",
    corpus: {
      groupBy: "host",
      where: 'missing_security_headers != ""', // content response missing ≥1 required header (field gates on isContentResponse)
      having: 'any(missing_security_headers != "")',
      list: "endpoint",
      detail: "missing_security_headers",
    },
    message: "Missing security headers on {group} ({count} endpoints)",
    evidence: "Missing: {detail}. Affected endpoints: {list}",
    tags: ["misconfig", "security-headers"],
  },
  {
    id: "weak-cookie-flags",
    title: "Cookie set without hardening flags",
    category: "misconfiguration",
    severity: "medium",
    corpus: {
      groupBy: "host",
      where: 'weak_cookies != ""',
      having: 'any(weak_cookies != "")',
      list: "endpoint",
      detail: "weak_cookies",
    },
    message: "Cookies missing hardening flags on {group} ({count} endpoints)",
    evidence: "Weak cookies: {detail}. Affected endpoints: {list}",
    tags: ["misconfig", "cookies"],
  },
]

export const missingSecurityHeaders = compileCorpusRule(headerCorpusRuleDefs[0]!)
export const weakCookieFlags = compileCorpusRule(headerCorpusRuleDefs[1]!)

// Per-transaction header rules registered into the baseline (the banner rules).
export const headerRules: Rule[] = bannerRules

// Config-class header rules in the detect-once format (one signal per host).
export const headerCorpusRules: CorpusRule[] = [missingSecurityHeaders, weakCookieFlags]
