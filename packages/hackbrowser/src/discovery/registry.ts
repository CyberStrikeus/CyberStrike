import { Log } from "../log.ts"
import type { Detector, DiscoveryContext, DiscoveryResult, Endpoint } from "./detector.ts"

const log = Log.create({ service: "hackbrowser:discovery" })

const registry: Detector[] = []

/** Register a detector. Each detector module calls this at import time. */
export function register(detector: Detector): void {
  registry.push(detector)
}

/** Registered detectors (read-only) — for introspection and tests. */
export function detectors(): readonly Detector[] {
  return registry
}

/**
 * Run every applicable detector and aggregate results. A detector that throws
 * is logged and skipped — one bad detector must never abort discovery (same
 * resilience principle as the worker crash guard). Pages and endpoints are
 * de-duplicated across detectors; confidence is the max reported.
 */
export async function runDetectors(ctx: DiscoveryContext): Promise<DiscoveryResult> {
  const pages = new Set<string>()
  const endpoints = new Map<string, Endpoint>() // key: "METHOD url"
  let confidence = 0

  for (const detector of registry) {
    try {
      if (!(await detector.applies(ctx))) continue
      const result = await detector.detect(ctx)
      for (const page of result.pages) pages.add(page)
      for (const endpoint of result.endpoints) endpoints.set(`${endpoint.method} ${endpoint.url}`, endpoint)
      confidence = Math.max(confidence, result.confidence)
      log.debug("detector ran", {
        detector: detector.name,
        pages: result.pages.length,
        endpoints: result.endpoints.length,
      })
    } catch (err) {
      log.warn("detector failed (skipped)", { detector: detector.name, err: String(err) })
    }
  }

  return { pages: [...pages], endpoints: [...endpoints.values()], confidence }
}
