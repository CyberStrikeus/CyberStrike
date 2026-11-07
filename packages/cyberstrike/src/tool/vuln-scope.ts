// Lane discipline for the wstg-* WSTG specialist agents.
//
// A wstg-<class> agent may only RECORD findings (report_vulnerability /
// update_vrt_check) in its own vulnerability class. Off-class observations must
// be handed off via add_intel(type:"vulnerability_hint"), NOT tested/recorded by
// the wrong specialist. This is enforced structurally at the tool layer so it
// holds regardless of model capability (measured: opus testers recorded 6
// cross-role findings on a single request; o4-mini 0 — a capability-driven drift
// that prompt rules can't stop).
//
// Non-tester agents (cyberstrike, wstg-agent, …) are unrestricted.

export const TESTER_VRT_SCOPE: Record<string, string[]> = {
  "input-validation": [
    "sqli",
    "sql injection",
    "nosqli",
    "xss",
    "cross-site scripting",
    "ssti",
    "xxe",
    "command injection",
    "ldap",
    "ssrf",
    "server-side request",
    "path traversal",
    "directory traversal",
    "lfi",
    "rfi",
    "file upload",
    "file inclusion",
    "insecure file access",
    "zip slip",
    "mass assignment",
    "over-post",
    "overpost",
  ],
  authorization: [
    "idor",
    "bola",
    "privilege escalation",
    "auth bypass",
    "broken access control",
    "access control",
    "bfla",
    "cors",
    "forbidden",
  ],
  authentication: [
    "auth bypass",
    "authentication",
    "session",
    "jwt",
    "rate limit",
    "brute",
    "password",
    "mfa",
    "2fa",
    "credential",
    "default creds",
    "token",
  ],
  "session-mgmt": [
    "session fixation",
    "csrf",
    "cross-site request forgery",
    "cookie",
    "session hijack",
    "session timeout",
    "logout",
  ],
  "business-logic": ["race condition", "business logic", "chain", "captcha", "workflow", "negative"],
  "config-deploy": [
    "misconfiguration",
    "security header",
    "information disclosure",
    "stack trace",
    "error page",
    "backup file",
    "admin interface",
    "http method",
    "cors",
    "clickjacking",
    "hsts",
    "csp",
  ],
  llm: ["prompt injection", "jailbreak", "system prompt", "llm", "model"],
}

/**
 * Returns null when the category is within the caller's lane (or the caller is
 * not a wstg-tester). Otherwise returns the caller's class + its allowed set so
 * the tool can reject with a helpful hand-off message.
 */
export function vrtScopeViolation(
  agent: string | undefined,
  category: string,
): { cls: string; allowed: string[] } | null {
  const m = agent?.match(/^wstg-(.+)$/)
  if (!m) return null
  const cls = m[1]
  const allowed = TESTER_VRT_SCOPE[cls]
  if (!allowed) return null
  const cat = (category ?? "").toLowerCase().trim()
  if (!cat) return null
  const inScope = allowed.some((a) => cat.includes(a) || a.includes(cat))
  return inScope ? null : { cls, allowed }
}

// Best-effort: infer a vuln class from a free-text finding title (for
// report_vulnerability, which carries no explicit category). Order matters —
// the most specific signatures first. Returns null when uncertain.
const TITLE_SIGNATURES: [string, RegExp][] = [
  ["input-validation", /sql injection|sqli|nosql|\bxss\b|cross-site script|ssti|\bxxe\b|command inj|ldap inj|ssrf|server-side request|path traversal|directory traversal|\blfi\b|\brfi\b|arbitrary file (read|upload)|zip slip|mass assignment|over-?posting/i],
  ["authorization", /\bidor\b|\bbola\b|insecure direct object|broken access control|privilege escalation|unauthenticated access to/i],
  ["authentication", /default.*cred|brute[- ]?force|rate limit|password policy|account lockout|session fixation|weak password/i],
  ["session-mgmt", /\bcsrf\b|cross-site request forgery|cookie flag|session (fixation|hijack|timeout)|logout/i],
  ["business-logic", /race condition|negative amount|workflow bypass/i],
  ["config-deploy", /misconfiguration|security header|information disclosure|stack trace|backup file|admin interface/i],
  ["llm", /prompt injection|jailbreak|system prompt leak/i],
]
export function classifyFindingTitle(title: string): string | null {
  const s = (title ?? "").toLowerCase()
  for (const [cls, re] of TITLE_SIGNATURES) if (re.test(s)) return cls
  return null
}

