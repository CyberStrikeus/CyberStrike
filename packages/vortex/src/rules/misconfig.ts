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
  {
    // Passive open redirect: a 3xx whose Location is an OFF-ORIGIN absolute/protocol-relative URL that
    // is REFLECTED verbatim from the request (the redirect target came from attacker input). Catches
    // the un-encoded reflected case seen in captured traffic; the encoded/host-only cases are left to
    // the active open-redirect-probe. Ported from the CS OpenRedirectDetector (#15).
    id: "open-redirect-reflected",
    category: "redirect",
    severity: "medium",
    when: 'resp.status >= 300 && resp.status < 400 && regex("^https?://|^//", resp.header.location) && contains(req.url, resp.header.location)',
    message: "Reflected open redirect at {endpoint} → {resp.header.location}",
    evidence: "{resp.status} Location: {resp.header.location}",
    dedupBy: "endpoint",
    tags: ["redirect"],
  },
  {
    // A VCS/config/backup artifact served with a 200 — source, secrets or config exposed under the
    // webroot (.git, .env, .htaccess, web.config, .DS_Store, *.bak/old/sql/zip/…). Path-matched +
    // status-gated to stay low-false-positive. Ported from the CS ExposedArtifactDetector (#15).
    id: "exposed-artifact",
    category: "misconfiguration",
    severity: "medium",
    when: 'resp.status == 200 && regex("/\\.git(/|$)|/\\.svn/|/\\.env$|/\\.htaccess$|/web\\.config$|/\\.DS_Store$|\\.(bak|old|swp|orig|sql|tar|tgz|zip)($|\\?)", req.path)',
    message: "Exposed artifact served at {endpoint}",
    evidence: "200 on {req.method} {req.path}",
    dedupBy: "endpoint",
    tags: ["exposure", "misconfig"],
  },
]
