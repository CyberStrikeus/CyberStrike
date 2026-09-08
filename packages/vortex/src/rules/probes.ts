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
  },
]