// Systemic / config-level finding classes (issue #45): a finding here is inherently "one issue, MANY
// endpoints" — a site-wide CORS policy, missing headers, cookie flags — so it must aggregate into a
// SINGLE finding with an affected-endpoints list, the way a real pentest reports it (not one row per
// endpoint). Endpoint-specific classes (IDOR/XSS/SQLi/SSRF/auth-bypass) are deliberately NOT here —
// each is a distinct vuln. `variant` splits a class where the sub-issues are genuinely different
// (CORS credentialed origin-reflection vs. plain wildcard) so they never over-collapse into one.
// Note: classifyFindingTitle has no CORS/header/cookie-systemic bucket, so this is a separate lane.
export function aggregateSignature(title: string): { cls: string; variant: string } | null {
  const s = (title ?? "").toLowerCase()
  if (/\bcors\b|cross-origin|access-control-allow-origin/.test(s)) {
    const reflect = /reflect|arbitrary origin|mirror|echo(es|ed)? (the )?origin/.test(s)
    return { cls: "cors", variant: reflect ? "origin-reflection" : "wildcard" }
  }
  if (/clickjack|x-frame-options|frame-ancestors|missing (csp|content-security-policy|hsts|strict-transport|security header)|security header/.test(s))
    return { cls: "security-headers", variant: "missing" }
  if (/cookie[^.]*(httponly|samesite|secure)|(httponly|samesite|secure)[^.]*cookie|cookie flag/.test(s))
    return { cls: "cookie-flags", variant: "weak" }
  if (/stack trace|full[- ]?path disclosure|internal exception|verbose error|server (banner|version)|version disclos/.test(s))
    return { cls: "info-disclosure", variant: "verbose" }
  return null
}

const AGGREGATE_TITLES: Record<string, string> = {
  "cors|origin-reflection": "CORS reflects arbitrary Origin (credentialed cross-origin access)",
  "cors|wildcard": "Permissive wildcard CORS (Access-Control-Allow-Origin: *)",
  "security-headers|missing": "Missing security headers / clickjacking protection",
  "cookie-flags|weak": "Cookies set without hardening flags (HttpOnly / SameSite / Secure)",
  "info-disclosure|verbose": "Information disclosure (verbose errors / stack traces / version banners)",
}
// The consolidated title for an aggregate finding, carrying the affected-endpoint count.
export function aggregateTitleFor(cls: string, variant: string, n: number): string {
  const base = AGGREGATE_TITLES[`${cls}|${variant}`] ?? `${cls} (${variant})`
  return `${base} — ${n} endpoint${n === 1 ? "" : "s"}`
}

// Execution-dependent finding classes: ones where "it exists" needs an OBSERVED
// trigger (alert/flag/checker output), not just a reflected/echoed byte. Derived
// deterministically from title+cwe — the model's vrt_category is NEVER trusted.
// Intentionally narrower and separate from classifyFindingTitle: that collapses
// ALL injection into one coarse "input-validation" bucket and can't tell XSS from SQLi;
// this splits out the exec subset and EXCLUDES SQLi/LFI/IDOR/SSRF (response = proof).
// Short/ambiguous tokens are \b-bounded to avoid substring bleed (rce↮commerce).
const EXEC_DEPENDENT_TITLE =
  /\bxss\b|cross-site script|dom[- ]?based|\bssti\b|template injection|command injection|os command|\brce\b|remote code execution|insecure deserial|deserializ/i
const EXEC_DEPENDENT_CWE = new Set([
  "CWE-79", // XSS
  "CWE-80", // basic XSS
  "CWE-83", // improper neutralization of script in attributes
  "CWE-87", // improper neutralization for alternate XSS syntax
  "CWE-94", // code injection
  "CWE-95", // eval injection (SSTI/code)
  "CWE-917", // expression-language injection (SSTI)
  "CWE-1336", // template-engine injection (SSTI)
  "CWE-78", // OS command injection
  "CWE-77", // command injection
  "CWE-502", // deserialization → RCE
])
/**
 * True when the finding's class needs an OBSERVED trigger to be "confirmed"
 * (reflected/DOM XSS, SSTI-exec, command-injection, deser-RCE). SQLi (error or
 * blind), LFI, IDOR, SSRF, info-disclosure return FALSE — their response is the
 * proof, so they are never gated. Errs toward TRUE (over-gating only downgrades,
 * never fabricates a finding). Model-supplied vrt_category is ignored by design.
 */
