// Tier 3 — structured-output LLM classifier.
//
// The LLM is asked to classify the ambiguous segments only. It does not see
// or write a normalized path. This is the contract that makes the system
// robust: a misbehaving LLM cannot corrupt segments it was never asked
// about. The orchestrator (pipeline.ts) assembles the final path from Tier 1
// decisions plus the LLM's classifications.

import { streamText, tool } from "ai"
import z from "zod"
import { Provider } from "../../provider/provider"
import { ProviderTransform } from "../../provider/transform"
import type {
  ClassificationKind,
  LLMSegmentDecision,
  ParsedRequest,
  SegmentClassification,
  Tier1Result,
  Tier3Result,
} from "./types"
import { NORMALIZE_SYSTEM_PROMPT } from "./prompt"

const CLASSIFICATIONS = ["static", "id", "slug", "uuid", "hash", "email", "token"] as const

// Zod schema enforced by the AI SDK's generateObject. Server-side strict mode
// rejects malformed output, so by the time we read result.object it has the
// exact shape below.
const DecisionsSchema = z.object({
  decisions: z.array(
    z.object({
      segment_index: z.number().int().nonnegative(),
      classification: z.enum(CLASSIFICATIONS),
    }),
  ),
})

// ---------- Pipeline-facing contract ----------

export interface Tier3ClassifyInput {
  parsed: ParsedRequest
  tier1: Tier1Result
  ambiguousIndices: number[]
}

export interface Tier3ClassifyResponse {
  decisions: LLMSegmentDecision[]
  model: string
  promptTokens?: number
  completionTokens?: number
  rawResponse?: string
}

export interface Tier3Client {
  classify(input: Tier3ClassifyInput): Promise<Tier3ClassifyResponse>
}

// ---------- Pipeline glue ----------

export async function runTier3(parsed: ParsedRequest, tier1: Tier1Result, client: Tier3Client): Promise<Tier3Result> {
  const start = performance.now()
  const ambiguousIndices = ambiguousSegmentIndices(tier1)

  // Tier 3 must only be invoked when there is something to classify. Guard
  // the invariant so a misuse in the orchestrator surfaces as a clear error
  // rather than a malformed prompt.
  if (ambiguousIndices.length === 0) {
    return {
      decisions: [],
      source: "llm-failed",
      model: "",
      error: "no ambiguous segments to classify",
      durationMs: performance.now() - start,
    }
  }

  try {
    const response = await client.classify({ parsed, tier1, ambiguousIndices })
    return {
      decisions: response.decisions.filter((d) => d.segment_index >= 0 && d.segment_index < parsed.pathSegments.length),
      source: "llm-success",
      model: response.model,
      promptTokens: response.promptTokens,
      completionTokens: response.completionTokens,
      rawResponse: response.rawResponse,
      durationMs: performance.now() - start,
    }
  } catch (err) {
    return {
      decisions: [],
      source: "llm-failed",
      model: "",
      error: (err as Error).message,
      durationMs: performance.now() - start,
    }
  }
}

export function ambiguousSegmentIndices(tier1: Tier1Result): number[] {
  const indices: number[] = []
  tier1.classifications.forEach((c, i) => {
    if (c.kind === "ambiguous") indices.push(i)
  })
  return indices
}

// ---------- Production adapter — uses AI SDK's generateObject ----------

export interface ProviderClientOptions {
  providerID: string // e.g. "openai", "anthropic"
  modelID: string // fallback when small model unavailable
}

/**
 * Builds a Tier3Client backed by the provider's small-model preference (when
 * configured). Falls back to the requested modelID if the provider has none.
 * Uses generateObject with a Zod schema so structured output is enforced
 * regardless of the underlying provider.
 */
