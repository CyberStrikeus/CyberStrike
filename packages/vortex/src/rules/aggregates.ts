// Aggregate rules (data, not code) — collapse a class that recurs across many URLs into ONE finding
// that lists every affected endpoint, instead of one signal per URL. Same per-transaction `when` as a
// passive rule; the `aggregate` block rolls the matches up. See ../aggregate.ts for the shape.
//
// CORS is the canonical case: origin-reflection / wildcard recur on dozens of endpoints and can't be
// reported one-by-one. groupBy "ruleId" ⇒ a single finding per rule, {endpoints} enumerating the URLs.
import type { AggregateRule } from "../aggregate"

export const aggregateRules: AggregateRule[] = [
  {
    // The dangerous CORS combo: server REFLECTS the request Origin AND allows credentials — any site
    // can read authenticated responses. One finding across every endpoint that does it.
    id: "cors-origin-reflection-with-credentials",
    category: "misconfiguration",
    severity: "high",
    when: 'req.header.origin && resp.header.access-control-allow-origin == req.header.origin && icontains(resp.header.access-control-allow-credentials, "true")',
    aggregate: { groupBy: "ruleId", list: "endpoint" },
    message: "CORS reflects Origin and allows credentials on {count} endpoint(s) — any origin can read authenticated responses",
    evidence: "Affected endpoints: {endpoints}",
    tags: ["cors", "misconfig"],
  },
  {
    id: "cors-wildcard-origin",
    category: "misconfiguration",
    severity: "low",
    when: 'resp.header.access-control-allow-origin == "*"',
    aggregate: { groupBy: "ruleId", list: "endpoint" },
    message: "Wildcard CORS (Access-Control-Allow-Origin: *) on {count} endpoint(s)",
    evidence: "Affected endpoints: {endpoints}",
    tags: ["cors", "misconfig"],
  },
]
