// ============================================================
// PHASE DEFINITIONS — 13-phase testing methodology
// CyberStrike methodology engine — phase lifecycle management
// ============================================================

export namespace Phase {
  export type Id =
    | "scope_analysis"
    | "passive_recon"
    | "active_recon"
    | "technology_profiling"
    | "authentication_testing"
    | "session_management"
    | "authorization_testing"
    | "input_validation"
    | "business_logic"
    | "data_protection"
    | "api_security"
    | "infrastructure"
    | "reporting"

  export type Status = "not_started" | "in_progress" | "completed" | "blocked"

  export type ScopeType = "wildcard" | "single" | "cidr" | "mobile"

  export interface Definition {
    id: Id
    name: string
    prerequisites: Id[]
    requiredTags: string[]
    minDeliverables: number
    relatedVrtCategories: string[]
    appliesTo: ScopeType[]
    agents: string[]
  }

  export const ALL: Definition[] = [
    {
      id: "scope_analysis",
      name: "Scope Analysis & Attack Surface Discovery",
      prerequisites: [],
      requiredTags: ["scope-analysis", "scope", "attack-surface"],
      minDeliverables: 1,
      relatedVrtCategories: [],
      appliesTo: ["wildcard", "single", "cidr", "mobile"],
      agents: ["explore", "cyberstrike"],
    },
    {
      id: "passive_recon",
      name: "Passive Reconnaissance",
      prerequisites: ["scope_analysis"],
      requiredTags: ["passive-recon", "subdomain", "osint", "recon"],
      minDeliverables: 1,
      relatedVrtCategories: [],
      appliesTo: ["wildcard", "single"],
      agents: ["explore"],
    },
    {
      id: "active_recon",
      name: "Active Reconnaissance & Enumeration",
      prerequisites: ["passive_recon"],
      requiredTags: ["active-recon", "live-host", "port-scan", "crawl"],
      minDeliverables: 1,
      relatedVrtCategories: [],
      appliesTo: ["wildcard", "single"],
      agents: ["explore", "web-application"],
    },
    {
      id: "technology_profiling",
      name: "Technology Profiling",
      prerequisites: ["active_recon"],
      requiredTags: ["technology", "tech-profile", "framework", "stack"],
      minDeliverables: 1,
      relatedVrtCategories: ["Known CVE", "Framework Vuln"],
      appliesTo: ["wildcard", "single"],
      agents: ["explore", "web-application"],
    },
    {
      id: "authentication_testing",
      name: "Authentication Testing",
      prerequisites: ["technology_profiling"],
      requiredTags: ["auth-testing", "authentication", "login", "signup"],
      minDeliverables: 1,
      relatedVrtCategories: ["Auth Bypass", "Default Creds"],
      appliesTo: ["wildcard", "single"],
      agents: ["web-application", "proxy-agent"],
    },
    {
      id: "session_management",
      name: "Session Management Testing",
      prerequisites: ["authentication_testing"],
      requiredTags: ["session-testing", "session", "cookie", "token"],
      minDeliverables: 1,
      relatedVrtCategories: ["Info Disclosure"],
      appliesTo: ["wildcard", "single"],
      agents: ["web-application", "proxy-agent"],
    },
    {
      id: "authorization_testing",
      name: "Authorization & Access Control Testing",
      prerequisites: ["session_management"],
      requiredTags: ["authz-testing", "authorization", "idor", "bac", "privesc", "access-map"],
      minDeliverables: 1,
      relatedVrtCategories: ["IDOR", "Privilege Escalation", "Auth Bypass", "CORS"],
      appliesTo: ["wildcard", "single"],
      agents: ["web-application", "proxy-agent"],
    },
    {
      id: "input_validation",
      name: "Input Validation Testing",
      prerequisites: ["technology_profiling"],
      requiredTags: ["input-validation", "xss", "sqli", "ssti", "injection"],
      minDeliverables: 1,
      relatedVrtCategories: ["SQLi", "XSS", "SSTI", "Command Injection", "SSRF"],
      appliesTo: ["wildcard", "single"],
      agents: ["web-application"],
    },
    {
      id: "business_logic",
      name: "Business Logic Testing",
      prerequisites: ["authorization_testing", "input_validation"],
      requiredTags: ["business-logic", "race-condition", "logic-flaw"],
      minDeliverables: 0,
      relatedVrtCategories: ["Race Condition", "Chain Test"],
      appliesTo: ["wildcard", "single"],
      agents: ["web-application"],
    },
    {
      id: "data_protection",
      name: "Data Protection Testing",
      prerequisites: ["technology_profiling"],
      requiredTags: ["data-protection", "sensitive-data", "encryption", "tls"],
      minDeliverables: 0,
      relatedVrtCategories: ["Info Disclosure"],
      appliesTo: ["wildcard", "single"],
      agents: ["web-application", "explore"],
    },
    {
      id: "api_security",
      name: "API Security Testing",
      prerequisites: ["technology_profiling"],
      requiredTags: ["api-security", "api-testing", "graphql", "rest"],
      minDeliverables: 0,
      relatedVrtCategories: ["IDOR", "Auth Bypass", "SSRF", "Info Disclosure"],
      appliesTo: ["wildcard", "single"],
      agents: ["web-application", "proxy-agent"],
    },
    {
      id: "infrastructure",
      name: "Infrastructure Testing",
      prerequisites: ["active_recon"],
      requiredTags: ["infrastructure", "cloud", "network", "dns"],
      minDeliverables: 0,
      relatedVrtCategories: ["Config Manipulation", "Default Creds"],
      appliesTo: ["wildcard", "cidr"],
      agents: ["cloud-security", "internal-network"],
    },
    {
      id: "reporting",
      name: "Reporting & Validation",
      prerequisites: [
        "scope_analysis",
        "passive_recon",
        "active_recon",
        "technology_profiling",
        "authentication_testing",
        "session_management",
        "authorization_testing",
        "input_validation",
        "business_logic",
      ],
      requiredTags: ["reporting", "report"],
      minDeliverables: 0,
      relatedVrtCategories: [],
      appliesTo: ["wildcard", "single", "cidr", "mobile"],
      agents: ["cyberstrike"],
    },
  ]

