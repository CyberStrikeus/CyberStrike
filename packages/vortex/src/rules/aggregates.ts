// Aggregate rules (data, not code) — the DECLARATIVE half of the "detect-once" config-class format
// (issue #87): collapse a class that recurs across many URLs into ONE finding listing every affected
// endpoint, instead of one signal per URL. Same per-transaction `when` as a passive rule; the
// `aggregate` block rolls the matches up. See ../aggregate.ts for the shape, and corpus.ts/rollupByHost
// for the code variant (when the finding needs a computed detail a single `when` can't express).
//
// SCOPE: default `groupBy: "host"` — a config finding is a property of EACH host (a session can span
// api/app/admin, and admin.* being misconfigured while www.* is fine must stay visible). Use "ruleId"
// (one finding for the whole session) only when the host genuinely doesn't matter.
import type { AggregateRule } from "../aggregate"

export const aggregateRules: AggregateRule[] = [
  {
    id: "cors-origin-reflection-with-credentials",
    category: "misconfiguration",
    severity: "high",
    when: 'req.header.origin && resp.header.access-control-allow-origin == req.header.origin && icontains(resp.header.access-control-allow-credentials, "true")',
    aggregate: { groupBy: "host", list: "endpoint" },
    message: "CORS reflects Origin and allows credentials on {host} ({count} endpoint(s)) — any origin can read authenticated responses",
    evidence: "Affected endpoints: {endpoints}",
    tags: ["cors", "misconfig"],
  },
  {
    id: "cors-wildcard-origin",
    category: "misconfiguration",
    severity: "low",
    when: 'resp.header.access-control-allow-origin == "*"',
    aggregate: { groupBy: "host", list: "endpoint" },
    message: "Wildcard CORS (Access-Control-Allow-Origin: *) on {host} ({count} endpoint(s))",
    evidence: "Affected endpoints: {endpoints}",
    tags: ["cors", "misconfig"],
  },
  {
    id: "cors-null-origin-with-credentials",
    category: "misconfiguration",
    severity: "high",
    when: 'resp.header.access-control-allow-origin == "null" && icontains(resp.header.access-control-allow-credentials, "true")',
    aggregate: { groupBy: "host", list: "endpoint" },
    message: "CORS allows null origin with credentials on {host} ({count} endpoint(s)) — sandboxed iframe can read authenticated responses",
    evidence: "Affected endpoints: {endpoints}",
    tags: ["cors", "misconfig"],
  },
  {
    id: "unsafe-referrer-policy",
    category: "misconfiguration",
    severity: "medium",
    when: 'resp.header.referrer-policy && (resp.header.referrer-policy == "unsafe-url" || resp.header.referrer-policy == "no-referrer-when-downgrade")',
    aggregate: { groupBy: "host", list: "endpoint" },
    message: "Unsafe Referrer-Policy ({resp.header.referrer-policy}) on {host} ({count} endpoint(s)) — full URL leaked to third parties",
    evidence: "Affected endpoints: {endpoints}",
    tags: ["misconfig", "privacy"],
  },
  {
    id: "x-powered-by-disclosed",
    category: "misconfiguration",
    severity: "info",
    when: "resp.header.x-powered-by",
    aggregate: { groupBy: "host", list: "endpoint" },
    message: "X-Powered-By header disclosed on {host} ({count} endpoint(s))",
    evidence: "Affected endpoints: {endpoints}",
    tags: ["misconfig", "info-disclosure"],
  },
  {
    id: "insecure-redirect-downgrade",
    category: "misconfiguration",
    severity: "medium",
    when: 'resp.status >= 300 && resp.status < 400 && starts_with(resp.header.location, "http://")',
    aggregate: { groupBy: "host", list: "endpoint" },
    message: "HTTPS→HTTP redirect downgrade on {host} ({count} endpoint(s)) — credentials may transit cleartext",
    evidence: "Affected endpoints: {endpoints}",
    tags: ["misconfig", "tls"],
  },
]
