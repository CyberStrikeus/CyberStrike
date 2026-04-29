// Tier 1 — regex fast-path.
//
// Classifies each path segment deterministically. Only patterns with zero
// false-positive risk are treated as dynamic. Anything the regex doesn't
// confidently recognize is marked "ambiguous" so tier 2/3 can decide.
//
// Design rule: prefer leaving a segment ambiguous over a wrong call. False
// positives poison the template cache; false negatives only cost one LLM hit.

import type { Placeholder, SegmentClassification, Tier1Result } from "./types"

// Order matters — UUID precedes hex hash because UUIDs would also satisfy
// hex by char class, but the UUID shape is more specific.
const DYNAMIC_PATTERNS: ReadonlyArray<readonly [RegExp, Placeholder, string]> = [
  [/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "{uuid}", "UUID format"],
  [/^\d+$/, "{id}", "pure numeric"],
  [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "{email}", "email literal"],
  [/^ey[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/, "{token}", "JWT shape"],
  // 12+ hex chars. Below that, words like "facade" or "decade" produce false
  // positives that poison the cache; git short-hashes (7 chars) instead fall
  // through to tier 3 for context-aware classification.
  [/^[0-9a-f]{12,}$/i, "{hash}", "hex hash >=12 chars"],
]

// Tight static patterns — anything unrecognized falls through to "ambiguous"
// so tier 2/3 can decide with context.
const STATIC_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/^[a-zA-Z]+$/, "pure alphabetic word"],
  [/^v\d+$/, "API version (v1, v2...)"],
  [
    /^[a-zA-Z][a-zA-Z0-9_-]*\.(php|asp|aspx|jsp|do|action|cgi|html|htm|json|xml|css|js|ts|txt|csv|pdf|png|jpg|svg|ico)$/i,
    "filename with extension",
  ],
]

export function runTier1(pathSegments: string[]): Tier1Result {
  const start = performance.now()
  const classifications = pathSegments.map(classifySegment)
  const resolved = classifications.every((c) => c.kind !== "ambiguous")
  const normalizedPath = toPath(classifications)

  return {
    resolved,
    classifications,
    normalizedPath,
    durationMs: performance.now() - start,
  }
}

function classifySegment(segment: string): SegmentClassification {
  // Leading "" from path split — not a real segment, but kept so segment
  // indices align with tier 2 template segments.
  if (segment === "") return { kind: "static", literal: "", reason: "path root" }

  for (const [pattern, placeholder, reason] of DYNAMIC_PATTERNS) {
    if (pattern.test(segment)) return { kind: "dynamic", placeholder, reason }
  }

  for (const [pattern, reason] of STATIC_PATTERNS) {
    if (pattern.test(segment)) return { kind: "static", literal: segment, reason }
  }

  return { kind: "ambiguous", literal: segment, reason: "no deterministic pattern matched" }
}

function toPath(classifications: SegmentClassification[]): string {
  return classifications.map((c) => (c.kind === "dynamic" ? c.placeholder : c.literal)).join("/")
}