  export function get(id: Id): Definition | undefined {
    return ALL.find((p) => p.id === id)
  }

  export function forScope(scopeType: ScopeType): Definition[] {
    return ALL.filter((p) => p.appliesTo.includes(scopeType))
  }

  // --- OWASP Coverage Mappings ---

  export interface OWASPDefinition {
    id: string
    name: string
    category: "web" | "api" | "mobile"
    vrtCategories: string[]
  }

  export const OWASP_WEB_TOP10: OWASPDefinition[] = [
    {
      id: "A01",
      name: "Broken Access Control",
      category: "web",
      vrtCategories: ["IDOR", "Privilege Escalation", "Auth Bypass", "CORS"],
    },
    { id: "A02", name: "Cryptographic Failures", category: "web", vrtCategories: ["Info Disclosure", "Known CVE"] },
    { id: "A03", name: "Injection", category: "web", vrtCategories: ["SQLi", "XSS", "SSTI", "Command Injection"] },
    { id: "A04", name: "Insecure Design", category: "web", vrtCategories: ["Race Condition", "Chain Test"] },
    {
      id: "A05",
      name: "Security Misconfiguration",
      category: "web",
      vrtCategories: ["CORS", "Info Disclosure", "Default Creds", "Config Manipulation"],
    },
    { id: "A06", name: "Vulnerable Components", category: "web", vrtCategories: ["Known CVE", "Framework Vuln"] },
    { id: "A07", name: "Auth Failures", category: "web", vrtCategories: ["Auth Bypass"] },
    { id: "A08", name: "Software & Data Integrity", category: "web", vrtCategories: ["Deserialization"] },
    { id: "A09", name: "Logging & Monitoring", category: "web", vrtCategories: ["Info Disclosure"] },
    { id: "A10", name: "SSRF", category: "web", vrtCategories: ["SSRF"] },
  ]

