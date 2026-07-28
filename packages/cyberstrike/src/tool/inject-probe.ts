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

const description = `Fire a battery of probes at ONE parameter-bearing request and return RAW OBSERVATIONS (baseline vs each payload: did a marker reflect, was it HTML-encoded, which HTML tags survived a filter).

This tool does NOT find or confirm vulnerabilities and does NOT execute JavaScript — it only reports what the server echoed back. Every observation is a LEAD you must verify yourself, never a verdict. After reading it: craft and send the actual exploit to confirm, and separately cover every class listed under coverage.not_tested (this tool does not test them).

v1 supports vuln_type "xss" only, on query-string and form-urlencoded parameters.`

// Tag battery — one benign marker per tag so we can detect survival + encoding
// without executing anything. The agent weaponizes a surviving tag afterwards.
const XSS_TAGS = ["script", "img", "svg", "body", "style", "details", "a", "marquee", "input", "iframe"]

const V1_NOT_TESTED = [
  "stored/second-order XSS (fires on a different render request)",
  "DOM-based XSS (needs a JS engine)",
  "true JS execution (this tool only checks reflection, not execution)",
  "blind/out-of-band classes",
  "CSRF-token-protected or multi-step flows",
  "non-query/non-form injection points (path, header, cookie, JSON, XML, GraphQL, multipart)",
]

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

// ── injection points (v1: query params + form-urlencoded fields) ──

interface InjPoint {
  location: "query" | "form_field"
  name: string
}

function enumeratePoints(r: ResolvedRequest, only?: string): InjPoint[] {
  const points: InjPoint[] = []
  for (const [name] of r.url.searchParams) if (!only || only === name) points.push({ location: "query", name })
  if (r.contentType.includes("application/x-www-form-urlencoded")) {
    const form = new URLSearchParams(r.body)
    for (const [name] of form) if (!only || only === name) points.push({ location: "form_field", name })
  }
  return points
}

function withPayload(r: ResolvedRequest, point: InjPoint, value: string): { url: string; body: string } {
  if (point.location === "query") {
    const u = new URL(r.url.toString())
    u.searchParams.set(point.name, value)
    return { url: u.toString(), body: r.body }
  }
  const form = new URLSearchParams(r.body)
  form.set(point.name, value)
  return { url: r.url.toString(), body: form.toString() }
}

// ── safety choke point: EVERY send goes through here ──

function guardHost(r: ResolvedRequest, target: URL): { ok: true } | { ok: false; reason: string } {
  // v1 scope guard: only ever send to the SAME host as the resolved (already-crawled,
  // in-scope) request. The tool cannot be pointed at an arbitrary/out-of-scope host.
  if (target.host !== r.url.host) return { ok: false, reason: `out-of-scope host ${target.host}` }
  return { ok: true }
}

async function send(
  r: ResolvedRequest,
  target: { url: string; body: string },
  abort: AbortSignal,
): Promise<{ status: number; text: string; ms: number } | { error: string }> {
  const u = new URL(target.url)
  const guard = guardHost(r, u)
  if (!guard.ok) return { error: guard.reason }
  const sendHeaders: Record<string, string> = { ...r.headers }
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
    return { status: resp.status, text, ms: Math.round(performance.now() - t0) }
  } catch (e: any) {
    return { error: String(e?.message ?? e) }
  }
}

// ── XSS observation: facts about bytes only ──

function looksBlocked(status: number): boolean {
  return status === 403 || status === 406 || status === 429
}

interface PointObservation {
  point: string
  marker_reflected: boolean
  marker_html_encoded: boolean | null
  surviving_tags: string[] // tags that reflected RAW (un-stripped, un-encoded) — a fact, not a verdict
  blocked: boolean
  note?: string
}

async function probeXssPoint(
  r: ResolvedRequest,
  point: InjPoint,
  abort: AbortSignal,
  delayMs: number,
): Promise<PointObservation> {
  const obs: PointObservation = {
    point: `${point.location}:${point.name}`,
    marker_reflected: false,
    marker_html_encoded: null,
    surviving_tags: [],
    blocked: false,
  }
  const sleep = (ms: number) => (ms ? new Promise((res) => setTimeout(res, ms)) : Promise.resolve())
  const n = nonce()
  // 1) benign marker — is this param reflected at all, and encoded?
  const m = await send(r, withPayload(r, point, n), abort)
  if ("error" in m) {
    obs.note = `send failed: ${m.error}`
    return obs
  }
  if (looksBlocked(m.status)) {
    obs.blocked = true
    obs.note = `baseline marker got HTTP ${m.status} — WAF/rate-limit, NOT evidence of safety`
    return obs
  }
  obs.marker_reflected = m.text.includes(n)
  if (!obs.marker_reflected) return obs // not reflected here — nothing to enumerate

  // 2) tag battery — which tags survive a filter (reflect RAW), one send per tag
  for (const tag of XSS_TAGS) {
    if (abort.aborted) break
    const tn = nonce()
    const res = await send(r, withPayload(r, point, `<${tag} data-p=${tn}>`), abort)
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
    vuln_type: z.enum(["xss"]).describe("Injection class to probe. v1: xss only."),
    target_param: z
      .string()
      .optional()
      .describe("Optional: probe only this parameter. Omit to fan out over all query/form params."),
  }),
  async execute(params, ctx) {
    if (params.vuln_type !== "xss") {
      return { title: "inject_probe", output: "v1 supports vuln_type 'xss' only.", metadata: {} }
    }
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
    const points = enumeratePoints(resolved, params.target_param)
    if (points.length === 0) {
      return {
        title: "inject_probe",
        output: JSON.stringify(
          {
            note: "No query or form-urlencoded parameters found to probe. This tool did NOT test any other injection point.",
            target: { method: resolved.method, url: resolved.url.toString(), auth: resolved.auth },
            coverage: { not_tested: V1_NOT_TESTED },
          },
          null,
          2,
        ),
        metadata: {},
      }
    }

    const observations: PointObservation[] = []
    for (const point of points) {
      if (ctx.abort.aborted) break
      observations.push(await probeXssPoint(resolved, point, ctx.abort, 120))
    }

    const evidence = {
      note:
        "OBSERVATIONS ONLY — this tool did not confirm any vulnerability and did not run JavaScript. Each 'surviving_tags' entry is a fact (that tag reflected un-encoded), NOT proof of XSS. To confirm: send a weaponized payload in a surviving tag (e.g. an event handler firing alert('XSS')) and judge the result yourself.",
      target: {
        method: resolved.method,
        url: resolved.url.toString(),
        auth: resolved.auth,
        provenance: resolved.provenance,
      },
      probed: `xss over ${points.length} param(s)`,
      observations,
      verification_required: true,
      to_confirm: observations
        .filter((o) => o.surviving_tags.length > 0)
        .map(
          (o) =>
            `${o.point}: tag(s) [${o.surviving_tags.join(", ")}] reflected un-encoded — weaponize one and confirm execution.`,
        ),
      coverage: {
        tested: ["xss: reflected tag-survival on query/form params"],
        not_tested: V1_NOT_TESTED,
      },
      aborted: ctx.abort.aborted || undefined,
    }

    const anyReflected = observations.some((o) => o.marker_reflected)
    const anySurviving = observations.some((o) => o.surviving_tags.length > 0)
    const title = anySurviving
      ? `inject_probe xss: surviving tags found (verify)`
      : anyReflected
        ? `inject_probe xss: reflected, no raw tag survived`
        : `inject_probe xss: no reflection observed`
    return { title, output: JSON.stringify(evidence, null, 2), metadata: {} }
  },
})
