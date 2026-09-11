// Bugcrowd-style finding renderer. The report MUST follow this exact template, and
// Steps To Reproduce MUST carry a real, copy-paste-reproducible curl AND the full raw
// HTTP request (Burp-style) — both derived deterministically from the captured traffic
// referenced by the finding's evidence_request_ids, never from LLM prose.
//
//   # <title>
//   Affected Resource: …   Weakness: …   Severity: …
//   ## Vulnerability Overview          (general description of the finding TYPE)
//   ### Finding Details                (this specific instance)
//   ### Steps To Reproduce             (numbered steps + curl + raw request/response)
//   ## Recommendations                 (imperative bullets)
//   ## References
//   ## Impacts                         (bullets: what an attacker could do)
//
// "Vulnerability Overview" is the finding TYPE, not the instance, so it is a curated
// per-class paragraph (consistent, high quality) keyed by CWE — not per-finding prose.
import { Request } from "../session/request"
import { HttpMessage } from "../replay/message"
import { Apply } from "../replay/apply"
import type { Vulnerability } from "../session/vulnerability"

interface ClassInfo {
  weakness: string // human name shown on the "Weakness:" line
  overview: string // 1-2 sentences: what this finding TYPE is + how it is exploited
  recommendations: string[] // imperative bullets, "**Head**: text"
  impacts: string[] // "**Head**: text" — what an attacker could do
  references: string[] // "Name: Title|URL"
}

