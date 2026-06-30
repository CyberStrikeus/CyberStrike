// Lane discipline for the proxy vuln testers (Phase 2, docs/proxy-pipeline-redesign).
//
// A proxy-tester-<class> agent may only RECORD findings (report_vulnerability /
// update_vrt_check) in its own vulnerability class. Off-class observations must
// be handed off via add_intel(type:"vulnerability_hint"), NOT tested/recorded by
// the wrong specialist. This is enforced structurally at the tool layer so it
// holds regardless of model capability (measured: opus testers recorded 6
// cross-role findings on a single request; o4-mini 0 — a capability-driven drift
// that prompt rules can't stop).
//
// Non-tester agents (cyberstrike, web-application, …) are unrestricted.

export const TESTER_VRT_SCOPE: Record<string, string[]> = {
  idor: ["idor", "bola"],
  authz: [
    "privilege escalation",
    "auth bypass",
    "broken access control",
    "access control",
    "bfla",
    "cors",
    "forbidden",
  ],
  injection: [
    "sqli",
    "sql injection",
    "nosqli",
    "xss",
    "cross-site scripting",
    "ssti",
    "xxe",
    "command injection",
    "ldap",
  ],
  authn: [
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
  ssrf: ["ssrf", "server-side request"],
  "file-attacks": [
    "path traversal",
    "directory traversal",
    "lfi",
    "rfi",
    "file upload",
    "file inclusion",
    "insecure file access",
    "zip slip",
  ],
  "mass-assignment": ["mass assignment", "over-post", "overpost"],
  "business-logic": ["race condition", "business logic", "chain", "captcha", "workflow", "negative"],
}

/**
 * Returns null when the category is within the caller's lane (or the caller is
 * not a proxy-tester). Otherwise returns the caller's class + its allowed set so
 * the tool can reject with a helpful hand-off message.
 */
export function vrtScopeViolation(
  agent: string | undefined,
  category: string,
): { cls: string; allowed: string[] } | null {
  const m = agent?.match(/^proxy-tester-(.+)$/)
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
  ["injection", /sql injection|sqli|nosql|\bxss\b|cross-site script|ssti|\bxxe\b|command inj|ldap inj/i],
  ["idor", /\bidor\b|\bbola\b|insecure direct object/i],
  ["ssrf", /\bssrf\b|server-side request forgery/i],
  ["file-attacks", /path traversal|directory traversal|\blfi\b|\brfi\b|arbitrary file (read|upload)|zip slip/i],
  ["mass-assignment", /mass assignment|over-?posting/i],
  ["authn", /default.*cred|brute[- ]?force|rate limit|password policy|account lockout|session fixation|weak password/i],
  ["authz", /broken access control|privilege escalation|unauthenticated access to/i],
  ["business-logic", /race condition|negative amount|workflow bypass/i],
]
export function classifyFindingTitle(title: string): string | null {
  const s = (title ?? "").toLowerCase()
  for (const [cls, re] of TITLE_SIGNATURES) if (re.test(s)) return cls
  return null
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
  const m = agent?.match(/^proxy-tester-(.+)$/)
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
 * The tester class for an agent name ("proxy-tester-idor" → "idor"), or undefined
 * if the agent is not a recognized proxy-tester. Used to scope methodology context
 * (Phase 2.3) so a tester is handed only its own lane's work/hints.
 */
export function testerClass(agent: string | undefined): string | undefined {
  const m = agent?.match(/^proxy-tester-(.+)$/)
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
 * specialist; when a proxy-tester-<cls> is dispatched with an objective that
 * confidently belongs to ANOTHER class (e.g. a rate-limiting task sent to
 * business-logic), return the caller's class + the correct target so task() can
 * bounce it with a re-dispatch hint. Conservative: returns null when the target
 * is not a proxy-tester OR the objective is ambiguous (no confident class) — it
 * never false-blocks a vague-but-correct dispatch. Capability-agnostic, so it
 * holds for o4-mini (which mis-routes more) and opus alike.
 */
export function dispatchScopeViolation(
  subagentType: string | undefined,
  objective: string,
): { cls: string; inferred: string } | null {
  const m = subagentType?.match(/^proxy-tester-(.+)$/)
  if (!m) return null
  const cls = m[1]
  if (!TESTER_VRT_SCOPE[cls]) return null
  const inferred = classifyFindingTitle(objective)
  if (inferred && inferred !== cls) return { cls, inferred }
  return null
}

/** Hand-off message shown when a tester is dispatched outside its lane. */
export function dispatchOffLaneMessage(cls: string, inferred: string): string {
  return (
    `Dispatch rejected: this objective is proxy-tester-${inferred}'s lane, not proxy-tester-${cls}'s. ` +
    `Re-dispatch with subagent_type "proxy-tester-${inferred}" so the right specialist handles it — ` +
    `each tester must stay in its own vulnerability class.`
  )
}

/** Standard hand-off message shown when a tester records out of its lane. */
export function offLaneMessage(cls: string, allowed: string[], category: string): string {
  return (
    `Out of scope: as proxy-tester-${cls} you may only record findings in your own class ` +
    `(${allowed.join(", ")}). "${category}" belongs to another specialist — do NOT test or record it yourself. ` +
    `Hand it off with add_intel(type:"vulnerability_hint", ...) so the orchestrator can route it to the right tester.`
  )
}