  export const OWASP_API_TOP10: OWASPDefinition[] = [
    { id: "API1", name: "BOLA", category: "api", vrtCategories: ["IDOR"] },
    { id: "API2", name: "Broken Authentication", category: "api", vrtCategories: ["Auth Bypass"] },
    { id: "API3", name: "BOPLA", category: "api", vrtCategories: ["Privilege Escalation", "Info Disclosure"] },
    { id: "API4", name: "Unrestricted Resource Consumption", category: "api", vrtCategories: ["Race Condition"] },
    { id: "API5", name: "BFLA", category: "api", vrtCategories: ["Privilege Escalation", "Auth Bypass"] },
    {
      id: "API6",
      name: "Unrestricted Sensitive Business Flows",
      category: "api",
      vrtCategories: ["Race Condition", "Chain Test"],
    },
    { id: "API7", name: "SSRF", category: "api", vrtCategories: ["SSRF"] },
    {
      id: "API8",
      name: "Security Misconfiguration",
      category: "api",
      vrtCategories: ["CORS", "Info Disclosure", "Config Manipulation"],
    },
    { id: "API9", name: "Improper Inventory Management", category: "api", vrtCategories: ["Info Disclosure"] },
    { id: "API10", name: "Unsafe Consumption of APIs", category: "api", vrtCategories: ["SSRF"] },
  ]

  // --- VRT Category Mappings per Intel Type ---

  export const VRT_CATEGORIES_BY_TYPE: Record<string, Array<{ category: string; path: string }>> = {
    endpoint: [
      { category: "IDOR", path: "Broken Access Control > IDOR > View Sensitive Info" },
      { category: "XSS", path: "Cross-Site Scripting > Reflected > URL Parameter" },
      { category: "SQLi", path: "Injection > SQL Injection > Parameter Based" },
      { category: "SSRF", path: "Server-Side Request Forgery > Internal Service Access" },
      { category: "Auth Bypass", path: "Authentication > Authentication Bypass > Direct Access" },
      { category: "Race Condition", path: "Business Logic > Race Condition > State Manipulation" },
      { category: "Info Disclosure", path: "Information Disclosure > Sensitive Data Exposure" },
    ],
    parameter: [
      { category: "XSS", path: "Cross-Site Scripting > Reflected > Parameter Injection" },
      { category: "SQLi", path: "Injection > SQL Injection > Parameter Based" },
      { category: "SSRF", path: "Server-Side Request Forgery > URL Parameter" },
      { category: "SSTI", path: "Injection > Server-Side Template Injection" },
      { category: "Command Injection", path: "Injection > OS Command Injection > Parameter" },
    ],
    credential: [
      { category: "Auth Bypass", path: "Authentication > Credential Validation > Leaked Credential" },
      { category: "Privilege Escalation", path: "Broken Access Control > Privilege Escalation > Credential Abuse" },
    ],
    subdomain: [
      { category: "Subdomain Takeover", path: "DNS > Subdomain Takeover > CNAME Dangling" },
      { category: "Info Disclosure", path: "Information Disclosure > Service Exposure" },
    ],
    technology: [
      { category: "Known CVE", path: "Known Vulnerabilities > CVE-based > Framework" },
      { category: "Framework Vuln", path: "Framework-Specific > Misconfiguration" },
    ],
    configuration: [
      { category: "Info Disclosure", path: "Information Disclosure > Configuration Exposure" },
      { category: "Config Manipulation", path: "Business Logic > Configuration Manipulation" },
    ],
    api_schema: [
      { category: "IDOR", path: "Broken Access Control > IDOR > API Parameter" },
      { category: "Auth Bypass", path: "Authentication > API Key Bypass" },
      { category: "Info Disclosure", path: "Information Disclosure > API Schema Exposure" },
    ],
    authentication_flow: [
      { category: "Auth Bypass", path: "Authentication > Authentication Bypass > Flow Manipulation" },
      { category: "Race Condition", path: "Business Logic > Race Condition > Authentication" },
    ],
    infrastructure: [
      { category: "SSRF", path: "Server-Side Request Forgery > Internal Service" },
      { category: "Default Creds", path: "Authentication > Default Credentials > Service" },
      { category: "Info Disclosure", path: "Information Disclosure > Service Exposure" },
    ],
    vulnerability_hint: [],
    business_rule: [],
    sensitive_data: [],
  }

  // --- Scope Detection ---

  export function detectScopeType(items: string[]): ScopeType {
    if (items.some((i) => /^\d+\.\d+\.\d+\.\d+\/\d+$/.test(i))) return "cidr"
    if (items.some((i) => /\.(apk|ipa)$/i.test(i) || /^(com|io|net)\.[a-z]/i.test(i))) return "mobile"
    if (items.some((i) => /^\*\./.test(i))) return "wildcard"
    return "single"
  }
}
