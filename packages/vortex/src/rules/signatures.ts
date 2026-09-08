// Response-signature rules, written in the declarative DSL (dogfooding it). These are passive: an
// error/secret pattern in a response body is a strong, cheap, deterministic signal. Because they
// are plain data, an agent can read them as examples and add more the same way.
import type { DeclarativeRule } from "../declarative"

export const signatureRules: DeclarativeRule[] = [
  {
    id: "sql-error-signature",
    category: "injection",
    severity: "high",
    when:
      'resp.body:~"SQL syntax" OR resp.body:~"SQLSTATE" OR resp.body:~"ORA-[0-9]{4,}" OR resp.body:~"You have an error in your SQL" OR resp.body:~"unterminated quoted string"',
    message: "SQL error signature in the response of {endpoint}",
    evidence: "{resp.status} on {req.method} {req.path}",
    dedupBy: "endpoint",
  },
  {
    id: "stack-trace-signature",
    category: "misconfiguration",
    severity: "medium",
    when: 'resp.body:~"Traceback [(]most recent call last[)]" OR resp.body:~"at [\\w.$]+[(][\\w.]+:[0-9]+[)]" OR resp.body:~"System[.]Exception"',
    message: "Stack trace / verbose error leaked by {endpoint}",
    dedupBy: "endpoint",
  },
  {
    id: "secret-in-response",
    category: "info-disclosure",
    severity: "high",
    when: 'resp.body:~"-----BEGIN [A-Z ]*PRIVATE KEY-----" OR resp.body:~"AKIA[0-9A-Z]{16}" OR resp.body:~"eyJ[A-Za-z0-9_-]{10,}[.]eyJ"',
    message: "Sensitive material (key/token) in the response of {endpoint}",
    dedupBy: "endpoint",
  },
]