export function isExecutionDependentFinding(title: string, cweId?: string): boolean {
  if (EXEC_DEPENDENT_TITLE.test(title ?? "")) return true
  const c = (cweId ?? "").toUpperCase().trim()
  return c ? EXEC_DEPENDENT_CWE.has(c) : false
}

/**
 * Scope check for report_vulnerability. Uses the explicit vrt_category when the
 * tester provides one; otherwise infers the class from the title. Returns the
 * caller's class + allowed set on an off-lane report, else null.
 */
export function reportScopeViolation(
  agent: string | undefined,
  vrtCategory: string | undefined,
  title: string,
): { cls: string; allowed: string[] } | null {
  const m = agent?.match(/^wstg-(.+)$/)
  if (!m) return null
  const cls = m[1]
  const allowed = TESTER_VRT_SCOPE[cls]
  if (!allowed) return null

  // 1. An explicit category must be in the caller's lane.
  if (vrtCategory) {
    const v = vrtScopeViolation(agent, vrtCategory)
    if (v) return v
  }
  // 2. Anti-spoof cross-check: even when the category is in-lane, if the TITLE
  //    confidently classifies to another class, treat the category as a mislabel
  //    and reject. Stops "report an IDOR as vrt_category:SQLi to evade the guard".
  //    Conservative — an unclassifiable title (null) never triggers a reject.
  const inferred = classifyFindingTitle(title)
  if (inferred && inferred !== cls) return { cls, allowed }
  return null
}

/**
 * The tester class for an agent name ("wstg-input-validation" → "input-validation"),
 * or undefined if the agent is not a recognized wstg-tester. Used to scope methodology
 * context (Phase 2.3) so a tester is handed only its own lane's work/hints.
 */
export function testerClass(agent: string | undefined): string | undefined {
  const m = agent?.match(/^wstg-(.+)$/)
  return m && TESTER_VRT_SCOPE[m[1]] ? m[1] : undefined
}

/**
 * Whether a free-text VRT category falls in a tester class's lane. Conservative:
 * unknown class or empty category → true (don't hide). Reuses the scope taxonomy.
 */
export function categoryInLane(cls: string, category: string): boolean {
  const allowed = TESTER_VRT_SCOPE[cls]
  if (!allowed) return true
  const cat = (category ?? "").toLowerCase().trim()
  if (!cat) return true
  return allowed.some((a) => cat.includes(a) || a.includes(cat))
}

/**
 * Dispatch-time lane guard (Phase 4). The orchestrator routes each test to a
 * specialist; when a wstg-<cls> is dispatched with an objective that
 * confidently belongs to ANOTHER class (e.g. a rate-limiting task sent to
 * business-logic), return the caller's class + the correct target so task() can
 * bounce it with a re-dispatch hint. Conservative: returns null when the target
 * is not a wstg-tester OR the objective is ambiguous (no confident class) — it
 * never false-blocks a vague-but-correct dispatch. Capability-agnostic, so it
 * holds for o4-mini (which mis-routes more) and opus alike.
 */
export function dispatchScopeViolation(
  subagentType: string | undefined,
  objective: string,
): { cls: string; inferred: string } | null {
  const m = subagentType?.match(/^wstg-(.+)$/)
  if (!m) return null
  const cls = m[1]
  if (!TESTER_VRT_SCOPE[cls]) return null
  const inferred = classifyFindingTitle(objective)
  if (inferred && inferred !== cls) return { cls, inferred }
  return null
}

// ── Severity caps (#72) ─────────────────────────────────────────────────────
// Code-enforced maximum severity per vulnerability class/pattern. The agent
// claims a severity; this function caps it to the realistic maximum for that
// class based on industry standards (OWASP, CVSS base metrics, real pentest
// practice). Returns the capped severity + reason if the cap was applied.
//
// The cap is a CEILING, not a floor — a finding can be lower than the cap
// but never higher. "config-deploy" includes CORS, missing headers, info
// disclosure — these are never critical and rarely high without chaining.