// Curated per-CWE library for the classes CyberStrike's web testers file. Keyed by the
// bare CWE number. Extend as new classes ship — an unknown CWE degrades gracefully.
const CLASS_LIBRARY: Record<string, ClassInfo> = {
  "639": {
    weakness: "Insecure Direct Object Reference (IDOR) / Authorization Bypass Through User-Controlled Key",
    overview:
      "An Insecure Direct Object Reference (IDOR) occurs when an application exposes a reference to an internal object — such as a database key, filename, or user identifier — and fails to verify that the authenticated user is authorized to access that specific object. An attacker can manipulate the identifier to read or modify records belonging to other users or tenants.",
    recommendations: [
      "**Object-Level Authorization**: Enforce an ownership check on every request that references an object, verifying the authenticated principal is entitled to the requested resource server-side (e.g. `WHERE id = ? AND owner_id = <session user>`).",
      "**Indirect References**: Prefer unpredictable, per-session indirect references over sequential or guessable identifiers.",
      "**Centralized Enforcement**: Apply authorization in a shared middleware/policy layer rather than ad hoc per endpoint.",
    ],
    impacts: [
      "**Data Exposure**: An attacker could enumerate identifiers to read other users' or tenants' records, exposing PII and confidential data.",
      "**Unauthorized Modification**: An attacker could alter or delete objects they do not own.",
    ],
    references: ["OWASP: Broken Object Level Authorization|https://owasp.org/API-Security/editions/2023/en/0xa1-broken-object-level-authorization/", "CWE-639|https://cwe.mitre.org/data/definitions/639.html"],
  },
  "284": {
    weakness: "Improper Access Control",
    overview:
      "Broken Access Control occurs when an application does not correctly enforce restrictions on what authenticated (or unauthenticated) users are permitted to do. An attacker can act outside their intended privileges — reaching administrative functionality, another user's data, or another tenant's resources — by replaying or altering requests the server fails to authorize.",
    recommendations: [
      "**Deny by Default**: Deny access unless a resource is explicitly granted to the requesting principal.",
      "**Server-Side Enforcement**: Enforce every authorization decision server-side; never rely on the client hiding a control.",
      "**Tenant Isolation**: Scope every query and action to the caller's tenant/organization.",
    ],
    impacts: [
      "**Privilege Escalation**: An attacker could reach functionality or data reserved for higher-privileged roles.",
      "**Cross-Tenant Access**: An attacker in one organization could read or modify another organization's data.",
    ],
    references: ["OWASP: Broken Access Control|https://owasp.org/Top10/A01_2021-Broken_Access_Control/", "CWE-284|https://cwe.mitre.org/data/definitions/284.html"],
  },
  "285": {
    weakness: "Improper Authorization",
    overview:
      "Improper Authorization occurs when an application does not verify that the authenticated user has the rights required for the requested action. Unlike authentication (proving identity), authorization governs what an identity may do; when it is missing or incomplete an attacker can perform actions beyond their permission level.",
    recommendations: [
      "**Per-Action Checks**: Authorize every state-changing and data-returning action against the caller's role and ownership.",
      "**Centralized Policy**: Implement authorization in a single policy layer so no endpoint can silently omit it.",
    ],
    impacts: [
      "**Unauthorized Actions**: An attacker could invoke privileged operations their role should not permit.",
      "**Data Exposure**: An attacker could retrieve records they are not authorized to view.",
    ],
    references: ["OWASP: Broken Access Control|https://owasp.org/Top10/A01_2021-Broken_Access_Control/", "CWE-285|https://cwe.mitre.org/data/definitions/285.html"],
  },
  "79": {
    weakness: "Cross-Site Scripting (XSS)",
    overview:
      "Cross-Site Scripting (XSS) occurs when an application includes untrusted data in a web page without proper validation or output encoding, allowing an attacker to execute script in the victim's browser in the context of the vulnerable origin. This lets the attacker run actions as the victim, steal session material, or tamper with the page.",
    recommendations: [
      "**Output Encoding**: Contextually encode all untrusted data on output (HTML, attribute, JS, URL).",
      "**Content Security Policy**: Deploy a strict CSP as defense in depth.",
      "**Framework Auto-Escaping**: Use a framework that auto-escapes by default and avoid unsafe sinks.",
    ],
    impacts: [
      "**Session Hijacking**: An attacker could exfiltrate session tokens or act as the victim.",
      "**Account Takeover**: An attacker could perform sensitive actions in the victim's session.",
    ],
    references: ["OWASP: Cross Site Scripting Prevention|https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html", "CWE-79|https://cwe.mitre.org/data/definitions/79.html"],
  },
  "89": {
    weakness: "SQL Injection",
    overview:
      "SQL Injection occurs when an application builds a database query from untrusted input without proper parameterization, letting an attacker alter the query's structure. This can expose or modify arbitrary data and, depending on the database, lead to further compromise.",
    recommendations: [
      "**Parameterized Queries**: Use prepared statements / parameterized queries for all database access.",
      "**Least Privilege**: Run the application's database account with the minimum privileges required.",
      "**Input Validation**: Validate and constrain input types where feasible as defense in depth.",
    ],
    impacts: [
      "**Data Breach**: An attacker could read the entire database, including credentials and PII.",
      "**Data Integrity Loss**: An attacker could modify or destroy stored data.",
    ],
    references: ["OWASP: SQL Injection Prevention|https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html", "CWE-89|https://cwe.mitre.org/data/definitions/89.html"],
  },
  "918": {
    weakness: "Server-Side Request Forgery (SSRF)",
    overview:
      "Server-Side Request Forgery (SSRF) occurs when an application fetches a remote resource using a user-controlled URL without sufficient validation, letting an attacker coerce the server into making requests to unintended destinations — including internal services and cloud metadata endpoints — that the attacker cannot reach directly.",
    recommendations: [
      "**Allowlist Destinations**: Restrict outbound requests to an explicit allowlist of hosts and schemes.",
      "**Block Internal Ranges**: Deny requests to private, loopback, and link-local address ranges and cloud metadata IPs.",
      "**Restrict Redirects**: Do not follow redirects to unvalidated destinations.",
    ],
    impacts: [
      "**Internal Reconnaissance**: An attacker could map and reach internal-only services.",
      "**Credential Theft**: An attacker could read cloud metadata credentials from the instance.",
    ],
    references: ["OWASP: SSRF Prevention|https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html", "CWE-918|https://cwe.mitre.org/data/definitions/918.html"],
  },
}

/** Bare CWE number from a "CWE-639" / "639" / "cwe_639" string. */
function cweNumber(cwe?: string | null): string | undefined {
  if (!cwe) return undefined
  const m = /(\d+)/.exec(cwe)
  return m ? m[1] : undefined
}

