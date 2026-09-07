import { Request } from "../../session/request"
import { WebCredential } from "../../session/web/web-credential"
import type { ResolvedRequest, InjPoint, Location } from "./types"
import { multipartBoundary, multipartFieldNames } from "./multipart"

export function parseRaw(raw: string): { requestLine: string; headers: Record<string, string>; body: string } {
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

export function resolve(request: Request.Info): ResolvedRequest | { error: string } {
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
  if (!pathAndQuery) pathAndQuery = request.canonical_path ?? request.normalized_path

  let url: URL
  try {
    url = new URL(pathAndQuery.startsWith("http") ? pathAndQuery : origin + pathAndQuery)
  } catch {
    return { error: `could not build a URL from ${origin} + ${pathAndQuery}` }
  }

  let authSource = "none"
  if (request.credential_id) {
    const cred = WebCredential.getById(request.credential_id)
    if (cred) {
      // Per-origin auth: only this identity's headers for the TARGET host (url.host).
      for (const [k, v] of Object.entries(WebCredential.authForHost(cred.authByHost, url.host)))
        headers[k.toLowerCase()] = v
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

export function resolveFromTarget(t: {
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

export function enumeratePoints(r: ResolvedRequest, only?: string): InjPoint[] {
  const points: InjPoint[] = []
  for (const [name] of r.url.searchParams) if (!only || only === name) points.push({ location: "query", name })
  if (r.contentType.includes("application/x-www-form-urlencoded")) {
    const form = new URLSearchParams(r.body)
    for (const [name] of form) if (!only || only === name) points.push({ location: "form_field", name })
  } else if (r.contentType.includes("multipart/form-data")) {
    const b = multipartBoundary(r)
    if (b)
      for (const name of multipartFieldNames(r.body, b))
        if (!only || only === name) points.push({ location: "form_field", name })
  }
  return points
}

export function validatePoints(pts: InjPoint[]): { points: InjPoint[]; rejected: { point: string; reason: string }[] } {
  const points: InjPoint[] = []
  const rejected: { point: string; reason: string }[] = []
  for (const p of pts) {
    if (p.location === "header" && FORBIDDEN_HEADERS.has(p.name.toLowerCase())) {
      rejected.push({
        point: `header:${p.name}`,
        reason: "routing/framing header — refused (no response-splitting/rerouting)",
      })
      continue
    }
    points.push(p)
  }
  return { points, rejected }
}
