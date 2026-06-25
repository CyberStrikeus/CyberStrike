// Public API for the URL path normalizer.
//
// Callers ingest a raw HTTP request, hand it to `Normalize.run`, and get
// back a deterministic identity (origin/canonical_path/normalized_path) plus
// trace metadata (which tier resolved it, which template caches it, etc.).
//
// `Normalize.run` is the only entry point most callers need. The lower-level
// modules (parser, tier1, tier2, tier3, pipeline) are exported as namespaces
// for testing and inspection.

import { createHash } from "crypto"
import { DBTemplateStore } from "../web/endpoint-template"
import { orchestrate, type OrchestrateInput } from "./pipeline"
import { createProviderClient, type Tier3Client } from "./tier3"
import { extractSlots } from "./slots"
import { redactSlots } from "./redact"
import type { Method, NormSource, ParamSlot } from "./types"

export type { ParsedRequest, NormalizeResult, EndpointTemplate, Method, NormSource } from "./types"

const REST_DISPATCH_PARAMS = ["type", "action", "kind", "op", "operation", "view", "mode", "method"]
// Promote a low-cardinality REST query discriminator value into the key.
function restDispatcher(query: string | undefined): string {
  if (!query) return ""
  const params = new URLSearchParams(query)
  for (const k of REST_DISPATCH_PARAMS) {
    const v = params.get(k)
    if (v) return `${k}:${v}`
  }
  return ""
}


export type { TemplateStore } from "./tier2"
export type { Tier3Client } from "./tier3"
export { runTier1 } from "./tier1"
export { parseRawRequest, deriveSite } from "./parser"
export { runTier2, scoreTemplate, InMemoryTemplateStore } from "./tier2"
export { assemble, orchestrate } from "./pipeline"

export namespace Normalize {
  export interface RunInput {
    sessionID: string
    raw: string // full raw HTTP request text
    scheme: "http" | "https" // ingest caller-supplied
    providerID: string // for the LLM Tier 3 fallback
    modelID: string // fallback model when no small-model
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
    protocol: string | undefined
    operation: string | undefined
    opKeyHash: string | undefined
    /**
     * Unified structural dedup identity (Faz 0). Materializes the implicit key the
     * ingest gate dedups on: method ∥ origin ∥ normalized_path ∥ (opKeyHash ??
     * bodyHash ?? "") ∥ queryKeyHash. Used as the atomic upsert conflict target.
     */
    keyHash: string
    /**
     * Faz 3: operation-level grouping anchor — sha16(method ∥ origin ∥
     * normalized_path ∥ operation). Coarser than keyHash: groups all SHAPES of one
     * operation (e.g. mass-assignment variants of PUT /profile) so access-control
     * aggregation can reason at the operation level.
     */
    opGroupHash: string
    /**
     * Faz 2: redacted concrete input values (path/query/body), the substrate for
     * observed-value accumulation. Sensitive/oversized values are blanked
     * (retained=false) but keep their slot. Not yet persisted (Faz 3 wires it).
     */
    observedParams: ParamSlot[]
    /** Faz 2: digest of the full value-set; the per-(keyHash) dedup unit in Faz 3. */
    valueHash: string | undefined
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
    const client =
      input.client ??
      (await createProviderClient({
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
    const p = result.parsed
    // Unified structural dedup identity. (method, origin, normalized_path) + a
    // KEY-SHAPE discriminator (opKeyHash for GraphQL/JSON-RPC; else the JSON body
    // key-shape so same-shape/different-values REST mutations collapse; else the
    // value-bearing bodyHash for non-JSON) + the query-key discriminator. Values
    // never enter the identity.
    const keyParts = [
      p.method,
      p.origin,
      result.normalizedPath,
      p.opKeyHash ?? p.bodyKeyHash ?? p.bodyHash ?? "",
      p.queryKeyHash ?? "",
    ]
    // REST polymorphic dispatch: a low-cardinality query param (type/action/kind)
    // selects the resource class, so its VALUE is structural — promote it into the
    // key so /search?type=user ≠ ?type=admin_audit (showstopper S2). Conditional so
    // non-dispatch REST keeps its plain key.
    const restDisc = restDispatcher(p.query)
    if (restDisc) keyParts.push(restDisc)
    const keyHash = createHash("sha256").update(keyParts.join(" ")).digest("hex").slice(0, 16)
    const opGroupHash = createHash("sha256")
      .update([p.method, p.origin, result.normalizedPath, p.operation ?? ""].join(" "))
      .digest("hex")
      .slice(0, 16)
    // Extract concrete value slots (path/query/body) and redact them. Raw facts —
    // no idLike/reference/owner classification (that's the agent's job).
    const { observedParams, valueHash } = redactSlots(
      extractSlots({
        normalizedPath: result.normalizedPath,
        canonicalPath: p.canonicalPath,
        query: p.query,
        body: p.body,
        contentType: p.bodyContentType,
        protocol: p.protocol,
      }),
    )
    return {
      method: p.method,
      canonicalPath: p.canonicalPath,
      normalizedPath: result.normalizedPath,
      origin: p.origin,
      host: p.host,
      port: p.port,
      scheme: p.scheme,
      site: p.site,
      queryKeyHash: p.queryKeyHash,
      bodyHash: p.bodyHash,
      protocol: p.protocol,
      operation: p.operation,
      opKeyHash: p.opKeyHash,
      keyHash,
      opGroupHash,
      observedParams,
      valueHash,
      templateId: result.templateId,
      normSource: result.normSource,
      durationMs: result.totalDurationMs,
    }
  }
}