type SeverityRank = "critical" | "high" | "medium" | "low" | "info"
const SEV_ORDER: SeverityRank[] = ["info", "low", "medium", "high", "critical"]

// Pattern-based caps: regex on title → max severity. Most specific first.
// These override the class-based caps below when they match.
const PATTERN_CAPS: [RegExp, SeverityRank, string][] = [
  // CORS — almost never high unless credential-reflection to attacker-controlled origin
  [/\bcors\b|cross-origin|access-control-allow/i, "medium", "CORS misconfiguration is medium at most without demonstrated credential theft"],
  // Missing security headers (CSP, HSTS, X-Frame-Options, etc.)
  [/missing.*(csp|content-security-policy|hsts|strict-transport|x-frame|security header)|clickjack/i, "low", "missing security headers are low — defense-in-depth, not directly exploitable"],
  // Cookie flags (HttpOnly, Secure, SameSite)
  [/cookie.*(httponly|samesite|secure)|(httponly|samesite|secure).*cookie|cookie flag/i, "low", "cookie flag issues are low — hardening, not direct exploitation"],
  // Info disclosure, stack traces, version banners
  [/stack trace|full[- ]?path|internal exception|verbose error|server (banner|version)|version disclos|technology detect/i, "info", "information disclosure is informational unless it directly enables another attack"],
  // Default credentials (genuinely high — direct access)
  [/default.*cred|default.*password/i, "high", "default credentials allow direct access"],
  // Rate limiting (useful but not high)
  [/rate limit|brute[- ]?force.*protect/i, "low", "missing rate limiting is low — it enables attacks but is not one"],
  // Password policy
  [/password policy|weak password.*policy/i, "info", "password policy findings are informational"],
  // TLS/SSL issues
  [/ssl|tls.*(weak|deprecated|outdated)|certificate/i, "medium", "TLS/SSL configuration issues are medium"],
]

// Class-based caps: fallback when no pattern matches. Based on classifyFindingTitle output.
const CLASS_CAPS: Record<string, SeverityRank> = {
  "config-deploy": "medium",
  "session-mgmt": "medium",
  "authentication": "high",
  "business-logic": "high",
  "authorization": "critical",
  "input-validation": "critical",
  "llm": "high",
}

export interface SeverityCap {
  capped: boolean
  severity: SeverityRank
  original?: SeverityRank
  reason?: string
}

export function capSeverity(title: string, claimedSeverity: string): SeverityCap {
  const claimed = claimedSeverity as SeverityRank
  const claimedIdx = SEV_ORDER.indexOf(claimed)
  if (claimedIdx === -1) return { capped: false, severity: claimed }

  // Pattern-based caps (most specific, checked first)
  for (const [re, maxSev, reason] of PATTERN_CAPS) {
    if (re.test(title)) {
      const maxIdx = SEV_ORDER.indexOf(maxSev)
      if (claimedIdx > maxIdx) {
        return { capped: true, severity: maxSev, original: claimed, reason }
      }
      return { capped: false, severity: claimed }
    }
  }

  // Class-based caps (fallback)
  const cls = classifyFindingTitle(title)
  if (cls && CLASS_CAPS[cls]) {
    const maxSev = CLASS_CAPS[cls]
    const maxIdx = SEV_ORDER.indexOf(maxSev)
    if (claimedIdx > maxIdx) {
      return { capped: true, severity: maxSev, original: claimed, reason: `${cls} class findings are capped at ${maxSev}` }
    }
  }

  return { capped: false, severity: claimed }
}

/** Hand-off message shown when a tester is dispatched outside its lane. */
export function dispatchOffLaneMessage(cls: string, inferred: string): string {
  return (
    `Dispatch rejected: this objective is wstg-${inferred}'s lane, not wstg-${cls}'s. ` +
    `Re-dispatch with subagent_type "wstg-${inferred}" so the right specialist handles it — ` +
    `each tester must stay in its own vulnerability class.`
  )
}

/** Standard hand-off message shown when a tester records out of its lane. */
export function offLaneMessage(cls: string, allowed: string[], category: string): string {
  return (
    `Out of scope: as wstg-${cls} you may only record findings in your own class ` +
    `(${allowed.join(", ")}). "${category}" belongs to another specialist — do NOT test or record it yourself. ` +
    `Hand it off with add_intel(type:"vulnerability_hint", ...) so the orchestrator can route it to the right tester.`
  )
}
