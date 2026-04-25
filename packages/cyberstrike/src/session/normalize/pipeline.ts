// Pipeline orchestrator.
//
// Wires Tier 0 → Tier 1 → Tier 2 → Tier 3 together. Bails out as soon as a
// deterministic answer is available. The assembly step is what makes the
// architecture robust: Tier 1 static/dynamic classifications are
// authoritative for any segment they cover, and the LLM's classifications
// only fill the ambiguous slots. A misbehaving LLM cannot corrupt segments
// it was never asked to touch.

import { parseRawRequest, type ParseInput } from "./parser"
import { runTier1 } from "./tier1"
import { runTier2, type TemplateStore, type TemplateUpsertInput } from "./tier2"
import { runTier3, type Tier3Client } from "./tier3"
import type {
  ClassificationKind,
  EndpointTemplate,
  LLMSegmentDecision,
  NormalizeResult,
  ParsedRequest,
  Placeholder,
  SegmentClassification,
  Tier1Result,
} from "./types"

export interface OrchestrateInput extends ParseInput {
  sessionID: string
  store: TemplateStore
  client: Tier3Client
}

export async function orchestrate(input: OrchestrateInput): Promise<NormalizeResult> {
  const total = performance.now()

  const parsed = parseRawRequest({ raw: input.raw, scheme: input.scheme })
  const tier1 = runTier1(parsed.pathSegments)

  // Fast-path: Tier 1 alone resolved every segment.
  if (tier1.resolved) {
    const tmpl = upsert(input.store, input.sessionID, parsed, tier1.normalizedPath, "tier1", 1.0)
    return {
      parsed,
      tier1,
      normalizedPath: tier1.normalizedPath,
      normSource: "tier1",
      templateId: tmpl.id,
      totalDurationMs: performance.now() - total,
    }
  }

  // Tier 2: per-origin template cache.
  const tier2 = runTier2(input.store, input.sessionID, parsed, tier1)
  if (tier2.matched && tier2.template && tier2.normalizedPath) {
    return {
      parsed,
      tier1,
      tier2,
      normalizedPath: tier2.normalizedPath,
      normSource: "tier2",
      templateId: tier2.template.id,
      totalDurationMs: performance.now() - total,
    }
  }

  // Tier 3: LLM classifier — returns per-segment decisions, not a path.
  const tier3 = await runTier3(parsed, tier1, input.client)

  if (tier3.source === "llm-success") {
    const assembledPath = assemble(parsed, tier1, tier3.decisions)
    const tmpl = upsert(input.store, input.sessionID, parsed, assembledPath, "tier3-llm", 0.8)
    return {
      parsed,
      tier1,
      tier2,
      tier3,
      normalizedPath: assembledPath,
      normSource: "tier3",
      templateId: tmpl.id,
      totalDurationMs: performance.now() - total,
    }
  }

  // LLM failed — return Tier 1's best-effort path but DO NOT cache. A failed
  // classification must not persist as a low-confidence template that blocks
  // future retries or pollutes the matcher with literal ambiguous segments.
  return {
    parsed,
    tier1,
    tier2,
    tier3,
    normalizedPath: tier1.normalizedPath,
    normSource: "failed",
    templateId: undefined,
    totalDurationMs: performance.now() - total,
  }
}

// Deterministic path assembly. Tier 1 is authoritative for the segments it
// covers, LLM decisions only for ambiguous slots. Any LLM output that names
// a non-ambiguous segment is ignored — defense in depth on top of the prompt
// contract. Ambiguous segments without an LLM decision fall back to literal.
export function assemble(
  parsed: ParsedRequest,
  tier1: Tier1Result,
  llmDecisions: LLMSegmentDecision[],
): string {
  const decisionByIndex = new Map<number, ClassificationKind>()
  for (const d of llmDecisions) decisionByIndex.set(d.segment_index, d.classification)

  const pieces = tier1.classifications.map((cls, i) =>
    resolveSegment(cls, parsed.pathSegments[i] ?? "", decisionByIndex.get(i)),
  )
  return pieces.join("/")
}

function resolveSegment(
  cls: SegmentClassification,
  literal: string,
  llmDecision: ClassificationKind | undefined,
): string {
  if (cls.kind === "dynamic") return cls.placeholder
  if (cls.kind === "static") return cls.literal
  // Ambiguous: LLM decides, or fall back to literal.
  if (!llmDecision) return literal
  if (llmDecision === "static") return literal
  return toPlaceholder(llmDecision)
}

function toPlaceholder(kind: ClassificationKind): Placeholder {
  switch (kind) {
    case "id":
      return "{id}"
    case "slug":
      return "{slug}"
    case "uuid":
      return "{uuid}"
    case "hash":
      return "{hash}"
    case "email":
      return "{email}"
    case "token":
      return "{token}"
    case "static":
      // Unreachable — resolveSegment handles "static" before calling.
      throw new Error("toPlaceholder called with 'static'")
  }
}

function upsert(
  store: TemplateStore,
  sessionID: string,
  parsed: ParsedRequest,
  templatePath: string,
  source: TemplateUpsertInput["source"],
  confidence: number,
): EndpointTemplate {
  return store.upsert({
    sessionID,
    origin: parsed.origin,
    method: parsed.method,
    template: templatePath,
    segmentCount: parsed.pathSegments.length,
    source,
    confidence,
  })
}
