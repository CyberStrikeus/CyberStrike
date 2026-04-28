// Tier 2 — template cache + matching.
//
// The store is abstracted behind a TemplateStore interface so the pipeline
// can swap implementations without touching scoring logic:
//   - InMemoryTemplateStore: reference impl for tests and offline runs.
//   - DBTemplateStore (PR-3): drizzle-backed, persisted to endpoint_template.
//
// Matching algorithm: for each candidate template in the same
// (sessionID, origin, method, segment_count) bucket, score it against the
// incoming path. Literal+2, placeholder+1; null on incompatibility. The
// highest score wins, so /users/me literal beats /users/{id} placeholder.

import { Identifier } from "../../id/id"
import type {
  EndpointTemplate,
  Method,
  ParsedRequest,
  SegmentClassification,
  Tier1Result,
  Tier2Result,
} from "./types"

// ---------- Store contract ----------

export interface TemplateUpsertInput {
  sessionID: string
  origin: string
  method: Method
  template: string
  segmentCount: number
  source: EndpointTemplate["source"]
  confidence: number
}

export interface TemplateStore {
  /** Templates that share the same (sessionID, origin, method, segmentCount) bucket. */
  find(sessionID: string, origin: string, method: Method, segmentCount: number): EndpointTemplate[]

  /**
   * Insert a new template, or return the existing one with hit_count++ if a
   * (sessionID, origin, method, template) row already exists.
   */
  upsert(input: TemplateUpsertInput): EndpointTemplate

  /** Increment the hit counter on an existing template. No-op if id unknown. */
  incrementHit(id: string): void
}

// ---------- Reference (in-memory) implementation ----------

function bucketKey(sessionID: string, origin: string, method: string, segCount: number): string {
  return `${sessionID}|${origin}|${method}|${segCount}`
}

export class InMemoryTemplateStore implements TemplateStore {
  private readonly buckets = new Map<string, EndpointTemplate[]>()

  find(sessionID: string, origin: string, method: Method, segmentCount: number): EndpointTemplate[] {
    return this.buckets.get(bucketKey(sessionID, origin, method, segmentCount)) ?? []
  }

  upsert(input: TemplateUpsertInput): EndpointTemplate {
    const candidates = this.find(input.sessionID, input.origin, input.method, input.segmentCount)
    const existing = candidates.find((t) => t.template === input.template)
    if (existing) {
      existing.hitCount++
      existing.updatedAt = Date.now()
      return existing
    }

    const now = Date.now()
    const template: EndpointTemplate = {
      id: Identifier.ascending("endpoint_template"),
      sessionID: input.sessionID,
      origin: input.origin,
      method: input.method,
      template: input.template,
      segments: input.template.split("/"),
      segmentCount: input.segmentCount,
      source: input.source,
      confidence: input.confidence,
      hitCount: 1,
      createdAt: now,
      updatedAt: now,
    }
    const key = bucketKey(input.sessionID, input.origin, input.method, input.segmentCount)
    const list = this.buckets.get(key) ?? []
    list.push(template)
    this.buckets.set(key, list)
    return template
  }

  incrementHit(id: string): void {
    for (const list of this.buckets.values()) {
      const tmpl = list.find((t) => t.id === id)
      if (tmpl) {
        tmpl.hitCount++
        tmpl.updatedAt = Date.now()
        return
      }
    }
  }

  // Helpers for tests/inspection — not part of the TemplateStore contract.
  size(): number {
    let total = 0
    for (const list of this.buckets.values()) total += list.length
    return total
  }
  all(): EndpointTemplate[] {
    const out: EndpointTemplate[] = []
    for (const list of this.buckets.values()) out.push(...list)
    return out
  }
}

// ---------- Pure matching (store-independent) ----------

export function runTier2(
  store: TemplateStore,
  sessionID: string,
  parsed: ParsedRequest,
  tier1: Tier1Result,
): Tier2Result {
  const start = performance.now()
  const candidates = store.find(sessionID, parsed.origin, parsed.method, parsed.pathSegments.length)

  let best: { tmpl: EndpointTemplate; score: number } | null = null
  for (const tmpl of candidates) {
    const score = scoreTemplate(tmpl.segments, parsed.pathSegments, tier1.classifications)
    if (score === null) continue
    if (!best || score > best.score) best = { tmpl, score }
  }

  if (!best) {
    return { matched: false, candidateCount: candidates.length, durationMs: performance.now() - start }
  }

  store.incrementHit(best.tmpl.id)
  return {
    matched: true,
    template: best.tmpl,
    score: best.score,
    normalizedPath: best.tmpl.template,
    candidateCount: candidates.length,
    durationMs: performance.now() - start,
  }
}

// Returns the match score or null if the template is incompatible with the
// path. Literal slot (+2) requires exact equality. Placeholder slot (+1)
// rejects segments classified as "static" — a known-static segment must not
// silently fill a placeholder (prevents `/users/me` collapsing into
// `/users/{id}` when both templates exist).
export function scoreTemplate(
  templateSegs: string[],
  pathSegs: string[],
  classifications: SegmentClassification[],
): number | null {
  if (templateSegs.length !== pathSegs.length) return null
  let score = 0
  for (let i = 0; i < templateSegs.length; i++) {
    const tseg = templateSegs[i]!
    const pseg = pathSegs[i]!
    const cls = classifications[i]!

    if (isPlaceholder(tseg)) {
      // Don't let a known-static (non-empty) segment fill a placeholder slot.
      if (cls.kind === "static" && pseg !== "") return null
      score += 1
    } else {
      if (tseg !== pseg) return null
      score += 2
    }
  }
  return score
}

function isPlaceholder(seg: string): boolean {
  return seg.startsWith("{") && seg.endsWith("}") && seg.length > 2
}
