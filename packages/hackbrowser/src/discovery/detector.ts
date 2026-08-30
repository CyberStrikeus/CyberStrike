import type { Page } from "playwright"
import type { ScopeMatcher } from "../scope.ts"

/**
 * Discovery Engine — detector contract (epic #125, phase 1 #126).
 *
 * A Detector deterministically finds routes/pages and/or API endpoints from a
 * source (DOM, network, JS bundle) WITHOUT relying on the LLM. Detectors are
 * pluggable via the registry; new frameworks/specs are added as new modules,
 * never by changing the core. Because discovery is deterministic, the crawl
 * stays model-agnostic — swapping the LLM never changes *what* is discovered,
 * only how findings are later tested.
 */

/** An API endpoint to test (fed to ingest -> proxy-agents), with provenance. */
export interface Endpoint {
  method: string // "GET" | "POST" | ... (upper-case)
  url: string // absolute, in-scope
  source: string // detector name, for provenance
}

/** Everything a detector needs — the authenticated, proxy-aware browser context. */
export interface DiscoveryContext {
  /** Live page; its context carries the logged-in session + corporate-proxy trust. */
  page: Page
  /** Absolute base URL the crawl started from. */
  baseUrl: string
  /** Host-scope matcher — detectors must only emit in-scope results. */
  inScope: ScopeMatcher
  /**
   * Fetch text THROUGH the page context, so it inherits auth cookies + the
   * proxy/TLS config rather than using a bare HTTP client (which would 401 on
   * auth-gated specs and hit TLS walls behind a corporate SSL-inspection proxy).
   * Returns null on any non-OK / error, so a missing sitemap etc. is a no-op.
   */
  fetchText: (url: string) => Promise<string | null>
}

/** What a detector emits. Pages seed the crawl; endpoints go to ingest. */
export interface DiscoveryResult {
  pages: string[] // navigable URLs -> BFS crawl queue
  endpoints: Endpoint[] // API endpoints -> ingest
  confidence: number // 0..1 — lower for heuristic / minified-bundle extraction
}

export type DetectorKind = "nav" | "spec" | "js-route" | "api-call"

export interface Detector {
  name: string
  kind: DetectorKind
  /** Cheap relevance / framework check — detect() is skipped when this is false. */
  applies(ctx: DiscoveryContext): Promise<boolean>
  /** Deterministic extraction. */
  detect(ctx: DiscoveryContext): Promise<DiscoveryResult>
}

/** An empty result — convenience for detectors that find nothing. */
export const EMPTY_RESULT: DiscoveryResult = { pages: [], endpoints: [], confidence: 0 }
