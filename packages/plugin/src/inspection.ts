// Inspection queue contract — the domain-agnostic vocabulary for dispatching
// specialist agents to testable surfaces. A domain plugin implements
// InspectionRouter to route its evidence to its agents; the host's
// InspectionDispatcher consumes the router without knowing domain specifics.
//
// Lives in the SDK (not the host) so a domain package can
// `import { InspectionRouter } from "@cyberstrike-io/plugin"` and the host
// references the same types. Self-contained (primitives only) — no host dependency.

/** A testable surface: an endpoint, a cloud resource, a mobile screen, etc. */
export interface InspectionTarget {
  /** Stable identity key (dedups). Web: key_hash. Cloud: resource ARN. */
  key: string
  /** Human label. Web: "GET /api/v1/users". Cloud: "S3 bucket prod-data". */
  label: string
  /** Domain-specific metadata the router needs to choose specialists. */
  meta: Record<string, unknown>
}

export type EvidencePriority = "high" | "medium" | "low"

/** One piece of evidence that a target should be inspected. */
export interface Evidence {
  type: string
  value: string
  priority: EvidencePriority
  /** When true, the evidence accumulates on the target but does NOT re-open an
   *  already-examined target. Web example: `object_value` — UUIDs churn constantly
   *  and the first IDOR pass already sweeps a representative set. */
  accumulateOnly?: boolean
}

/** Session-level context the domain passes when creating its router. */
export interface RouterContext {
  workflow?: string
  scope?: { include?: string[]; exclude?: string[] }
}

/** Domain-specific routing: evidence → which specialists test this target. */
export interface InspectionRouter {
  /** Given a target + its accumulated evidence, return the specialist agent names. */
  resolve(target: InspectionTarget, evidence: Evidence[]): string[] | Promise<string[]>
  /** Build the dispatch prompt for a specialist on this target. */
  prompt(target: InspectionTarget, evidence: Evidence[], agent: string): string
}

/** Something that produces work for the inspection queue. */
export interface ActivitySource {
  /** Short identifier: "crawler", "api-probe", "vortex-ingest", ... */
  name: string
  /** True while this source could still produce evidence (new targets or flags). */
  isActive(): boolean
}

export type SessionPhase =
  | "idle"
  | "discovering"
  | "inspecting"
  | "draining"
  | "complete"
