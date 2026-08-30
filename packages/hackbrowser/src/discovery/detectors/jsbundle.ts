import type { Page } from "playwright"
import { register } from "../registry.ts"
import { EMPTY_RESULT, type Detector, type DiscoveryContext, type DiscoveryResult, type Endpoint } from "../detector.ts"
import { mineEndpoints } from "../mine.ts"

// Bounds so a script-heavy SPA can't stall discovery or exhaust memory.
const MAX_SCRIPTS = 30
const MAX_BUNDLE_BYTES = 3_000_000

/** Same-origin `<script src>` URLs on the current page. */
async function scriptUrls(page: Page, origin: string): Promise<string[]> {
  return page.evaluate((org) => {
    const urls = new Set<string>()
    document.querySelectorAll("script[src]").forEach((el) => {
      const src = (el as HTMLScriptElement).src
      if (src && src.startsWith(org)) urls.add(src)
    })
    return [...urls]
  }, origin)
}

/**
 * Mine endpoints from the page's own JS bundles. Fetches each same-origin script
 * through the authenticated browser context (inherits auth + proxy), runs the
 * deterministic miner, and emits the union. Confidence is modest — mined strings
 * are candidates, not declared contracts — so the proxy-agents test them (Approach B).
 */
const jsbundle: Detector = {
  name: "jsbundle",
  kind: "api-call",
  async applies(): Promise<boolean> {
    return true
  },
  async detect(ctx: DiscoveryContext): Promise<DiscoveryResult> {
    const origin = new URL(ctx.baseUrl).origin
    let scripts: string[]
    try {
      scripts = await scriptUrls(ctx.page, origin)
    } catch {
      return EMPTY_RESULT
    }
    const endpoints = new Map<string, Endpoint>()
    for (const src of scripts.slice(0, MAX_SCRIPTS)) {
      const text = await ctx.fetchText(src)
      if (!text || text.length > MAX_BUNDLE_BYTES) continue
      for (const endpoint of mineEndpoints(text, origin, ctx.inScope)) {
        endpoints.set(`${endpoint.method} ${endpoint.url}`, endpoint)
      }
    }
    if (endpoints.size === 0) return EMPTY_RESULT
    return { pages: [], endpoints: [...endpoints.values()], confidence: 0.5 }
  },
}

register(jsbundle)
export { jsbundle }