export async function createProviderClient(opts: ProviderClientOptions): Promise<Tier3Client> {
  const small = await Provider.getSmallModel(opts.providerID).catch(() => undefined)
  const model = small ?? (await Provider.getModel(opts.providerID, opts.modelID))
  const language = await Provider.getLanguage(model)

  return {
    async classify({ parsed, tier1, ambiguousIndices }) {
      const userMessage = buildUserMessage(parsed, tier1, ambiguousIndices)

      // Structured output via a FORCED tool call — not generateObject's json mode.
      // generateObject leans on `responseFormat`, which several providers silently
      // drop: the Anthropic OAuth subscription model ignores it and returns
      // free-form prose that cannot be parsed. A forced tool call is the mechanism
      // the rest of CyberStrike already uses for structured LLM output and works
      // uniformly across providers (Anthropic subscription/API-key, OpenAI).
      //
      // streamText (not generateText) is deliberate: Anthropic rejects
      // NON-streaming requests whose max_tokens ceiling is large ("Streaming is
      // required..."), while reasoning small-models (e.g. gpt-5-nano) spend output
      // budget on hidden reasoning BEFORE emitting the tool call — so the ceiling
      // must be generous (a small cap truncates them to finishReason=length with
      // no tool call). Streaming is what lets a generous ceiling coexist with
      // Anthropic. Mirrors the streamObject path in agent.ts.
      const result = streamText({
        model: language,
        temperature: 0,
        maxOutputTokens: ProviderTransform.maxOutputTokens(model),
        tools: {
          classify_segments: tool({
            description:
              "Report the classification of every ambiguous path segment. Call exactly once with all decisions.",
            inputSchema: DecisionsSchema,
          }),
        },
        // Exactly one tool is defined, so "required" (force *some* tool call) is
        // equivalent to forcing this tool by name — but "required" maps to the
        // most broadly supported provider primitive (Anthropic tool_choice=any,
        // OpenAI required, etc.), whereas forcing a tool by name is not honored by
        // every provider/proxy. It is also the mode the rest of CyberStrike uses.
        toolChoice: "required",
        messages: [
          { role: "system", content: NORMALIZE_SYSTEM_PROMPT },
          { role: "user", content: userMessage },
        ],
        onError: () => {},
      })
      // Drive the stream to completion; errors are otherwise swallowed by the
      // stream (same reason agent.ts iterates fullStream on its streamObject).
      for await (const part of result.fullStream) {
        if (part.type === "error") throw part.error
      }

      const toolCalls = await result.toolCalls
      const call = toolCalls.find((c) => c.toolName === "classify_segments")
      if (!call) throw new Error("classifier did not return a classify_segments tool call")
      const validated = DecisionsSchema.safeParse(call.input)
      if (!validated.success) throw new Error(`classifier returned malformed decisions: ${validated.error.message}`)
      const usage = await result.usage
      return {
        decisions: validated.data.decisions as LLMSegmentDecision[],
        model: model.id,
        promptTokens: usage?.inputTokens,
        completionTokens: usage?.outputTokens,
      }
    },
  }
}

// ---------- Prompt builder (used by both adapters) ----------

export function buildUserMessage(parsed: ParsedRequest, tier1: Tier1Result, ambiguousIndices: number[]): string {
  const resolvedLines = tier1.classifications
    .map((cls, i) => describeResolved(cls, parsed.pathSegments[i] ?? "", i))
    .filter((line): line is string => line !== null)

  const ambiguousLines = ambiguousIndices.map((i) => `  [${i}] "${parsed.pathSegments[i] ?? ""}"`)

  return [
    `Path: ${parsed.canonicalPath}`,
    "",
    "Already resolved by Tier 1 (do not override — these are locked):",
    ...resolvedLines,
    "",
    "Ambiguous segments (classify each):",
    ...ambiguousLines,
  ].join("\n")
}

function describeResolved(cls: SegmentClassification, segment: string, index: number): string | null {
  if (index === 0) return `  [0] ""  root`
  if (cls.kind === "ambiguous") return null
  if (cls.kind === "static") return `  [${index}] "${segment}"  static (${cls.reason})`
  return `  [${index}] "${segment}"  ${cls.placeholder} (${cls.reason})`
}

// Re-export for callers wanting to type-narrow against allowed kinds.
export type { ClassificationKind }
