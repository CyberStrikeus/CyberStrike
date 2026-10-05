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
  { id: "WSTG-CONF-08", title: "Test RIA Cross Domain Policy", agent: "wstg-config-deploy", status: "covered", mechanism: "misconfig_test cors mode" },
  { id: "WSTG-CONF-09", title: "Test File Permission", agent: "wstg-config-deploy", status: "covered", mechanism: "misconfig_test paths mode (sensitive file disclosure)" },
  { id: "WSTG-CONF-10", title: "Test for Subdomain Takeover", agent: "wstg-config-deploy", status: "covered", mechanism: "misconfig_test paths mode + DNS check" },
  { id: "WSTG-CONF-11", title: "Test Cloud Storage", agent: "wstg-config-deploy", status: "covered", mechanism: "misconfig_test paths mode (S3, Azure Blob, GCS)" },

  // ── IDNT — Identity Management (5) ───────────────────────────────────
  { id: "WSTG-IDNT-01", title: "Test Role Definitions", agent: "wstg-authorization", status: "covered", mechanism: "http_replay cross-credential comparison" },
  { id: "WSTG-IDNT-02", title: "Test User Registration Process", agent: "wstg-authentication", status: "covered", mechanism: "authn_test + http_replay" },
  { id: "WSTG-IDNT-03", title: "Test Account Provisioning Process", agent: "wstg-authentication", status: "covered", mechanism: "http_replay workflow analysis" },
  { id: "WSTG-IDNT-04", title: "Testing for Account Enumeration and Guessable User Account", agent: "wstg-authentication", status: "covered", mechanism: "http_replay response diff analysis" },
  { id: "WSTG-IDNT-05", title: "Testing for Weak or Unenforced Username Policy", agent: "wstg-authentication", status: "covered", mechanism: "http_replay boundary testing" },

  // ── ATHN — Authentication (10) ────────────────────────────────────────
  { id: "WSTG-ATHN-01", title: "Testing for Credentials Transported over an Encrypted Channel", agent: "wstg-authentication", status: "passive", mechanism: "MissingSecurityHeadersDetector (HSTS)" },
  { id: "WSTG-ATHN-02", title: "Testing for Default Credentials", agent: "wstg-authentication", status: "covered", mechanism: "http_replay known-default probing" },
  { id: "WSTG-ATHN-03", title: "Testing for Weak Lock Out Mechanism", agent: "wstg-authentication", status: "covered", mechanism: "http_replay repeated-login analysis" },
  { id: "WSTG-ATHN-04", title: "Testing for Bypassing Authentication Schema", agent: "wstg-authentication", status: "covered", mechanism: "authn_test + http_replay unauthenticated access" },
  { id: "WSTG-ATHN-05", title: "Testing for Vulnerable Remember Password", agent: "wstg-authentication", status: "covered", mechanism: "http_replay cookie/token analysis" },
  { id: "WSTG-ATHN-06", title: "Testing for Browser Cache Weaknesses", agent: "wstg-authentication", status: "passive", mechanism: "MissingSecurityHeadersDetector (Cache-Control)" },
  { id: "WSTG-ATHN-07", title: "Testing for Weak Password Policy", agent: "wstg-authentication", status: "covered", mechanism: "http_replay boundary testing" },
  { id: "WSTG-ATHN-08", title: "Testing for Weak Security Question Answer", agent: "wstg-authentication", status: "covered", mechanism: "http_replay workflow analysis" },
  { id: "WSTG-ATHN-09", title: "Testing for Weak Password Change or Reset Functionalities", agent: "wstg-authentication", status: "covered", mechanism: "authn_test + http_replay flow analysis" },
  { id: "WSTG-ATHN-10", title: "Testing for Weaker Authentication in Alternative Channel", agent: "wstg-authentication", status: "covered", mechanism: "http_replay cross-endpoint comparison" },

  // ── ATHZ — Authorization (4) ──────────────────────────────────────────
  { id: "WSTG-ATHZ-01", title: "Testing Directory Traversal File Include", agent: "wstg-input-validation", status: "covered", mechanism: "inject_probe LFI mode" },
  { id: "WSTG-ATHZ-02", title: "Testing for Bypassing Authorization Schema", agent: "wstg-authorization", status: "covered", mechanism: "http_replay cross-credential + unauthenticated access" },
  { id: "WSTG-ATHZ-03", title: "Testing for Privilege Escalation", agent: "wstg-authorization", status: "covered", mechanism: "http_replay vertical/horizontal priv-esc probing" },
  { id: "WSTG-ATHZ-04", title: "Testing for Insecure Direct Object References", agent: "wstg-authorization", status: "covered", mechanism: "http_replay ID sweep + cross-credential comparison" },

  // ── SESS — Session Management (9) ─────────────────────────────────────
  { id: "WSTG-SESS-01", title: "Testing for Session Management Schema", agent: "wstg-session-mgmt", status: "passive", mechanism: "WeakCookieFlagsDetector + JwtLeakDetector" },
  { id: "WSTG-SESS-02", title: "Testing for Cookies Attributes", agent: "wstg-session-mgmt", status: "passive", mechanism: "WeakCookieFlagsDetector (HttpOnly, Secure, SameSite)" },
  { id: "WSTG-SESS-03", title: "Testing for Session Fixation", agent: "wstg-session-mgmt", status: "covered", mechanism: "http_replay pre/post-login session comparison" },
  { id: "WSTG-SESS-04", title: "Testing for Exposed Session Variables", agent: "wstg-session-mgmt", status: "passive", mechanism: "SensitiveDataExposureDetector + JwtLeakDetector" },
  { id: "WSTG-SESS-05", title: "Testing for Cross Site Request Forgery", agent: "wstg-session-mgmt", status: "covered", mechanism: "csrf_extract + http_replay CSRF token analysis" },
  { id: "WSTG-SESS-06", title: "Testing for Logout Functionality", agent: "wstg-session-mgmt", status: "covered", mechanism: "http_replay post-logout token reuse" },
  { id: "WSTG-SESS-07", title: "Testing Session Timeout", agent: "wstg-session-mgmt", status: "covered", mechanism: "http_replay delayed replay" },
  { id: "WSTG-SESS-08", title: "Testing for Session Puzzling", agent: "wstg-session-mgmt", status: "covered", mechanism: "http_replay cross-flow session reuse" },
  { id: "WSTG-SESS-09", title: "Testing for Session Hijacking", agent: "wstg-session-mgmt", status: "covered", mechanism: "authn_test JWT attacks + cookie analysis" },

  // ── INPV — Input Validation (19) ──────────────────────────────────────
  { id: "WSTG-INPV-01", title: "Testing for Reflected Cross Site Scripting", agent: "wstg-input-validation", status: "covered", mechanism: "inject_probe xss mode" },
  { id: "WSTG-INPV-02", title: "Testing for Stored Cross Site Scripting", agent: "wstg-input-validation", status: "partial", mechanism: "inject_probe xss + canary registry (stored reflection deferred)" },
  { id: "WSTG-INPV-03", title: "Testing for HTTP Verb Tampering", agent: "wstg-config-deploy", status: "covered", mechanism: "misconfig_test methods mode" },
  { id: "WSTG-INPV-04", title: "Testing for HTTP Parameter Pollution", agent: "wstg-input-validation", status: "partial", mechanism: "http_replay manual duplicate-param testing (inject_probe HPP mode not yet built)" },
  { id: "WSTG-INPV-05", title: "Testing for SQL Injection", agent: "wstg-input-validation", status: "covered", mechanism: "inject_probe sqli mode (per-DBMS batteries)" },
  { id: "WSTG-INPV-06", title: "Testing for LDAP Injection", agent: "wstg-input-validation", status: "covered", mechanism: "inject_probe ldap mode" },
  { id: "WSTG-INPV-07", title: "Testing for XML Injection", agent: "wstg-input-validation", status: "covered", mechanism: "inject_probe xml mode" },
  { id: "WSTG-INPV-08", title: "Testing for SSI Injection", agent: "wstg-input-validation", status: "covered", mechanism: "inject_probe ssi mode" },
  { id: "WSTG-INPV-09", title: "Testing for XPath Injection", agent: "wstg-input-validation", status: "covered", mechanism: "inject_probe xpath mode" },
  { id: "WSTG-INPV-10", title: "Testing for IMAP SMTP Injection", agent: "wstg-input-validation", status: "covered", mechanism: "http_replay payload analysis" },
  { id: "WSTG-INPV-11", title: "Testing for Code Injection", agent: "wstg-input-validation", status: "covered", mechanism: "inject_probe code-injection mode" },
  { id: "WSTG-INPV-12", title: "Testing for Command Injection", agent: "wstg-input-validation", status: "covered", mechanism: "inject_probe cmd mode" },
  { id: "WSTG-INPV-13", title: "Testing for Format String Injection", agent: "wstg-input-validation", status: "covered", mechanism: "inject_probe format-string mode" },
  { id: "WSTG-INPV-14", title: "Testing for Incubated Vulnerability", agent: "wstg-input-validation", status: "partial", mechanism: "canary registry + cross-response scan (inject_probe canary deferred)" },
  { id: "WSTG-INPV-15", title: "Testing for HTTP Incoming Requests", agent: "wstg-input-validation", status: "covered", mechanism: "ssrf_test + http_replay" },
  { id: "WSTG-INPV-16", title: "Testing for HTTP Request Smuggling", agent: "wstg-input-validation", status: "covered", mechanism: "http_replay_raw CL/TE manipulation" },
  { id: "WSTG-INPV-17", title: "Testing for Host Header Injection", agent: "wstg-input-validation", status: "covered", mechanism: "http_replay Host header manipulation" },
  { id: "WSTG-INPV-18", title: "Testing for Server-Side Template Injection", agent: "wstg-input-validation", status: "covered", mechanism: "inject_probe ssti mode" },
  { id: "WSTG-INPV-19", title: "Testing for Server-Side Request Forgery", agent: "wstg-input-validation", status: "covered", mechanism: "ssrf_test (internal target payloads, oracle, probe)" },

  // ── ERRH — Error Handling (2) ─────────────────────────────────────────
  { id: "WSTG-ERRH-01", title: "Testing for Improper Error Handling", agent: "wstg-error-handling", status: "passive", mechanism: "StackTraceDetector + FullPathDisclosureDetector + SqlErrorDetector" },
  { id: "WSTG-ERRH-02", title: "Testing for Stack Traces", agent: "wstg-error-handling", status: "passive", mechanism: "StackTraceDetector + FullPathDisclosureDetector" },

  // ── CRYP — Weak Cryptography (4) ──────────────────────────────────────
  { id: "WSTG-CRYP-01", title: "Testing for Weak Transport Layer Security", agent: "wstg-cryptography", status: "covered", mechanism: "MissingSecurityHeadersDetector (HSTS) + manual header check" },
  { id: "WSTG-CRYP-02", title: "Testing for Padding Oracle", agent: "wstg-cryptography", status: "covered", mechanism: "http_replay CBC padding analysis" },
  { id: "WSTG-CRYP-03", title: "Testing for Sensitive Information Sent via Unencrypted Channels", agent: "wstg-cryptography", status: "passive", mechanism: "MissingSecurityHeadersDetector (HSTS)" },
  { id: "WSTG-CRYP-04", title: "Testing for Weak Encryption", agent: "wstg-cryptography", status: "covered", mechanism: "authn_test JWT weak-key detection" },

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
  { prefix: "WSTG-CONF", name: "Configuration and Deployment", count: 11 },
  { prefix: "WSTG-IDNT", name: "Identity Management", count: 5 },
  { prefix: "WSTG-ATHN", name: "Authentication", count: 10 },
  { prefix: "WSTG-ATHZ", name: "Authorization", count: 4 },
  { prefix: "WSTG-SESS", name: "Session Management", count: 9 },
  { prefix: "WSTG-INPV", name: "Input Validation", count: 19 },
  { prefix: "WSTG-ERRH", name: "Error Handling", count: 2 },
  { prefix: "WSTG-CRYP", name: "Weak Cryptography", count: 4 },
  { prefix: "WSTG-BUSL", name: "Business Logic", count: 9 },
  { prefix: "WSTG-CLNT", name: "Client-side", count: 13 },
  { prefix: "WSTG-APIT", name: "API Testing", count: 1 },
] as const

export const TOTAL_WSTG_TESTS = 97
