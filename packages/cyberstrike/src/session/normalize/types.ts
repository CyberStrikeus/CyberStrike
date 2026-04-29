// Domain types for the 4-tier path normalization pipeline.
//
// Tiers consume/produce these in order:
//   Tier 0 parser → ParsedRequest
//   Tier 1 regex  → Tier1Result
//   Tier 2 cache  → Tier2Result (matched template, if any)
//   Tier 3 LLM    → Tier3Result (per-segment classifications)
//   pipeline      → NormalizeResult (final + traces)
//
// All shapes are intentionally explicit so the trace logger can render every
// decision the system made for a request — when normalization gets it wrong,
// you can see exactly which tier was responsible.

export type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS"

export type Placeholder = "{id}" | "{uuid}" | "{hash}" | "{email}" | "{token}" | "{slug}"

export const ALLOWED_PLACEHOLDERS: ReadonlySet<Placeholder> = new Set([
  "{id}",
  "{uuid}",
  "{hash}",
  "{email}",
  "{token}",
  "{slug}",
])

// Tier 0 output — deterministic parse of the raw HTTP request.
export interface ParsedRequest {
  method: Method
  scheme: "http" | "https"
  host: string                            // lowercase, punycode where applicable
  port: number                            // explicit; default 80 for http, 443 for https
  origin: string                          // canonical: `${scheme}://${host}:${port}`
  site: string                            // eTLD+1, e.g. "example.com"
  rawPath: string                         // as-seen on the wire
  canonicalPath: string                   // lowercased, percent-decoded except %2F, no trailing slash
  pathSegments: string[]                  // split by "/", includes leading "" (path root)
  query: string | undefined               // canonicalized: keys sorted, values URL-encoded
  queryKeyHash: string | undefined        // sha256 hash of sorted query keys
  bodyContentType: string | undefined
  bodyHash: string | undefined            // sha256 hash of normalized body (json keys sorted)
}

// Per-segment Tier 1 classification.
export type SegmentClassification =
  | { kind: "static"; literal: string; reason: string }
  | { kind: "dynamic"; placeholder: Placeholder; reason: string }
  | { kind: "ambiguous"; literal: string; reason: string }

export interface Tier1Result {
  resolved: boolean                       // true only when no segment is ambiguous
  classifications: SegmentClassification[]
  normalizedPath: string                  // best-effort; placeholders resolved, ambiguous left literal
  durationMs: number
}

// One template per (session, origin, method, template_string) — cached shape
// recognized by Tier 2. Source records which tier created it; confidence
// drives any future cross-session reuse decisions.
export interface EndpointTemplate {
  id: string                              // ept_<26ch ascending>
  sessionID: string
  origin: string
  method: Method
  template: string                        // e.g. "/users/{id}/posts/{id}"
  segments: string[]                      // pre-split, includes leading ""
  segmentCount: number
  source: "tier1" | "tier3-llm"
  confidence: number                      // 1.0 for tier1, 0.8 for tier3-llm
  hitCount: number
  createdAt: number
  updatedAt: number
}

export interface Tier2Result {
  matched: boolean
  template?: EndpointTemplate
  score?: number                          // literal=+2, placeholder=+1 per segment
  normalizedPath?: string
  candidateCount: number                  // templates scored before picking the best
  durationMs: number
}

// Tier 3 contract: the LLM returns per-segment classifications, never a path.
// The pipeline assembles the final path from Tier 1 decisions plus these.
export type ClassificationKind = "static" | "id" | "slug" | "uuid" | "hash" | "email" | "token"

export interface LLMSegmentDecision {
  segment_index: number                   // 0-based index into ParsedRequest.pathSegments
  classification: ClassificationKind
}

export type Tier3Source = "llm-success" | "llm-failed"

export interface Tier3Result {
  decisions: LLMSegmentDecision[]
  source: Tier3Source
  model: string
  promptTokens?: number
  completionTokens?: number
  rawResponse?: string
  error?: string
  durationMs: number
}

export type NormSource = "tier1" | "tier2" | "tier3" | "failed"

// Final pipeline output.
export interface NormalizeResult {
  parsed: ParsedRequest
  tier1: Tier1Result
  tier2?: Tier2Result                     // undefined when tier 1 fully resolves
  tier3?: Tier3Result                     // undefined when tier 1/2 succeed
  normalizedPath: string
  normSource: NormSource
  templateId: string | undefined          // undefined when tier 3 failed and no template was cached
  totalDurationMs: number
}
