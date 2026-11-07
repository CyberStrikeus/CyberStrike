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
    // Superset of the CS Observe sqli battery (#15 detection parity): MySQL/PG/Oracle/MSSQL/SQLite
    // driver errors + the classic quotation/syntax messages. Widened so retiring the CS fabric loses
    // no coverage.
    when: 'regex("SQL syntax|mysql_fetch|valid MySQL result|You have an error in your SQL|SQLSTATE|ORA-[0-9]{4,}|PostgreSQL.*ERROR|SQLite3?::|Unclosed quotation mark|quoted string not properly terminated|unterminated quoted string|Incorrect syntax near", resp.body)',
    message: "SQL error signature in the response of {endpoint}",
    evidence: "{resp.status} on {req.method} {req.path}",
    dedupBy: "endpoint",
  },
  {
    id: "stack-trace-signature",
    category: "misconfiguration",
    severity: "medium",
    // Superset of the CS Observe stacktrace battery (#15 detection parity): the Python traceback, a
    // JVM "Exception in thread", a .NET System.Exception, and a Java-style `at pkg.Class(File:line)`.
    when: 'regex("Traceback [(]most recent call last[)]|Exception in thread|at [\\w.$]+[(][\\w.]+:[0-9]+[)]|System[.]Exception", resp.body)',
    message: "Stack trace / verbose error leaked by {endpoint}",
    dedupBy: "endpoint",
  },
  {
    id: "secret-in-response",
    category: "info-disclosure",
    severity: "high",
    // Superset of the CS SECRET_PATTERNS (#15 detection parity): private keys, AWS access-key ids
    // (long-term AKIA + temporary ASIA), Google API keys (AIza…), Slack tokens (xox…).
    // JWT moved to the dedicated jwt-leak-response rule in auth.ts (separate category + routing).
    when: 'regex("-----BEGIN [A-Z ]*PRIVATE KEY-----|(AKIA|ASIA)[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|xox[baprs]-[0-9A-Za-z-]{10,}", resp.body)',
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
