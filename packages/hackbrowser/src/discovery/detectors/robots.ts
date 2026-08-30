import { register } from "../registry.ts"
import { toScopedPages } from "../url.ts"
import { EMPTY_RESULT, type Detector, type DiscoveryContext, type DiscoveryResult } from "../detector.ts"

/**
 * Seed the crawl from robots.txt Allow/Disallow directives. Disallowed paths are
 * often the most interesting for a pentest — admin/private areas the site tries
 * to hide from crawlers — so both Allow and Disallow are harvested. Wildcard
 * (`*` / `$`) and bare-root rules are skipped; only concrete paths are emitted,
 * resolved/scoped by toScopedPages.
 */
const robots: Detector = {
  name: "robots",
  kind: "spec",
  async applies(): Promise<boolean> {
    return true
  },
  async detect(ctx: DiscoveryContext): Promise<DiscoveryResult> {
    const origin = new URL(ctx.baseUrl).origin
    const txt = await ctx.fetchText(origin + "/robots.txt")
    if (!txt) return EMPTY_RESULT

    const raw = new Set<string>()
    for (const line of txt.split(/\r?\n/)) {
      const match = /^\s*(?:allow|disallow)\s*:\s*(\S+)/i.exec(line)
      const path = match?.[1]
      if (!path || path === "/" || path.includes("*") || path.includes("$")) continue
      raw.add(path) // relative to origin; toScopedPages resolves against baseUrl
    }

    if (raw.size === 0) return EMPTY_RESULT
    const pages = toScopedPages(raw, ctx.baseUrl, ctx.inScope)
    return { pages, endpoints: [], confidence: pages.length > 0 ? 1 : 0 }
  },
}

register(robots)
export { robots }
