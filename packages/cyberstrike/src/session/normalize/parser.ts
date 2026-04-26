// Tier 0 — deterministic parser.
//
// Takes a raw HTTP request text plus the ingest caller's scheme hint and
// returns a ParsedRequest. Pure function, no LLM, no network, no cache —
// downstream tiers can trust its output.

import { createHash } from "crypto"
import type { Method, ParsedRequest } from "./types"

const DEFAULT_PORT_FOR: Record<"http" | "https", number> = { http: 80, https: 443 }

export interface ParseInput {
  raw: string                             // full raw HTTP request text
  scheme: "http" | "https"                // ingest caller-supplied; hackbrowser knows this
}

export function parseRawRequest({ raw, scheme }: ParseInput): ParsedRequest {
  const lines = raw.split(/\r?\n/)
  const requestLine = lines[0]?.trim() ?? ""

  const requestLineMatch = requestLine.match(/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(\S+)\s+HTTP/i)
  if (!requestLineMatch) {
    throw new Error(`malformed request line: ${requestLine.slice(0, 80)}`)
  }
  const method = requestLineMatch[1]!.toUpperCase() as Method
  const target = requestLineMatch[2]!

  const targetUrl = resolveTargetUrl(target, scheme, lines)

  const { canonicalPath, segments: pathSegments } = canonicalizePath(targetUrl.pathname)

  const host = targetUrl.hostname.toLowerCase()
  const port = targetUrl.port ? parseInt(targetUrl.port, 10) : DEFAULT_PORT_FOR[scheme]
  const origin = `${scheme}://${host}:${port}`
  const site = deriveSite(host)

  const { normalizedQuery, queryKeyHash } = canonicalizeQuery(targetUrl.search)

  const bodyContentType = findHeaderValue(lines, "content-type")?.split(";")[0]?.trim().toLowerCase()
  const body = extractBody(lines)
  const bodyHash = body ? hashBody(body, bodyContentType) : undefined

  return {
    method,
    scheme,
    host,
    port,
    origin,
    site,
    rawPath: targetUrl.pathname,
    canonicalPath,
    pathSegments,
    query: normalizedQuery,
    queryKeyHash,
    bodyContentType,
    bodyHash,
  }
}

function resolveTargetUrl(target: string, scheme: "http" | "https", lines: string[]): URL {
  if (target.startsWith("http://") || target.startsWith("https://")) {
    return new URL(target)
  }
  const hostHeader = findHeaderValue(lines, "host")
  if (!hostHeader) {
    return new URL(target, `${scheme}://unknown.local`)
  }
  return new URL(target, `${scheme}://${hostHeader.trim()}`)
}

// Splits on `/` BEFORE decoding so %2F inside a segment can't spawn a new
// segment. %2F is preserved (not decoded to `/`); other percent-encodings
// (%20, %40, ...) are decoded so regex classification works on a clean form.
function canonicalizePath(path: string): { canonicalPath: string; segments: string[] } {
  const rawSegments = path.split("/")
  const decoded = rawSegments.map((seg) => safeDecodePreservingSlash(seg).toLowerCase())

  // Strip a single trailing empty segment (from trailing slash); keep the
  // leading empty segment that represents the root.
  if (decoded.length > 1 && decoded[decoded.length - 1] === "") decoded.pop()

  const joined = decoded.join("/")
  return {
    canonicalPath: joined === "" ? "/" : joined,
    segments: decoded,
  }
}

// Decode percent-encoding in a segment while keeping %2F encoded. We replace
// %2F with a sentinel from the Unicode Private Use Area (unlikely in real
// paths), decode the rest, and restore the sentinel — preventing `/` from
// retroactively breaking the segment boundary.
function safeDecodePreservingSlash(seg: string): string {
  // Unicode Private Use Area code point unlikely to appear in real paths.
  const SLASH_SENTINEL = ""
  try {
    const shielded = seg.replace(/%2[Ff]/g, SLASH_SENTINEL)
    const decoded = decodeURIComponent(shielded)
    return decoded.replace(new RegExp(SLASH_SENTINEL, "g"), "%2F")
  } catch {
    return seg
  }
}

function canonicalizeQuery(search: string): { normalizedQuery: string | undefined; queryKeyHash: string | undefined } {
  if (!search || search === "?") return { normalizedQuery: undefined, queryKeyHash: undefined }
  const params = new URLSearchParams(search)
  const entries = [...params.entries()].sort(([a], [b]) => a.localeCompare(b))
  if (entries.length === 0) return { normalizedQuery: undefined, queryKeyHash: undefined }
  const normalized = entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&")
  const keys = entries.map(([k]) => k).join(",")
  const hash = createHash("sha256").update(keys).digest("hex").slice(0, 16)
  return { normalizedQuery: normalized, queryKeyHash: hash }
}

function findHeaderValue(lines: string[], name: string): string | undefined {
  const lower = name.toLowerCase()
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]
    if (!line) break
    const colon = line.indexOf(":")
    if (colon < 0) continue
    const key = line.slice(0, colon).trim().toLowerCase()
    if (key === lower) return line.slice(colon + 1).trim()
  }
  return undefined
}

function extractBody(lines: string[]): string | undefined {
  // Body starts after the first blank line.
  const blank = lines.findIndex((l, i) => i > 0 && l.trim() === "")
  if (blank < 0) return undefined
  const body = lines.slice(blank + 1).join("\n").trim()
  return body.length > 0 ? body : undefined
}

function hashBody(body: string, contentType: string | undefined): string {
  const normalized = contentType === "application/json" ? normalizeJson(body) : body
  return createHash("sha256").update(normalized).digest("hex").slice(0, 16)
}

function normalizeJson(body: string): string {
  try {
    return JSON.stringify(sortObjectKeys(JSON.parse(body)))
  } catch {
    return body
  }
}

function sortObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortObjectKeys)
  if (value && typeof value === "object") {
    const sorted: Record<string, unknown> = {}
    for (const k of Object.keys(value as object).sort()) {
      sorted[k] = sortObjectKeys((value as Record<string, unknown>)[k])
    }
    return sorted
  }
  return value
}

// Simplified eTLD+1. Production should depend on a Public Suffix List; for
// the prototype-derived port we cover single-label TLDs plus a handful of
// compound ones that show up in real targets. Behaviour is pinned by tests
// in deriveSite.test.ts so changes are deliberate.
const COMPOUND_TLDS: ReadonlySet<string> = new Set([
  "co.uk",
  "com.au",
  "co.jp",
  "com.br",
  "com.mx",
  "co.nz",
  "co.za",
  "co.kr",
  "com.tr",
])

export function deriveSite(host: string): string {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return host  // IPv4
  if (host.startsWith("[")) return host                   // IPv6
  const labels = host.split(".")
  if (labels.length < 2) return host
  if (labels.length >= 3) {
    const lastTwo = labels.slice(-2).join(".")
    if (COMPOUND_TLDS.has(lastTwo)) return labels.slice(-3).join(".")
  }
  return labels.slice(-2).join(".")
}
