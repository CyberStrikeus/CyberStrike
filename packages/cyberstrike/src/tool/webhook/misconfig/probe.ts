// Misconfig active-probe orchestrator (plan §05 misconfig_test). Sends
// wordlist entries at the target origin via the shared HttpSender and
// classifies each response. Three probe modes:
//
//   paths   — GET backup/admin/sensitive paths, flag 200/403 (vs 404 baseline)
//   methods — send unusual HTTP methods (TRACE/PUT/DELETE/…), flag allowed
//   cors    — send Origin header variations, flag reflection + credentials
//
// The P0 signal fabric auto-classifies responses for directory listing,
// server banners, exposed artifacts, etc. This probe just generates the
// traffic that triggers those detectors.
import type { HttpSender, ProbeRequest, ProbeResponse } from "../transport"
import { Wordlists, type WordlistCategory, type WordlistEntry } from "./wordlists"

export interface PathProbeResult {
  path: string
  category: WordlistCategory
  note: string
  status: number | null
  bodyLength: number
  bodyPreview: string
  interesting: boolean
  error?: string
}

export interface PathProbeReport {
  origin: string
  baselineStatus: number | null
  results: PathProbeResult[]
  interesting: PathProbeResult[]
}

export interface MethodProbeResult {
  method: string
  status: number | null
  allowed: boolean
  bodyPreview: string
  error?: string
}

export interface MethodProbeReport {
  endpoint: string
  results: MethodProbeResult[]
  allowedMethods: string[]
}

export interface CorsProbeResult {
  origin: string
  acao: string | null
  acac: boolean
  reflected: boolean
  wildcard: boolean
  error?: string
}

export interface CorsProbeReport {
  endpoint: string
  results: CorsProbeResult[]
  vulnerable: CorsProbeResult[]
}

export interface HeaderIssue {
  header: string
  issue: "missing" | "weak" | "disclosure"
  detail: string
  severity: "low" | "medium" | "high"
}

export interface HeaderProbeReport {
  endpoint: string
  status: number | null
  present: Record<string, string> // the security-relevant headers actually seen (name→value)
  issues: HeaderIssue[]
}

const BODY_PREVIEW_LEN = 200
const NOT_FOUND_STATUSES = new Set([404, 410])

export class MisconfigProbe {
  constructor(private readonly sender: HttpSender) {}

  async paths(input: {
    origin: string
    categories?: WordlistCategory[]
    limit?: number
    basePath?: string
  }): Promise<PathProbeReport> {
    const origin = input.origin.replace(/\/+$/, "")
    const basePath = input.basePath ?? ""
    const cats = (input.categories ?? ["backup", "admin", "sensitive_file"]).filter(
      (c): c is WordlistCategory => c !== "http_method",
    )
    const entries = Wordlists.select({ categories: cats })

    // Baseline: request a clearly-nonexistent path to learn the 404 status.
    const baseline = await this.sender.send({ method: "GET", url: `${origin}/cs-nonexistent-${Date.now()}.html`, headers: {} })
    const baselineStatus = "error" in baseline ? null : baseline.status

    // Filter: backup suffixes need a basePath; skip them if none given.
    // Then apply the caller's limit AFTER filtering.
    let applicable = entries.filter((e) => {
      if (e.category === "backup" && !e.value.startsWith("/")) return !!basePath
      return true
    })
    if (input.limit && input.limit > 0) applicable = applicable.slice(0, input.limit)

    const results: PathProbeResult[] = []
    for (const entry of applicable) {
      const path = entry.category === "backup" && !entry.value.startsWith("/")
        ? `${basePath}${entry.value}`
        : entry.value
      const url = `${origin}${path}`
      const resp = await this.sender.send({ method: "GET", url, headers: {} })

      if ("error" in resp) {
        results.push({ path, category: entry.category, note: entry.note, status: null, bodyLength: 0, bodyPreview: "", interesting: false, error: resp.error })
        continue
      }

      const interesting = isInteresting(resp.status, baselineStatus)
      results.push({
        path,
        category: entry.category,
        note: entry.note,
        status: resp.status,
        bodyLength: resp.body.length,
        bodyPreview: resp.body.slice(0, BODY_PREVIEW_LEN),
        interesting,
      })
    }

    return {
      origin,
      baselineStatus,
      results,
      interesting: results.filter((r) => r.interesting),
    }
  }

  async methods(input: { request: ProbeRequest }): Promise<MethodProbeReport> {
    const methods = Wordlists.httpMethods()
    const results: MethodProbeResult[] = []

    for (const method of methods) {
      const resp = await this.sender.send({ ...input.request, method })

      if ("error" in resp) {
        results.push({ method, status: null, allowed: false, bodyPreview: "", error: resp.error })
        continue
      }

      const allowed = resp.status >= 200 && resp.status < 400 && resp.status !== 405
      results.push({
        method,
        status: resp.status,
        allowed,
        bodyPreview: resp.body.slice(0, BODY_PREVIEW_LEN),
      })
    }

    return {
      endpoint: input.request.url,
      results,
      allowedMethods: results.filter((r) => r.allowed).map((r) => r.method),
    }
  }

