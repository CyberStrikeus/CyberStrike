// Baseline header/cookie hygiene rules — authored as DATA (#16), not coded Rule.evaluate logic.
// This exact class (missing security headers, weak cookie flags, banner disclosure) was being missed
// for whole sessions: the passive layer couldn't see headers and the misconfig agent only eyeballed
// the one endpoint it happened to replay.
//
// All of it is now CONFIG-CLASS corpus rules (one signal per host, listing affected endpoints — #87):
// - missing-security-headers / weak-cookie-flags → the union of the missing/weak detail per host.
// - server-banner (low) / server-banner-bare (info) → stack/version disclosure is HOST-SCOPED
//   enumeration (the same Server/X-Powered-By leaks on every endpoint), so it fires detect-once per host
//   instead of per transaction — the 100x banner noise. Promoted here from the old per-header declarative
//   rules so the rule FORMAT itself carries the host scope and the agent never sees per-endpoint dupes.
// The computed "which headers / cookies / banners" detail lives as the missing_security_headers /
// weak_cookies / versioned_banners / bare_banners FIELDS (fields.ts) so the rules stay pure data.
import type { Rule, CorpusRule } from "../rule"
import { compileCorpusRule, type CorpusRuleDef } from "../corpus-rule"

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
  {
    // Versioned stack banners (Apache/2.4.49) — map to CVEs, feed the version-CVE probe → `low` (#5).
    // Separate id from the bare rule so a host disclosing both does not collide on dedupKey (id:host).
    id: "server-banner",
    title: "Stack/version disclosed in response banner",
    category: "misconfiguration",
    severity: "low",
    corpus: {
      groupBy: "host",
      where: 'versioned_banners != ""',
      having: 'any(versioned_banners != "")',
      list: "endpoint",
      detail: "versioned_banners",
    },
    message: "Versioned stack banner disclosed on {group} ({count} endpoints)",
    evidence: "Banners: {detail}. Affected endpoints: {list}",
    tags: ["info-disclosure", "banner"],
  },
  {
    // Bare stack banners (Apache, nginx, Express) — recon leak without a version → `info` (#5).
    id: "server-banner-bare",
    title: "Stack disclosed in response banner",
    category: "misconfiguration",
    severity: "info",
    corpus: {
      groupBy: "host",
      where: 'bare_banners != ""',
      having: 'any(bare_banners != "")',
      list: "endpoint",
      detail: "bare_banners",
    },
    message: "Stack banner disclosed on {group} ({count} endpoints)",
    evidence: "Banners: {detail}. Affected endpoints: {list}",
    tags: ["info-disclosure", "banner"],
  },
]

export const missingSecurityHeaders = compileCorpusRule(headerCorpusRuleDefs[0]!)
export const weakCookieFlags = compileCorpusRule(headerCorpusRuleDefs[1]!)
export const bannerVersions = compileCorpusRule(headerCorpusRuleDefs[2]!)
export const bannerDisclosures = compileCorpusRule(headerCorpusRuleDefs[3]!)

// No per-transaction header rules any more — banner disclosure moved to the detect-once corpus class
// above, so it fires once per host instead of once per endpoint.
export const headerRules: Rule[] = []

// Config-class header rules in the detect-once format (one signal per host).
export const headerCorpusRules: CorpusRule[] = [missingSecurityHeaders, weakCookieFlags, bannerVersions, bannerDisclosures]
