// Misconfiguration & information-disclosure rules, authored in the declarative DSL (data, not code).
// Each is deliberately LOW false-positive: a precise signature or a field-to-field condition the
// DSL's functions make expressible. Passive — they match one captured response.
import type { DeclarativeRule } from "../declarative"

export const misconfigRules: DeclarativeRule[] = [
  {
    // The dangerous CORS combo: the server REFLECTS the request Origin AND allows credentials — any
    // site can read authenticated responses. Field-to-field (ACAO == the request's Origin), guarded
    // so two empty headers don't match. `*` + credentials is the separate (weaker) wildcard rule.
    id: "cors-origin-reflection-with-credentials",
    category: "misconfiguration",
    severity: "high",
    when: 'req.header.origin && resp.header.access-control-allow-origin == req.header.origin && icontains(resp.header.access-control-allow-credentials, "true")',
    message: "CORS reflects Origin and allows credentials at {endpoint} — any origin can read authenticated responses",
    evidence: "ACAO={resp.header.access-control-allow-origin} ACAC={resp.header.access-control-allow-credentials}",
    dedupBy: "endpoint",
    tags: ["cors", "misconfig"],
  },
  {
    id: "cors-wildcard-origin",
    category: "misconfiguration",
    severity: "low",
    when: 'resp.header.access-control-allow-origin == "*"',
    message: "Wildcard CORS (Access-Control-Allow-Origin: *) at {endpoint}",
    dedupBy: "endpoint",
    tags: ["cors", "misconfig"],
  },
  {
    id: "directory-listing",
    category: "misconfiguration",
    severity: "low",
    when: 'regex("<title>Index of /|Directory listing for /", resp.body)',
    message: "Directory listing exposed at {endpoint}",
    dedupBy: "endpoint",
    tags: ["exposure", "misconfig"],
  },
  {
    // Interactive debuggers / verbose framework error pages — RCE-adjacent (Werkzeug/web-console
    // allow code exec), and always over-share internals.
    id: "debug-console-exposed",
    category: "misconfiguration",
    severity: "high",
    when: 'regex("Werkzeug Debugger|web-console|Whoops\\\\b|Symfony.*Profiler|You.re seeing this error because you have DEBUG = True", resp.body)',
    message: "Interactive debugger / debug error page exposed at {endpoint}",
    evidence: "{resp.status} on {req.method} {req.path}",
    dedupBy: "endpoint",
    tags: ["debug", "misconfig", "rce-adjacent"],
  },
  {
    // A GraphQL response carrying introspection structure means __schema is enabled — the whole API
    // surface is readable. Match the introspection result shape in the body.
    id: "graphql-introspection-enabled",
    category: "misconfiguration",
    severity: "medium",
    when: 'regex("\\"__schema\\"|\\"queryType\\"|\\"__type\\"", resp.body)',
    message: "GraphQL introspection enabled at {endpoint}",
    dedupBy: "endpoint",
    tags: ["graphql", "misconfig"],
  },
  {
    // Internal hostnames leaked in a response (kept to internal TLDs — low false-positive, unlike a
    // bare private-IP regex which collides with version strings).
    id: "internal-hostname-leak",
    category: "info-disclosure",
    severity: "low",
    when: 'regex("\\b[a-z0-9-]+\\.(local|internal|corp|intranet|lan)\\b", resp.body)',
    message: "Internal hostname leaked in the response of {endpoint}",
    dedupBy: "endpoint",
    tags: ["info-disclosure"],
  },
]
