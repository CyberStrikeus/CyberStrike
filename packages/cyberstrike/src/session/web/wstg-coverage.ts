export type CoverageStatus = "covered" | "passive" | "deferred" | "partial"

export interface WstgCoverage {
  id: string
  title: string
  agent: string
  status: CoverageStatus
  mechanism: string
}

export const WSTG_COVERAGE: WstgCoverage[] = [
  // ── INFO — Information Gathering (10) ─────────────────────────────────
  // WSTG 4.1 Information Gathering — ALL ten owned by wstg-info-gathering (one WSTG category = one
  // specialist). config-deploy (4.2) CONSUMES the fingerprint/tech output via coverage notes + intel to
  // pick tech playbooks; it does not own any 4.1 item.
  { id: "WSTG-INFO-01", title: "Conduct Search Engine Discovery and Reconnaissance for Information Leakage", agent: "wstg-info-gathering", status: "covered", mechanism: "vortex_query over captured traffic for indexed admin/debug/status pages + recon_test" },
  { id: "WSTG-INFO-02", title: "Fingerprint Web Server", agent: "wstg-info-gathering", status: "passive", mechanism: "Vortex server-banner rule (Server/X-Powered-By/version) + recon_test{fingerprint}" },
  { id: "WSTG-INFO-03", title: "Review Webserver Metafiles for Information Leakage", agent: "wstg-info-gathering", status: "covered", mechanism: "recon_test{metafiles} + WellKnown probe (robots.txt, sitemap.xml, security.txt, openapi.json — URL + schema extraction, not just existence)" },
  { id: "WSTG-INFO-04", title: "Enumerate Applications on Webserver", agent: "wstg-info-gathering", status: "covered", mechanism: "Vortex host/origin enumeration over captured traffic (passive — distinct hosts/ports seen)" },
  { id: "WSTG-INFO-05", title: "Review Webpage Content for Information Leakage", agent: "wstg-info-gathering", status: "covered", mechanism: "recon_test{leakage} (HTML comments, internal IPs, version strings, debug flags) + Vortex signature rules (secret-in-response, internal-hostname-leak, full-path-disclosure)" },
  { id: "WSTG-INFO-06", title: "Identify Application Entry Points", agent: "wstg-info-gathering", status: "covered", mechanism: "Vortex inject-point inventory (every query/body/path/header parameter)" },
  { id: "WSTG-INFO-07", title: "Map Execution Paths Through Application", agent: "wstg-info-gathering", status: "covered", mechanism: "Vortex function/workflow mapping (CRUD action types, critical flows)" },
  { id: "WSTG-INFO-08", title: "Fingerprint Web Application Framework", agent: "wstg-info-gathering", status: "covered", mechanism: "Vortex technology rules (js/web/ui framework fingerprints) + recon_test{fingerprint} + cookie/header signatures" },
  { id: "WSTG-INFO-09", title: "Fingerprint Web Application", agent: "wstg-info-gathering", status: "covered", mechanism: "version-specific resources (CHANGELOG/VERSION, build hash in HTML, /version.json) via http_replay + recon_test" },
  { id: "WSTG-INFO-10", title: "Map Application Architecture", agent: "wstg-info-gathering", status: "covered", mechanism: "Vortex technology rules (CDN/reverse-proxy/load-balancer) + header inference (Via/X-Cache/CF-RAY, frontend-vs-backend error pages)" },

  // ── CONF — Configuration and Deployment Management (11) ───────────────
  { id: "WSTG-CONF-01", title: "Test Network Infrastructure Configuration", agent: "wstg-config-deploy", status: "covered", mechanism: "misconfig_test methods mode" },
  { id: "WSTG-CONF-02", title: "Test Application Platform Configuration", agent: "wstg-config-deploy", status: "covered", mechanism: "misconfig_test paths mode" },
  { id: "WSTG-CONF-03", title: "Test File Extensions Handling for Sensitive Information", agent: "wstg-config-deploy", status: "covered", mechanism: "misconfig_test paths mode (.bak, .old, .swp)" },
  { id: "WSTG-CONF-04", title: "Review Old Backup and Unreferenced Files", agent: "wstg-config-deploy", status: "covered", mechanism: "misconfig_test paths mode (backup wordlist)" },
  { id: "WSTG-CONF-05", title: "Enumerate Infrastructure and Application Admin Interfaces", agent: "wstg-config-deploy", status: "covered", mechanism: "misconfig_test paths mode (admin wordlist)" },
  { id: "WSTG-CONF-06", title: "Test HTTP Methods", agent: "wstg-config-deploy", status: "covered", mechanism: "misconfig_test methods mode (TRACE, PUT, DELETE)" },
  { id: "WSTG-CONF-07", title: "Test HTTP Strict Transport Security", agent: "wstg-config-deploy", status: "passive", mechanism: "MissingSecurityHeadersDetector + manual header check" },
  { id: "WSTG-CONF-08", title: "Test RIA Cross Domain Policy", agent: "wstg-config-deploy", status: "covered", mechanism: "fetch + parse crossdomain.xml / clientaccesspolicy.xml (wildcard allow-access-from); distinct from CORS (4.11)" },
  { id: "WSTG-CONF-09", title: "Test File Permission", agent: "wstg-config-deploy", status: "covered", mechanism: "misconfig_test paths mode (sensitive file disclosure)" },
  { id: "WSTG-CONF-10", title: "Test for Subdomain Takeover", agent: "wstg-config-deploy", status: "partial", mechanism: "http_replay fingerprint of unclaimed third-party CNAME targets (NoSuchBucket / GitHub Pages / Heroku / Azure banners); true DNS/CNAME resolution not yet in-tool" },
  { id: "WSTG-CONF-11", title: "Test Cloud Storage", agent: "wstg-config-deploy", status: "partial", mechanism: "http_replay bucket list/read/write on S3/Azure Blob/GCS URLs referenced by the app; no dedicated cloud-enum tool yet (cloud-audit-mcp unwired)" },
  { id: "WSTG-CONF-12", title: "Testing for Content Security Policy", agent: "wstg-config-deploy", status: "partial", mechanism: "missing-security-headers rule (presence) + prompt-driven CSP WEAKNESS analysis via http_replay (unsafe-inline/eval, wildcard, missing object-src/base-uri/frame-ancestors, report-only, bypassable allowlist)" },
  { id: "WSTG-CONF-13", title: "Test for Path Confusion", agent: "wstg-config-deploy", status: "partial", mechanism: "http_replay compare of normalized-path variants (encoded/double/dot-segment slash, matrix params, cache deception, proxy-vs-origin ACL bypass); no deterministic rule yet (infra-security MCP nginx/apache path checks unwired)" },
  { id: "WSTG-CONF-14", title: "Test Other HTTP Security Header Misconfigurations", agent: "wstg-config-deploy", status: "covered", mechanism: "misconfig_test headers mode + missing-security-headers rule (nosniff / X-Frame-Options / Referrer-Policy / Permissions-Policy / COOP-COEP-CORP / Cache-Control)" },

  // ── IDNT — Identity Management (5) ───────────────────────────────────
  // WSTG 4.3 Identity Management — ALL five owned by wstg-identity-mgmt (its prompt claims all of 4.3 and
  // it carries the identity_probe tool). Previously orphaned to authn/authz. Behavioral tests, driven by
  // identity_probe + http_replay over the registration/account flows; the orchestrator dispatches it when
  // such surface exists (no deterministic "identity" signal — appropriate for this class).
  { id: "WSTG-IDNT-01", title: "Test Role Definitions", agent: "wstg-identity-mgmt", status: "covered", mechanism: "http_replay cross-credential comparison of role boundaries (ambiguous/overlapping roles)" },
  { id: "WSTG-IDNT-02", title: "Test User Registration Process", agent: "wstg-identity-mgmt", status: "covered", mechanism: "identity_probe + http_replay (admin/system-reserved names, duplicate accounts, missing-field / injection in registration)" },
  { id: "WSTG-IDNT-03", title: "Test Account Provisioning Process", agent: "wstg-identity-mgmt", status: "covered", mechanism: "http_replay workflow analysis (unauthorized provision/deprovision, default/temporary accounts, bypassable flow)" },
  { id: "WSTG-IDNT-04", title: "Testing for Account Enumeration and Guessable User Account", agent: "wstg-identity-mgmt", status: "covered", mechanism: "http_replay response-diff on login/register/reset (valid vs invalid username) + sequential/predictable id check" },
  { id: "WSTG-IDNT-05", title: "Testing for Weak or Unenforced Username Policy", agent: "wstg-identity-mgmt", status: "covered", mechanism: "identity_probe boundary testing (length/format validation, special-char / unicode bypass)" },

  // ── ATHN — Authentication (10) ────────────────────────────────────────
  { id: "WSTG-ATHN-01", title: "Testing for Credentials Transported over an Encrypted Channel", agent: "wstg-authentication", status: "passive", mechanism: "missing-security-headers rule (HSTS) + http_replay forcing the login over http:// (accepted = cleartext transport)" },
  { id: "WSTG-ATHN-02", title: "Testing for Default Credentials", agent: "wstg-authentication", status: "covered", mechanism: "http_replay known-default probing" },
  { id: "WSTG-ATHN-03", title: "Testing for Weak Lock Out Mechanism", agent: "wstg-authentication", status: "covered", mechanism: "http_replay repeated-login analysis" },
  { id: "WSTG-ATHN-04", title: "Testing for Bypassing Authentication Schema", agent: "wstg-authentication", status: "covered", mechanism: "authn_test + http_replay unauthenticated access" },
  { id: "WSTG-ATHN-05", title: "Testing for Vulnerable Remember Password", agent: "wstg-authentication", status: "covered", mechanism: "http_replay cookie/token analysis" },
  { id: "WSTG-ATHN-06", title: "Testing for Browser Cache Weakness", agent: "wstg-authentication", status: "passive", mechanism: "vortex_query of authed responses whose Cache-Control lacks no-store/private (the headers are the evidence)" },
  { id: "WSTG-ATHN-07", title: "Testing for Weak Password Policy", agent: "wstg-authentication", status: "covered", mechanism: "http_replay boundary testing" },
  { id: "WSTG-ATHN-08", title: "Testing for Weak Security Question Answer", agent: "wstg-authentication", status: "covered", mechanism: "http_replay workflow analysis" },
  { id: "WSTG-ATHN-09", title: "Testing for Weak Password Change or Reset Functionalities", agent: "wstg-authentication", status: "covered", mechanism: "authn_test + http_replay flow analysis" },
  { id: "WSTG-ATHN-10", title: "Testing for Weaker Authentication in Alternative Channel", agent: "wstg-authentication", status: "covered", mechanism: "http_replay cross-endpoint comparison" },
  { id: "WSTG-ATHN-11", title: "Testing Multi-Factor Authentication (MFA)", agent: "wstg-authentication", status: "covered", mechanism: "http_replay MFA-step skip / forged mfa_passed flag, step-up enforcement check, OTP brute/reuse/expiry, backup-code + enrollment/reset bypass" },

  // ── ATHZ — Authorization (4) ──────────────────────────────────────────
  { id: "WSTG-ATHZ-01", title: "Testing Directory Traversal File Include", agent: "wstg-input-validation", status: "covered", mechanism: "inject_probe LFI mode" },
  { id: "WSTG-ATHZ-02", title: "Testing for Bypassing Authorization Schema", agent: "wstg-authorization", status: "covered", mechanism: "http_replay cross-credential + unauthenticated access" },
  { id: "WSTG-ATHZ-03", title: "Testing for Privilege Escalation", agent: "wstg-authorization", status: "covered", mechanism: "http_replay vertical/horizontal priv-esc probing" },
  { id: "WSTG-ATHZ-04", title: "Testing for Insecure Direct Object References", agent: "wstg-authorization", status: "covered", mechanism: "access_probe cross-credential matrix + http_replay ID sweep (vortex_cross_role candidates)" },
  { id: "WSTG-ATHZ-05", title: "Testing for OAuth Weaknesses", agent: "wstg-authorization", status: "covered", mechanism: "http_replay of the OAuth/OIDC flow — redirect_uri validation (attacker-origin code/token theft → ATO), state/CSRF, PKCE enforcement, code reuse / implicit-token leak / scope escalation" },

  // ── SESS — Session Management (9) ─────────────────────────────────────
  { id: "WSTG-SESS-01", title: "Testing for Session Management Schema", agent: "wstg-session-mgmt", status: "passive", mechanism: "weak-cookie-flags rule + jwt-leak-response rule + session_probe entropy/structure scoring" },
  { id: "WSTG-SESS-02", title: "Testing for Cookies Attributes", agent: "wstg-session-mgmt", status: "passive", mechanism: "weak-cookie-flags rule (HttpOnly / Secure / SameSite) + session_probe __Host-/__Secure- prefix + Domain-scope check" },
  { id: "WSTG-SESS-03", title: "Testing for Session Fixation", agent: "wstg-session-mgmt", status: "covered", mechanism: "http_replay pre/post-login session comparison" },
  { id: "WSTG-SESS-04", title: "Testing for Exposed Session Variables", agent: "wstg-session-mgmt", status: "passive", mechanism: "secret-in-response + jwt-leak-response rules + vortex_where_value trace of the session id into URL/referrer/body" },
  { id: "WSTG-SESS-05", title: "Testing for Cross Site Request Forgery", agent: "wstg-session-mgmt", status: "covered", mechanism: "csrf_extract + http_replay CSRF token analysis" },
  { id: "WSTG-SESS-06", title: "Testing for Logout Functionality", agent: "wstg-session-mgmt", status: "covered", mechanism: "http_replay post-logout token reuse" },
  { id: "WSTG-SESS-07", title: "Testing Session Timeout", agent: "wstg-session-mgmt", status: "covered", mechanism: "http_replay delayed replay" },
  { id: "WSTG-SESS-08", title: "Testing for Session Puzzling", agent: "wstg-session-mgmt", status: "covered", mechanism: "http_replay cross-flow session reuse" },
  { id: "WSTG-SESS-09", title: "Testing for Session Hijacking", agent: "wstg-session-mgmt", status: "covered", mechanism: "session_probe token entropy/forgeability + http_replay cross-identity cookie reuse" },
  { id: "WSTG-SESS-10", title: "Testing JSON Web Tokens", agent: "wstg-session-mgmt", status: "covered", mechanism: "session_probe JWT integrity (alg:none, signature-not-validated, weak HMAC secret, kid traversal, RS256→HS256, expired) vs a no-token control" },
  { id: "WSTG-SESS-11", title: "Testing for Concurrent Sessions", agent: "wstg-session-mgmt", status: "covered", mechanism: "http_replay — dual concurrent login validity + old-session invalidation on password-change / logout-all" },

  // ── INPV — Input Validation (19) ──────────────────────────────────────
  { id: "WSTG-INPV-01", title: "Testing for Reflected Cross Site Scripting", agent: "wstg-input-validation", status: "covered", mechanism: "inject_probe xss mode" },
  { id: "WSTG-INPV-02", title: "Testing for Stored Cross Site Scripting", agent: "wstg-input-validation", status: "partial", mechanism: "inject_probe xss + canary registry (stored reflection deferred)" },
  { id: "WSTG-INPV-03", title: "Testing for HTTP Verb Tampering", agent: "wstg-config-deploy", status: "covered", mechanism: "misconfig_test methods mode" },
  { id: "WSTG-INPV-04", title: "Testing for HTTP Parameter Pollution", agent: "wstg-input-validation", status: "partial", mechanism: "http_replay manual duplicate-param testing (inject_probe HPP mode not yet built)" },
  { id: "WSTG-INPV-05", title: "Testing for SQL Injection", agent: "wstg-input-validation", status: "covered", mechanism: "inject_probe sqli mode (per-DBMS batteries)" },
  { id: "WSTG-INPV-06", title: "Testing for LDAP Injection", agent: "wstg-input-validation", status: "covered", mechanism: "inject_probe ldap mode" },
  { id: "WSTG-INPV-07", title: "Testing for XML Injection", agent: "wstg-input-validation", status: "covered", mechanism: "http_replay XML/XXE entity injection into XML bodies (external entity → file read / SSRF)" },
  { id: "WSTG-INPV-08", title: "Testing for SSI Injection", agent: "wstg-input-validation", status: "covered", mechanism: "http_replay SSI directive injection + reflected-output check" },
  { id: "WSTG-INPV-09", title: "Testing for XPath Injection", agent: "wstg-input-validation", status: "covered", mechanism: "inject_probe xpath mode" },
  { id: "WSTG-INPV-10", title: "Testing for IMAP SMTP Injection", agent: "wstg-input-validation", status: "covered", mechanism: "http_replay payload analysis" },
  { id: "WSTG-INPV-11", title: "Testing for Code Injection", agent: "wstg-input-validation", status: "covered", mechanism: "inject_probe (ssti / cmd) + http_replay code-eval probes" },
  { id: "WSTG-INPV-12", title: "Testing for Command Injection", agent: "wstg-input-validation", status: "covered", mechanism: "inject_probe cmd mode" },
  { id: "WSTG-INPV-13", title: "Testing for Format String Injection", agent: "wstg-input-validation", status: "covered", mechanism: "http_replay format-specifier (%s/%x/%n) probes + error/crash diff" },
  { id: "WSTG-INPV-14", title: "Testing for Incubated Vulnerability", agent: "wstg-input-validation", status: "partial", mechanism: "canary registry + cross-response stored-reflection scan (inject_probe canary deferred)" },
  { id: "WSTG-INPV-15", title: "Testing for HTTP Splitting Smuggling", agent: "wstg-input-validation", status: "covered", mechanism: "inject_probe crlf mode (response splitting / header injection) + http_replay_raw CL/TE request-smuggling (manual)" },
  { id: "WSTG-INPV-16", title: "Testing for HTTP Incoming Requests", agent: "wstg-input-validation", status: "covered", mechanism: "http_replay_raw inspection of raw / oversized / malformed requests" },
  { id: "WSTG-INPV-17", title: "Testing for Host Header Injection", agent: "wstg-input-validation", status: "covered", mechanism: "http_replay Host header manipulation" },
  { id: "WSTG-INPV-18", title: "Testing for Server-Side Template Injection", agent: "wstg-input-validation", status: "covered", mechanism: "inject_probe ssti mode" },
  { id: "WSTG-INPV-19", title: "Testing for Server-Side Request Forgery", agent: "wstg-input-validation", status: "covered", mechanism: "ssrf_test (internal/metadata target payloads + oracle) + Vortex deterministic SSRF OOB probe (#89)" },
  { id: "WSTG-INPV-20", title: "Testing for Mass Assignment", agent: "wstg-input-validation", status: "covered", mechanism: "inject_probe mass_assign mode (bind privileged fields — role/isAdmin/id/owner — on WRITE endpoints; confirm the field took effect)" },

  // ── ERRH — Error Handling (2) ─────────────────────────────────────────
  { id: "WSTG-ERRH-01", title: "Testing for Improper Error Handling", agent: "wstg-error-handling", status: "covered", mechanism: "Vortex rules (stack-trace-signature, full-path-disclosure, sql-error-signature, secret-in-response) + error_probe active malformations (invalid JSON, wrong content-type, empty/oversized body, non-existent id) vs baseline" },
  { id: "WSTG-ERRH-02", title: "Testing for Stack Traces", agent: "wstg-error-handling", status: "covered", mechanism: "stack-trace-signature rule + error_probe / http_replay exception triggering (type confusion, div-by-zero, null refs) — a trace in the body (incl. JSON wrappers) is the finding" },

  // ── CRYP — Weak Cryptography (4) ──────────────────────────────────────
  { id: "WSTG-CRYP-01", title: "Testing for Weak Transport Layer Security", agent: "wstg-cryptography", status: "covered", mechanism: "bash openssl s_client (TLS version / weak ciphers / cert validity) + missing-security-headers rule (HSTS) + mixed-content scan" },
  { id: "WSTG-CRYP-02", title: "Testing for Padding Oracle", agent: "wstg-cryptography", status: "covered", mechanism: "http_replay — mutate last byte of a base64/hex block-cipher blob, differential error oracle (valid vs invalid padding)" },
  { id: "WSTG-CRYP-03", title: "Testing for Sensitive Information Sent via Unencrypted Channels", agent: "wstg-cryptography", status: "passive", mechanism: "missing-security-headers rule (HSTS) + http_replay reachability over http:// + form-action/mixed-content scan for creds/PII" },
  { id: "WSTG-CRYP-04", title: "Testing for Weak Cryptographic Primitives", agent: "wstg-cryptography", status: "covered", mechanism: "crypto_probe / analysis for DES/RC4/MD5/ECB, short keys, hardcoded keys-IVs, weak RNG in tokens; JWT weak-key via session_probe/authn_test" },

  // ── BUSL — Business Logic (9) ─────────────────────────────────────────
  { id: "WSTG-BUSL-01", title: "Test Business Logic Data Validation", agent: "wstg-business-logic", status: "covered", mechanism: "business_test boundary mode" },
  { id: "WSTG-BUSL-02", title: "Test Ability to Forge Requests", agent: "wstg-input-validation", status: "covered", mechanism: "http_replay parameter tampering" },
  { id: "WSTG-BUSL-03", title: "Test Integrity Checks", agent: "wstg-business-logic", status: "covered", mechanism: "business_test workflow mode (step skip)" },
  { id: "WSTG-BUSL-04", title: "Test for Process Timing", agent: "wstg-business-logic", status: "covered", mechanism: "business_test race mode (concurrent requests)" },
  { id: "WSTG-BUSL-05", title: "Test Number of Times a Function Can Be Used", agent: "wstg-business-logic", status: "covered", mechanism: "business_test race mode (repeat exploitation)" },
  { id: "WSTG-BUSL-06", title: "Testing for the Circumvention of Work Flows", agent: "wstg-business-logic", status: "covered", mechanism: "business_test workflow mode" },
  { id: "WSTG-BUSL-07", title: "Test Defenses Against Application Misuse", agent: "wstg-business-logic", status: "covered", mechanism: "business_test boundary mode (abuse patterns)" },
  { id: "WSTG-BUSL-08", title: "Test Upload of Unexpected File Types", agent: "wstg-input-validation", status: "covered", mechanism: "inject_probe file-upload + http_replay" },
  { id: "WSTG-BUSL-09", title: "Test Upload of Malicious Files", agent: "wstg-input-validation", status: "covered", mechanism: "inject_probe file-upload + http_replay" },
  { id: "WSTG-BUSL-10", title: "Test Payment Functionality", agent: "wstg-business-logic", status: "covered", mechanism: "business_test boundary (price/amount/quantity tampering, zero/negative, currency confusion, coupon stacking) + race (double-spend / double-refund) — confirm the charged/credited amount actually changed" },

  // ── CLNT — Client-side (13) ───────────────────────────────────────────
  { id: "WSTG-CLNT-01", title: "Testing for DOM-Based Cross Site Scripting", agent: "wstg-client-side", status: "deferred", mechanism: "P2: needs browser co-drive for DOM sink instrumentation" },
  { id: "WSTG-CLNT-02", title: "Testing for JavaScript Execution", agent: "wstg-client-side", status: "deferred", mechanism: "P2: needs browser co-drive" },
  { id: "WSTG-CLNT-03", title: "Testing for HTML Injection", agent: "wstg-input-validation", status: "covered", mechanism: "inject_probe xss mode (HTML context)" },
  { id: "WSTG-CLNT-04", title: "Testing for Client-side URL Redirect", agent: "wstg-input-validation", status: "passive", mechanism: "OpenRedirectDetector" },
  { id: "WSTG-CLNT-05", title: "Testing for CSS Injection", agent: "wstg-client-side", status: "deferred", mechanism: "P2: needs browser rendering" },
  { id: "WSTG-CLNT-06", title: "Testing for Client-side Resource Manipulation", agent: "wstg-client-side", status: "deferred", mechanism: "P2: needs browser co-drive" },
  { id: "WSTG-CLNT-07", title: "Testing Cross Origin Resource Sharing", agent: "wstg-config-deploy", status: "covered", mechanism: "misconfig_test cors mode + CorsMisconfigDetector" },
  { id: "WSTG-CLNT-08", title: "Testing for Cross Site Flashing", agent: "wstg-client-side", status: "deferred", mechanism: "P2: Flash/SWF largely deprecated; low priority" },
  { id: "WSTG-CLNT-09", title: "Testing for Clickjacking", agent: "wstg-config-deploy", status: "passive", mechanism: "MissingSecurityHeadersDetector (X-Frame-Options, CSP frame-ancestors)" },
  { id: "WSTG-CLNT-10", title: "Testing WebSockets", agent: "wstg-client-side", status: "deferred", mechanism: "P2: needs browser WebSocket instrumentation" },
  { id: "WSTG-CLNT-11", title: "Testing Web Messaging", agent: "wstg-client-side", status: "deferred", mechanism: "P2: needs browser postMessage interception" },
  { id: "WSTG-CLNT-12", title: "Testing Browser Storage", agent: "wstg-client-side", status: "deferred", mechanism: "P2: needs browser localStorage/sessionStorage access" },
  { id: "WSTG-CLNT-13", title: "Testing for Cross Site Script Inclusion", agent: "wstg-input-validation", status: "covered", mechanism: "inject_probe + http_replay JSONP/callback analysis" },

  // ── APIT — API Testing (1) ────────────────────────────────────────────
  { id: "WSTG-APIT-01", title: "Testing GraphQL", agent: "wstg-input-validation", status: "passive", mechanism: "GraphqlIntrospectionDetector + inject_probe" },
]

export const WSTG_CATEGORIES = [
  { prefix: "WSTG-INFO", name: "Information Gathering", count: 10 },
  { prefix: "WSTG-CONF", name: "Configuration and Deployment", count: 14 },
  { prefix: "WSTG-IDNT", name: "Identity Management", count: 5 },
  { prefix: "WSTG-ATHN", name: "Authentication", count: 11 },
  { prefix: "WSTG-ATHZ", name: "Authorization", count: 5 },
  { prefix: "WSTG-SESS", name: "Session Management", count: 11 },
  { prefix: "WSTG-INPV", name: "Input Validation", count: 20 },
  { prefix: "WSTG-ERRH", name: "Error Handling", count: 2 },
  { prefix: "WSTG-CRYP", name: "Weak Cryptography", count: 4 },
  { prefix: "WSTG-BUSL", name: "Business Logic", count: 10 },
  { prefix: "WSTG-CLNT", name: "Client-side", count: 13 },
  { prefix: "WSTG-APIT", name: "API Testing", count: 1 },
] as const

export const TOTAL_WSTG_TESTS = 106
