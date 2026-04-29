// Public API for the URL path normalizer.
//
// Callers ingest a raw HTTP request, hand it to `Normalize.run`, and get
// back a deterministic identity (origin/canonical_path/normalized_path) plus
// trace metadata (which tier resolved it, which template caches it, etc.).
//
// `Normalize.run` is the only entry point most callers need. The lower-level
// modules (parser, tier1, tier2, tier3, pipeline) are exported as namespaces
// for testing and inspection.

import { DBTemplateStore } from "../web/endpoint-template"
import { orchestrate, type OrchestrateInput } from "./pipeline"
import { createProviderClient, type Tier3Client } from "./tier3"
import type { Method, NormSource } from "./types"

export type { ParsedRequest, NormalizeResult, EndpointTemplate, Method, NormSource } from "./types"
export type { TemplateStore } from "./tier2"
export type { Tier3Client } from "./tier3"
export { runTier1 } from "./tier1"
export { parseRawRequest, deriveSite } from "./parser"
export { runTier2, scoreTemplate, InMemoryTemplateStore } from "./tier2"
export { assemble, orchestrate } from "./pipeline"

export namespace Normalize {
  export interface RunInput {
    sessionID: string
    raw: string                                       // full raw HTTP request text
    scheme: "http" | "https"                          // ingest caller-supplied
    providerID: string                                // for the LLM Tier 3 fallback
    modelID: string                                   // fallback model when no small-model
    /** Optional injected Tier 3 client — primarily for tests. */
    client?: Tier3Client
  }

  export interface RunResult {
    method: Method
    canonicalPath: string
    normalizedPath: string
    origin: string
    host: string
    port: number
    scheme: "http" | "https"
    site: string
    queryKeyHash: string | undefined
    bodyHash: string | undefined
    templateId: string | undefined
    normSource: NormSource
    durationMs: number
  }

  /**
   * Normalizes a raw HTTP request into a stable endpoint identity. Routes
   * Tier 3 to the configured provider's small model unless an explicit
   * client is supplied. The DB-backed template store is used in production;
   * tests can call orchestrate() directly with InMemoryTemplateStore.
   */
  export async function run(input: RunInput): Promise<RunResult> {
    const client = input.client ?? (await createProviderClient({
      providerID: input.providerID,
      modelID: input.modelID,
    }))

    const orchestrateInput: OrchestrateInput = {
      raw: input.raw,
      scheme: input.scheme,
      sessionID: input.sessionID,
      store: new DBTemplateStore(),
      client,
    }

    const result = await orchestrate(orchestrateInput)
    return {
      method: result.parsed.method,
      canonicalPath: result.parsed.canonicalPath,
      normalizedPath: result.normalizedPath,
      origin: result.parsed.origin,
      host: result.parsed.host,
      port: result.parsed.port,
      scheme: result.parsed.scheme,
      site: result.parsed.site,
      queryKeyHash: result.parsed.queryKeyHash,
      bodyHash: result.parsed.bodyHash,
      templateId: result.templateId,
      normSource: result.normSource,
      durationMs: result.totalDurationMs,
    }
  }
}