function classInfo(cwe?: string | null): ClassInfo | undefined {
  const n = cweNumber(cwe)
  return n ? CLASS_LIBRARY[n] : undefined
}

// OWASP Top-10 (2021) category per CWE, shown as a tag on the finding. Extend alongside CLASS_LIBRARY.
const OWASP_BY_CWE: Record<string, string> = {
  "639": "A01:2021 – Broken Access Control",
  "284": "A01:2021 – Broken Access Control",
  "285": "A01:2021 – Broken Access Control",
  "79": "A03:2021 – Injection",
  "89": "A03:2021 – Injection",
  "918": "A10:2021 – Server-Side Request Forgery (SSRF)",
}
function owaspFor(cwe?: string | null): string | undefined {
  const n = cweNumber(cwe)
  return n ? OWASP_BY_CWE[n] : undefined
}

// Agent-written free text (description / steps / poc / impact) may carry its OWN markdown headings.
// A leading `#` there becomes a top-level title when the finding is pasted into a tracker, colliding
// with the report's #/## hierarchy. Demote any heading line to bold so the report's own structure is
// the only heading hierarchy.
function demoteHeadings(text: string): string {
  return text.replace(/^\s{0,3}#{1,6}[ \t]+(.*)$/gm, "**$1**")
}

// Fence code (curl / raw HTTP / payloads) so a leading `#` reads as a comment in a code block, NEVER
// a Markdown heading. The fence is a run of backticks LONGER than any backtick-run inside the content,
// so an embedded ``` can't break out and leak the remainder as headings (use ``` normally, ```` when
// the content already contains ```). Optional language tag for raw HTTP; PoC (curl/shell) uses none.
function fence(code: string, lang = ""): string {
  const longest = (code.match(/`+/g) ?? []).reduce((m, r) => Math.max(m, r.length), 0)
  const ticks = "`".repeat(Math.max(3, longest + 1))
  return `${ticks}${lang}\n${code}\n${ticks}`
}

// A CWE id normalized to the "CWE-89" tag form.
function cweTag(cwe?: string | null): string | undefined {
  const n = cweNumber(cwe)
  return n ? `CWE-${n}` : cwe ?? undefined
}

/** Build the deterministic curl for a captured request (from its raw HTTP + origin). */
function curlFor(req: Request.Info): string | undefined {
  if (!req.raw_request) return undefined
  const origin = Request.resolveOrigin(req) ?? req.origin ?? ""
  try {
    return Apply.toCurl(HttpMessage.parse(req.raw_request), origin)
  } catch {
    return undefined
  }
}

/**
 * The reproduction block: for each evidence request, a curl one-liner AND the full raw
 * HTTP request + response (Burp-style). Deterministic — pulled from stored traffic, so
 * it is genuinely copy-paste reproducible regardless of what the agent wrote in prose.
 */
function renderReproduction(sessionID: string, evidenceIds: string[] | undefined): string[] {
  const out: string[] = []
  const ids = evidenceIds ?? []
  const reqs = ids.length ? Request.getByIds(sessionID, ids) : []
  if (reqs.length === 0) {
    out.push(
      "> No captured request evidence was attached to this finding. Reproduction cannot be rendered from traffic — attach `evidence_request_ids` when reporting.",
    )
    return out
  }
  let i = 1
  for (const req of reqs) {
    const url = (Request.resolveOrigin(req) ?? req.origin ?? "") + req.normalized_path
    out.push(`**Evidence ${i} — \`${req.method} ${url}\`**`, "")
    const curl = curlFor(req)
    if (curl) {
      out.push("curl:", "", fence(curl, "bash"), "")
    }
    out.push("Raw HTTP Request:", "", fence((req.raw_request ?? "").slice(0, 8000), "http"), "")
    if (req.response_status) {
      const head = `HTTP ${req.response_status}${req.response_content_type ? ` (${req.response_content_type})` : ""}`
      out.push("Response:", "", fence(`${head}\n\n${(req.processed_response ?? "").slice(0, 4000)}`, "http"), "")
    }
    i++
  }
  return out
}

function bullets(lines: string[]): string[] {
  return lines.map((l) => `- ${l}`)
}

/**
 * Render ONE finding in the mandatory Bugcrowd template. `ref` is the report id
 * (e.g. "HIGH-001"). Every REQUIRED section is always emitted; content the finding
 * lacks falls back to the curated per-class library or an explicit placeholder, so
 * the structure never silently drops a section.
 */
export function renderFinding(v: Vulnerability.Info, sessionID: string, ref?: string): string {
  const info = classInfo(v.cwe_id)
  const sev = v.severity.toUpperCase()
  const weakness = info?.weakness ?? v.cwe_id ?? "Unspecified Weakness"
  const affected = v.endpoint ?? "—"

  const lines: string[] = []
  // H1 = the only top-level title. Everything below is H2 so a paste into a tracker keeps one clean
  // heading hierarchy (title → sections).
  lines.push(`# ${ref ? `[${ref}] ` : ""}${v.title}`, "")

  // Metadata tags, incl. CWE + OWASP, on one scannable line.
  const tags: string[] = [`**Severity:** ${sev}${v.candidate ? " (CANDIDATE — unconfirmed)" : ""}`, `**Weakness:** ${weakness}`]
  const cwe = cweTag(v.cwe_id)
  if (cwe) tags.push(`**CWE:** [${cwe}](https://cwe.mitre.org/data/definitions/${cweNumber(v.cwe_id)}.html)`)
  const owasp = owaspFor(v.cwe_id)
  if (owasp) tags.push(`**OWASP:** ${owasp}`)
  lines.push(tags.join("  •  "), "")
  lines.push(`**Affected Resource:** \`${affected}\``, "")

  // ── Description ──
  lines.push("", "## Description", "")
  lines.push(info?.overview ?? `This finding is a ${weakness}.`)
  if (v.description && v.description.trim()) lines.push("", demoteHeadings(v.description.trim()))
  if (v.attack_vector) lines.push("", `**Attack vector:** ${v.attack_vector}.`)

  // ── Steps to Reproduce ── developer-friendly: numbered prose (headings demoted) + a deterministic
  // copy-paste curl and the raw request/response, each fenced as code so payloads read as code.
  lines.push("", "## Steps to Reproduce", "")
  if (v.steps_to_reproduce && v.steps_to_reproduce.trim()) lines.push(demoteHeadings(v.steps_to_reproduce.trim()), "")
  lines.push(...renderReproduction(sessionID, v.evidence_request_ids))

  // ── Proof of Concept ── the agent's crafted PoC, fenced so any `#`/payload reads as code, never a
  // heading, when pasted.
  if (v.poc && v.poc.trim()) {
    lines.push("", "## Proof of Concept", "", fence(v.poc.trim()))
  }

  // ── Business Impact ──
  lines.push("", "## Business Impact", "")
  const impacts = v.business_impact && v.business_impact.trim() ? [demoteHeadings(v.business_impact.trim())] : (info?.impacts ?? ["**Security Impact**: An attacker could exploit this finding as described above."])
  lines.push(...bullets(impacts))

  // ── Recommendations ──
  lines.push("", "## Recommendations", "")
  const recs = info?.recommendations ?? (v.recommendation ? [v.recommendation] : ["**Remediation**: Address the root cause described above."])
  lines.push(...bullets(recs))
  if (info && v.recommendation && v.recommendation.trim()) lines.push("", `**Instance-specific note:** ${demoteHeadings(v.recommendation.trim())}`)

  // ── References ──
  lines.push("", "## References", "")
  const refs = (v.references && v.references.length ? v.references : undefined) ?? info?.references ?? []
  if (refs.length) {
    for (const r of refs) {
      const [name, url] = r.includes("|") ? r.split("|") : [r, r]
      lines.push(`- [${name}](${url})`)
    }
  } else {
    lines.push("- _No references provided._")
  }

  return lines.join("\n")
}
