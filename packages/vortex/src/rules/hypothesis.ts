// Endpoint-semantic hypothesis rules. Request-path heuristics that route endpoints to the right
// specialist based on what the endpoint DOES, not what its response contains. Cheap (regex, no LLM),
// deterministic, and deduped per endpoint — so a /logout or /admin surface is always inspected even
// when no response-based signal fires. Each category maps to a specialist via CATEGORY_OWNER in
// vortex-route.ts.
import type { DeclarativeRule } from "../declarative"

export const hypothesisRules: DeclarativeRule[] = [
  // ── Session management (WSTG 4.6) ──────────────────────────────────────────
  {
    id: "hypothesis-session-destroy",
    category: "auth-session",
    severity: "medium",
    when: 'regex("/(logout|log-out|log_out|signout|sign-out|sign_out|session/destroy|session/revoke|session/invalidate|session/terminate|revoke.?token|end.?session)", req.path)',
    message: "Session termination surface at {endpoint} — test unauthenticated/cross-user session kill, missing CSRF on logout, session fixation after logout",
    dedupBy: "endpoint",
    tags: ["hypothesis", "session"],
  },
  {
    id: "hypothesis-session-config",
    category: "auth-session",
    severity: "medium",
    when: 'regex("/(session|keep.?alive|heartbeat|refresh.?token|token/refresh|renew)", req.path) && req.method != "GET"',
    message: "Session lifecycle endpoint {endpoint} — test token refresh replay, session timeout bypass, concurrent session limits",
    dedupBy: "endpoint",
    tags: ["hypothesis", "session"],
  },

  // ── Authentication (WSTG 4.4) ──────────────────────────────────────────────
  {
    id: "hypothesis-password-reset",
    category: "auth",
    severity: "medium",
    when: 'regex("/(forgot|reset.?password|password.?reset|recover|account.?recovery|reset.?link)", req.path)',
    message: "Password reset flow at {endpoint} — test token predictability, account enumeration, rate limit bypass, host header poisoning for reset link",
    dedupBy: "endpoint",
    tags: ["hypothesis", "auth"],
  },
  {
    id: "hypothesis-registration",
    category: "auth",
    severity: "medium",
    when: 'regex("/(register|signup|sign-up|sign_up|create.?account|onboard|enroll)", req.path)',
    message: "Registration endpoint {endpoint} — test duplicate account creation, weak password policy, email enumeration, mass registration",
    dedupBy: "endpoint",
    tags: ["hypothesis", "auth"],
  },
  {
    id: "hypothesis-verify-activate",
    category: "auth",
    severity: "medium",
    when: 'regex("/(verify|activate|confirm|validate.?email|validate.?account|email.?confirm)", req.path)',
    message: "Account verification at {endpoint} — test token brute-force, verification bypass, token reuse after activation",
    dedupBy: "endpoint",
    tags: ["hypothesis", "auth"],
  },
  {
    id: "hypothesis-mfa",
    category: "auth",
    severity: "high",
    when: 'regex("/(mfa|2fa|two.?factor|otp|totp|verify.?code|sms.?code|auth.?code)", req.path)',
    message: "MFA/2FA endpoint {endpoint} — test code brute-force, rate limiting, MFA bypass via direct API access, code reuse",
    dedupBy: "endpoint",
    tags: ["hypothesis", "auth"],
  },

  // ── Authorization / access control (WSTG 4.5) ─────────────────────────────
  {
    id: "hypothesis-admin-surface",
    category: "access-control",
    severity: "medium",
    when: 'regex("/(admin|dashboard/admin|manage|backoffice|back-office|internal|staff|superuser|moderator)", req.path)',
    message: "Administrative surface at {endpoint} — test forced browsing from unprivileged user, privilege escalation, missing role check",
    dedupBy: "endpoint",
    tags: ["hypothesis", "authz"],
  },
  {
    id: "hypothesis-role-permission",
    category: "access-control",
    severity: "medium",
    when: 'regex("/(role|permission|privilege|rbac|acl|policy|grant|entitlement|scope)", req.path) && req.method != "GET"',
    message: "Role/permission management at {endpoint} — test self-privilege-escalation, role assignment without authorization, BFLA",
    dedupBy: "endpoint",
    tags: ["hypothesis", "authz"],
  },
  {
    id: "hypothesis-user-mgmt",
    category: "access-control",
    severity: "medium",
    when: 'regex("/(users?/[^/]*/(delete|disable|ban|suspend|block|enable|approve|reject|impersonate))", req.path)',
    message: "User lifecycle action at {endpoint} — test IDOR on user ID, cross-tenant user manipulation, missing authorization",
    dedupBy: "endpoint",
    tags: ["hypothesis", "authz"],
  },

  // ── Input validation / injection (WSTG 4.7) ───────────────────────────────
  {
    id: "hypothesis-file-operation",
    category: "injection",
    severity: "medium",
    when: 'regex("/(upload|import|export|attach|file|document|media|asset|image|photo|avatar|resume|cv)/(create|add|save|new|process)?", req.path) && req.method != "GET"',
    message: "File operation at {endpoint} — test unrestricted file upload (extension bypass, content-type mismatch, polyglot), path traversal in filename, SSRF via URL import, XXE in XML/DOCX upload",
    dedupBy: "endpoint",
    tags: ["hypothesis", "injection"],
  },
  {
    id: "hypothesis-search-filter",
    category: "injection",
    severity: "medium",
    when: 'regex("/(search|filter|query|find|lookup|browse|autocomplete|suggest|typeahead)", req.path)',
    message: "Search/filter endpoint {endpoint} — test SQL/NoSQL injection in search terms, LDAP injection, XSS via reflected search query, operator injection",
    dedupBy: "endpoint",
    tags: ["hypothesis", "injection"],
  },
  {
    id: "hypothesis-template-render",
    category: "injection",
    severity: "high",
    when: 'regex("/(template|render|preview|generate|report/generate|pdf|print|format|compile|transform|convert)", req.path) && req.method != "GET"',
    message: "Template/render endpoint {endpoint} — test SSTI ({{7*7}}, ${7*7}), LaTeX injection, HTML injection in PDF generation, command injection via conversion tools",
    dedupBy: "endpoint",
    tags: ["hypothesis", "injection"],
  },
  {
    id: "hypothesis-data-export",
    category: "injection",
    severity: "medium",
    when: 'regex("/(export|download|dump|extract|backup|report/download|csv|xlsx|xml)", req.path)',
    message: "Data export at {endpoint} — test IDOR on exported data scope, injection in export parameters (CSV formula injection), path traversal in filename, auth bypass",
    dedupBy: "endpoint",
    tags: ["hypothesis", "injection"],
  },

  // ── Business logic (WSTG 4.10) ────────────────────────────────────────────
  {
    id: "hypothesis-payment-flow",
    category: "access-control",
    severity: "high",
    when: 'regex("/(payment|checkout|purchase|order|transaction|charge|billing|invoice|subscribe|plan|pricing|cart|basket)", req.path) && req.method != "GET"',
    message: "Payment/order flow at {endpoint} — test price manipulation, quantity tampering, currency swap, race condition on payment confirmation, coupon/discount abuse, negative amounts",
    dedupBy: "endpoint",
    tags: ["hypothesis", "business-logic"],
  },
  {
    id: "hypothesis-approval-flow",
    category: "access-control",
    severity: "medium",
    when: 'regex("/(approve|reject|review|submit|publish|release|deploy|promote|escalate|assign|delegate|transfer|move)", req.path) && req.method != "GET"',
    message: "Approval/workflow action at {endpoint} — test self-approval, state machine bypass (skip steps), IDOR on approval target, missing authorization on state transition",
    dedupBy: "endpoint",
    tags: ["hypothesis", "business-logic"],
  },

  // ── Error handling / debug (WSTG 4.8) ──────────────────────────────────────
  {
    id: "hypothesis-debug-surface",
    category: "misconfiguration",
    severity: "high",
    when: 'regex("/(debug|trace|profil|diagnostic|health|status|info|metrics|monitor|actuator|env|config|phpinfo|server-info|server-status|elmah)", req.path)',
    message: "Debug/diagnostic surface at {endpoint} — test information disclosure (env vars, config, internal IPs), access without authentication, sensitive data in health endpoint",
    dedupBy: "endpoint",
    tags: ["hypothesis", "debug"],
  },

  // ── API-specific (WSTG 4.12) ──────────────────────────────────────────────
  {
    id: "hypothesis-api-docs",
    category: "info-disclosure",
    severity: "medium",
    when: 'regex("/(swagger|openapi|api-docs|graphql/playground|graphiql|redoc|docs/api|schema|wsdl|wadl)", req.path)',
    message: "API documentation/schema endpoint {endpoint} — test public accessibility, hidden endpoints in spec, excessive data exposure in schema, deprecated endpoints still active",
    dedupBy: "endpoint",
    tags: ["hypothesis", "api"],
  },
  {
    id: "hypothesis-webhook",
    category: "injection",
    severity: "medium",
    when: 'regex("/(webhook|callback|hook|notify|event|listen|ingest|receiver)", req.path) && req.method != "GET"',
    message: "Webhook/callback endpoint {endpoint} — test SSRF via callback URL, signature bypass, replay attacks, unauthenticated access, event injection",
    dedupBy: "endpoint",
    tags: ["hypothesis", "injection"],
  },
  {
    id: "hypothesis-bulk-batch",
    category: "access-control",
    severity: "medium",
    when: 'regex("/(bulk|batch|mass|multi|all|list.?all)", req.path) && req.method != "GET"',
    message: "Bulk/batch operation at {endpoint} — test mass data access without pagination limits, resource exhaustion, mixed-authorization items in batch, IDOR across batch IDs",
    dedupBy: "endpoint",
    tags: ["hypothesis", "api"],
  },
]
