// Bugcrowd-style finding renderer. The report MUST follow this exact template, and
// Steps To Reproduce MUST carry a real, copy-paste-reproducible curl AND the full raw
// HTTP request (Burp-style) — both derived deterministically from the captured traffic
// referenced by the finding's evidence_request_ids, never from LLM prose.
//
//   # <title>
//   Affected Resource: …
//   Weakness: …   CWE: …   Severity: …
//   ## Vulnerability Overview          (general description of the finding TYPE, curated per-CWE)
//   ### Finding Details                (this specific instance: endpoints/params affected)
//   ### Steps To Reproduce             (numbered steps + deterministic curl + raw request/response)
//   ## Recommendations                 ("To address this finding…" + imperative bullets)
//   ## References                      ("See the following…" + links)
//   ## Impacts                         ("If not addressed…" + 1-3 bullets: what an attacker could do)
//
// "Vulnerability Overview" is the finding TYPE, not the instance, so it is a curated
// per-class paragraph (consistent, high quality) keyed by CWE — not per-finding prose.
import { Request } from "../session/request"
import { HttpMessage } from "../replay/message"
import { Apply } from "../replay/apply"
import type { Vulnerability } from "../session/vulnerability"

// Verbatim per-section guidance from the Bugcrowd template. Emitted as the placeholder when a
// section has no content (the agent's field AND the curated per-CWE library are both absent), so a
// REQUIRED section is never silently blank and the author sees exactly what to write. The vulnerability
// agent reads the SAME guidance in report_vulnerability.txt and authors each section accordingly.
const GUIDANCE = {
  overview:
    '[REQUIRED -- Provide a general description of the finding type. This paragraph describes the type of finding, and *not* the specific instance that you found. For example, what is a Cross-Site Scripting (XSS) vulnerability, and not which instances of XSS did you discover. Introduce any key terms or information that would help the reader understand how their application is affected by it. Try to answer the questions "What is the problem?" and "How could an attacker exploit it?"]',
  findingDetails:
    "[REQUIRED -- Provide a high-level summary of the vulnerability finding that your team discovered. Include a vulnerability description for this specific instance, and which endpoints, parameters, functions or pages are affected.]",
  steps:
    "[REQUIRED -- Provide a step by step on how to reproduce the vulnerability finding. Provide screenshots, curl commands, Burp Suite evidence, HTTP Requests and responses, or whatever you feel necessary to create thorough reproduction steps.]",
  recommendations:
    "[REQUIRED -- Provide a high-level recommendation for remediating the vulnerability finding, giving the customer some topics for further research, rather than specific lines of code to change. Write the recommendation in imperative (command) form, in a bulleted list with bolded head words.]",
  references:
    "[Optional - Provide any useful references related to the vulnerability you found, such as links to vulnerability blogs or details, CWE, CVEs, and exploits PoC, OWASP cheat sheets, or other resources.]",
  impacts:
    "[REQUIRED - Provide 1-3 bullet points describing what could happen for this specific vulnerability if not addressed. Write about what a hypothetical attacker could do, and use a bolded head word similar to the Recommendation format.]",
}

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
  // H1 = the only top-level title. Sections follow the exact Bugcrowd template.
  lines.push(`# ${ref ? `[${ref}] ` : ""}${v.title}`, "")

  // Metadata block (plain labels, per the Bugcrowd template): Affected Resource, then a blank line,
  // then Weakness / CWE / Severity — each on its own line.
  lines.push(`Affected Resource: \`${affected}\``, "")
  lines.push(`Weakness: ${weakness}`)
  const cwe = cweTag(v.cwe_id)
  if (cwe) lines.push(`CWE: [${cwe}](https://cwe.mitre.org/data/definitions/${cweNumber(v.cwe_id)}.html)`)
  const owasp = owaspFor(v.cwe_id)
  if (owasp) lines.push(`OWASP: ${owasp}`)
  lines.push(`Severity: ${sev}${v.candidate ? " (CANDIDATE — unconfirmed)" : ""}`)

  // ## Vulnerability Overview — the finding TYPE (curated per-CWE), not this specific instance.
  lines.push("", "## Vulnerability Overview", "")
  lines.push(info?.overview ?? GUIDANCE.overview)

  // ### Finding Details — this specific instance: what/where (endpoint, parameters), + attack vector.
  lines.push("", "### Finding Details", "")
  const details: string[] = []
  if (v.description && v.description.trim()) details.push(demoteHeadings(v.description.trim()))
  else details.push(GUIDANCE.findingDetails)
  details.push(`Affected: \`${affected}\`.`)
  if (v.attack_vector) details.push(`**Attack vector:** ${v.attack_vector}.`)
  lines.push(details.join("\n\n"))

  // ### Steps To Reproduce — numbered prose (headings demoted) + a deterministic copy-paste curl and
  // the raw request/response, each fenced as code. The agent's PoC (if any) folds in here.
  lines.push("", "### Steps To Reproduce", "")
  if (v.steps_to_reproduce && v.steps_to_reproduce.trim()) lines.push(demoteHeadings(v.steps_to_reproduce.trim()), "")
  lines.push(...renderReproduction(sessionID, v.evidence_request_ids))
  if (v.poc && v.poc.trim()) lines.push("", "Proof of concept:", "", fence(v.poc.trim()))

  // ## Recommendations — imperative bullets with bolded head words.
  lines.push("", "## Recommendations", "", "To address this finding, implement the following:", "")
  const recs = info?.recommendations ?? (v.recommendation ? [v.recommendation] : [GUIDANCE.recommendations])
  lines.push(...bullets(recs))
  if (info && v.recommendation && v.recommendation.trim()) lines.push("", `**Instance-specific note:** ${demoteHeadings(v.recommendation.trim())}`)

  // ## References
  lines.push("", "## References", "", "See the following for more information:", "")
  const refs = (v.references && v.references.length ? v.references : undefined) ?? info?.references ?? []
  if (refs.length) {
    for (const r of refs) {
      const [name, url] = r.includes("|") ? r.split("|") : [r, r]
      lines.push(`  - [${name}](${url})`)
    }
  } else {
    lines.push(`  ${GUIDANCE.references}`)
  }

  // ## Impacts — 1-3 bullets: what an attacker could do if this is not addressed.
  lines.push("", "## Impacts", "", "If not addressed, this finding could lead to the following:", "")
  const impacts = v.business_impact && v.business_impact.trim() ? [demoteHeadings(v.business_impact.trim())] : (info?.impacts ?? [GUIDANCE.impacts])
  lines.push(...bullets(impacts))

  return lines.join("\n")
}
