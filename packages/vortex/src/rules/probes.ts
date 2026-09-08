// Probe-rule catalog, written in the active DSL (inject-probe's playbooks as data). These target
// common parameter names as EXAMPLES; a deployment authors its own ProbeRules against the app's
// real parameters (or a future "fuzz every param" mode). They demonstrate the two detect styles:
// canary reflection and a response-signature match.
import type { ProbeRule } from "../probe"

export const probeRules: ProbeRule[] = [
  {
    id: "reflected-xss-lead",
    category: "injection",
    severity: "medium",
    select: "resp.bodyKind:html AND req.query.q:*",
    inject: { into: "query", name: "q", payloads: ["<vx>{canary}</vx>"], canary: true },
    detect: "reflected", // the canary bounced back into the response → reflection lead
    message: "reflected input at {endpoint} (param q)",
  },
  {
    id: "sql-error-probe",
    category: "injection",
    severity: "high",
    select: "req.query.id:*",
    inject: { into: "query", name: "id", payloads: ["'", "1' OR '1'='1"] },
    detect: 'resp.body:~"SQL syntax" OR resp.body:~"SQLSTATE" OR resp.body:~"unterminated quoted string"',
    message: "SQL error provoked at {endpoint} (param id)",
  },
]
