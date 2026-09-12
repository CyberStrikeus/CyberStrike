// Auth / credential-exposure rules (declarative DSL, passive). The JWT one decodes read-only via the
// engine's jwt_alg function — exactly the detection a plain field query can't do.
import type { DeclarativeRule } from "../declarative"

export const authRules: DeclarativeRule[] = [
  {
    // A request whose bearer JWT is unsigned (alg:none). lower() so the classic bypass variants
    // None / NONE / nOnE are caught too (== is case-sensitive in the DSL).
    id: "jwt-alg-none",
    category: "auth",
    severity: "high",
    when: 'lower(jwt_alg(req.header.authorization)) == "none"',
    message: "Unsigned JWT (alg:none) presented at {endpoint} — auth may be forgeable",
    evidence: "Authorization carries an alg:none token",
    dedupBy: "endpoint",
    tags: ["auth", "jwt"],
  },
  {
    // A JWT (header.payload.signature) appears in the response body — the server is leaking a
    // session/auth token that an attacker can replay. Full three-segment match to avoid false
    // positives on partial base64. Ported from the CS JwtLeakDetector (signal-fabric parity, #15).
    id: "jwt-leak-response",
    category: "auth",
    severity: "high",
    when: 'regex("eyJ[A-Za-z0-9_-]{5,}\\.eyJ[A-Za-z0-9_-]{5,}\\.[A-Za-z0-9_-]{5,}", resp.body)',
    message: "JWT leaked in the response body of {endpoint}",
    evidence: "{resp.status} on {req.method} {req.path}",
    dedupBy: "endpoint",
    tags: ["auth", "jwt"],
  },
  {
    // A secret in the query string ends up in logs, Referer, and browser history.
    id: "secret-in-url",
    category: "info-disclosure",
    severity: "medium",
    when: 'regex("[?&](access_token|id_token|api_key|apikey|token|jwt|password|passwd|secret|client_secret|sig|signature)=[^&]", req.url)',
    message: "Sensitive value passed in the URL query at {endpoint} (logged / Referer-leaked)",
    dedupBy: "endpoint",
    tags: ["info-disclosure", "creds"],
  },
]