  async cors(input: { request: ProbeRequest; origins?: string[] }): Promise<CorsProbeReport> {
    const testOrigins = input.origins ?? buildCorsOrigins(input.request.url)
    const results: CorsProbeResult[] = []

    for (const origin of testOrigins) {
      const resp = await this.sender.send({
        ...input.request,
        headers: { ...input.request.headers, Origin: origin },
      })

      if ("error" in resp) {
        results.push({ origin, acao: null, acac: false, reflected: false, wildcard: false, error: resp.error })
        continue
      }

      const acao = resp.headers["Access-Control-Allow-Origin"] ?? resp.headers["access-control-allow-origin"] ?? null
      const acac = (resp.headers["Access-Control-Allow-Credentials"] ?? resp.headers["access-control-allow-credentials"])?.toLowerCase() === "true"
      const reflected = acao === origin
      const wildcard = acao === "*"

      results.push({ origin, acao, acac, reflected, wildcard })
    }

    return {
      endpoint: input.request.url,
      results,
      vulnerable: results.filter((r) => (r.reflected && r.acac) || (r.wildcard && r.acac)),
    }
  }

  // Actively evaluate the security-header posture of a response (WSTG-CONF-07 HSTS,
  // CLNT-09 clickjacking, plus MIME/referrer/permissions hardening and version-disclosure
  // headers). The passive signal fabric flags MissingSecurityHeaders opportunistically; this
  // makes it a deterministic, complete checklist the specialist can rely on.
  async headers(input: { request: ProbeRequest }): Promise<HeaderProbeReport> {
    const resp = await this.sender.send({ ...input.request, method: "GET" })
    if ("error" in resp) return { endpoint: input.request.url, status: null, present: {}, issues: [] }
    const h = lowerHeaders(resp.headers)
    const present: Record<string, string> = {}
    const issues: HeaderIssue[] = []
    const isHttps = input.request.url.toLowerCase().startsWith("https")
    const seen = (name: string) => {
      const v = h[name.toLowerCase()]
      if (v !== undefined) present[name] = v
      return v
    }

    // HSTS (only meaningful on HTTPS)
    const hsts = seen("Strict-Transport-Security")
    if (isHttps) {
      if (hsts === undefined) issues.push({ header: "Strict-Transport-Security", issue: "missing", detail: "no HSTS — HTTP downgrade / SSL-strip possible", severity: "medium" })
      else {
        const maxAge = Number(/max-age=(\d+)/i.exec(hsts)?.[1] ?? "0")
        if (maxAge < 31536000) issues.push({ header: "Strict-Transport-Security", issue: "weak", detail: `max-age ${maxAge} < 1 year`, severity: "low" })
        if (!/includeSubDomains/i.test(hsts)) issues.push({ header: "Strict-Transport-Security", issue: "weak", detail: "no includeSubDomains — a subdomain can bypass HSTS", severity: "low" })
      }
    }

    // Clickjacking: X-Frame-Options OR CSP frame-ancestors must be present
    const xfo = seen("X-Frame-Options")
    const csp = seen("Content-Security-Policy")
    if (!xfo && !(csp && /frame-ancestors/i.test(csp)))
      issues.push({ header: "X-Frame-Options", issue: "missing", detail: "no X-Frame-Options and no CSP frame-ancestors → clickjacking (CWE-1021)", severity: "medium" })
    if (!csp) issues.push({ header: "Content-Security-Policy", issue: "missing", detail: "no CSP — no defense-in-depth against XSS/injection", severity: "medium" })

    // MIME sniffing
    const nosniff = seen("X-Content-Type-Options")
    if (!nosniff || !/nosniff/i.test(nosniff))
      issues.push({ header: "X-Content-Type-Options", issue: "missing", detail: "no nosniff — MIME-sniffing content-type confusion", severity: "low" })

    // Referrer / Permissions hardening
    if (!seen("Referrer-Policy")) issues.push({ header: "Referrer-Policy", issue: "missing", detail: "no referrer policy — full URL may leak cross-origin", severity: "low" })
    if (!seen("Permissions-Policy")) issues.push({ header: "Permissions-Policy", issue: "missing", detail: "no permissions policy — browser features not restricted", severity: "low" })

    // Version / framework disclosure (WSTG-INFO-02 folded in): a Server/X-Powered-By carrying a
    // version, or any X-AspNet* header, discloses the stack (CWE-200).
    const server = seen("Server")
    if (server && /\d/.test(server)) issues.push({ header: "Server", issue: "disclosure", detail: `discloses software/version: ${server}`, severity: "low" })
    const xpb = seen("X-Powered-By")
    if (xpb) issues.push({ header: "X-Powered-By", issue: "disclosure", detail: `discloses framework: ${xpb}`, severity: "low" })
    const aspnet = seen("X-AspNet-Version") || seen("X-AspNetMvc-Version")
    if (aspnet) issues.push({ header: "X-AspNet-Version", issue: "disclosure", detail: `discloses .NET version: ${aspnet}`, severity: "low" })

    return { endpoint: input.request.url, status: resp.status, present, issues }
  }
}

// Case-insensitive header map so lookups don't depend on the transport's casing.
function lowerHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const k of Object.keys(headers)) out[k.toLowerCase()] = headers[k]
  return out
}

function isInteresting(status: number, baselineStatus: number | null): boolean {
  if (NOT_FOUND_STATUSES.has(status)) return false
  if (status === baselineStatus) return false
  if (status >= 200 && status < 300) return true
  if (status === 403) return true
  if (status >= 500) return true
  return false
}

function buildCorsOrigins(targetUrl: string): string[] {
  let host: string
  try {
    host = new URL(targetUrl).hostname
  } catch {
    return ["https://evil.com"]
  }
  return [
    "https://evil.com",
    `https://${host}.evil.com`,
    `https://evil.${host}`,
    "null",
    `https://${host}`,
  ]
}
