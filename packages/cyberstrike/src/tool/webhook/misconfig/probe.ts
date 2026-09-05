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
