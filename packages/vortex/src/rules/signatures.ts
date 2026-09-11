// Response-signature rules, written in the declarative DSL (dogfooding it). These are passive: an
// error/secret pattern in a response body is a strong, cheap, deterministic signal. Because they
// are plain data, an agent can read them as examples and add more the same way. The multiple
// patterns per rule collapse into ONE case-insensitive regex alternation — cleaner than an OR chain.
import type { DeclarativeRule } from "../declarative"

export const signatureRules: DeclarativeRule[] = [
  {
    id: "sql-error-signature",
    category: "injection",
    severity: "high",
    when: 'regex("SQL syntax|SQLSTATE|ORA-[0-9]{4,}|You have an error in your SQL|unterminated quoted string", resp.body)',
    message: "SQL error signature in the response of {endpoint}",
    evidence: "{resp.status} on {req.method} {req.path}",
    dedupBy: "endpoint",
  },
  {
    id: "stack-trace-signature",
    category: "misconfiguration",
    severity: "medium",
    when: 'regex("Traceback [(]most recent call last[)]|at [\\w.$]+[(][\\w.]+:[0-9]+[)]|System[.]Exception", resp.body)',
    message: "Stack trace / verbose error leaked by {endpoint}",
    dedupBy: "endpoint",
  },
  {
    id: "secret-in-response",
    category: "info-disclosure",
    severity: "high",
    when: 'regex("-----BEGIN [A-Z ]*PRIVATE KEY-----|AKIA[0-9A-Z]{16}|eyJ[A-Za-z0-9_-]{10,}[.]eyJ", resp.body)',
    message: "Sensitive material (key/token) in the response of {endpoint}",
    dedupBy: "endpoint",
  },
  {
    // An absolute filesystem path leaking in a body (verbose error / debug output) — discloses the
    // server's layout. Depth/root-gated + length-bounded so it does not match an ordinary URL path and
    // stays ReDoS-safe. Ported from the CS FullPathDisclosureDetector (signal-fabric parity, #15).
    id: "full-path-disclosure",
    category: "misconfiguration",
    severity: "low",
    when: 'regex("(?:/(?:var|etc|home|usr|opt|srv|www|app)/[\\w.\\-]+/[\\w./\\-]{1,110})|(?:[A-Za-z]:\\\\\\\\[\\w.\\\\\\\\/\\-]{3,120})", resp.body)',
    message: "Filesystem path disclosed in the response of {endpoint}",
    dedupBy: "endpoint",
    tags: ["info-disclosure"],
  },
]
