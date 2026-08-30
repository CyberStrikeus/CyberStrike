import type { Page } from "playwright"
import type { ScopeMatcher } from "../scope.ts"
import { makeFetchText } from "./fetch.ts"
import { runDetectors } from "./registry.ts"
import type { DiscoveryResult } from "./detector.ts"

// Side-effect imports: each detector module calls register() at load time.
// Adding a detector = add its module here (and under ./detectors/).
import "./detectors/sitemap.ts"
import "./detectors/robots.ts"
import "./detectors/openapi.ts"
import "./detectors/graphql.ts"
import "./detectors/jsbundle.ts"

export type { Detector, DiscoveryContext, DiscoveryResult, Endpoint } from "./detector.ts"
export { detectors } from "./registry.ts"
export { emitEndpoints } from "./emit.ts"
export { attachBundleMiner } from "./bundle-watch.ts"

/**
 * Run all applicable detectors for the current page. Builds the DiscoveryContext
 * (with a browser-context fetcher that inherits auth + proxy) and returns the
 * aggregated, deduped pages + endpoints. Deterministic — no LLM involved.
 */
export async function runDiscovery(page: Page, baseUrl: string, inScope: ScopeMatcher): Promise<DiscoveryResult> {
  return runDetectors({
    page,
    baseUrl,
    inScope,
    fetchText: makeFetchText(page),
  })
}
