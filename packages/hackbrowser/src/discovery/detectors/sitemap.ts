import { register } from "../registry.ts"
import { toScopedPages } from "../url.ts"
import { EMPTY_RESULT, type Detector, type DiscoveryContext, type DiscoveryResult } from "../detector.ts"

const CANDIDATES = ["/sitemap.xml", "/sitemap_index.xml"]
const MAX_NESTED = 20 // bound nested sitemap fetches so a huge index can't stall discovery

/** Pull `<loc>…</loc>` values out of sitemap XML without a full XML parser dependency. */
function extractLocs(xml: string): string[] {
  const locs: string[] = []
  const re = /<loc>\s*([^<\s]+)\s*<\/loc>/gi
  let match: RegExpExecArray | null
  while ((match = re.exec(xml)) !== null) {
    if (match[1]) locs.push(match[1])
  }
  return locs
}

/**
 * Seed the crawl from the site's declared sitemap. A `<sitemapindex>` points to
 * child sitemaps, which are fetched (bounded) and flattened. All URLs are
 * scoped/deduped before emission. Missing sitemap = no-op (fetchText -> null).
 */
const sitemap: Detector = {
  name: "sitemap",
  kind: "spec",
  async applies(): Promise<boolean> {
    return true // universal — always worth a cheap probe
  },
  async detect(ctx: DiscoveryContext): Promise<DiscoveryResult> {
    const origin = new URL(ctx.baseUrl).origin
    const rawPages = new Set<string>()

    for (const path of CANDIDATES) {
      const xml = await ctx.fetchText(origin + path)
      if (!xml) continue
      const locs = extractLocs(xml)
      if (/<sitemapindex/i.test(xml)) {
        for (const child of locs.slice(0, MAX_NESTED)) {
          const childXml = await ctx.fetchText(child)
          if (childXml) for (const loc of extractLocs(childXml)) rawPages.add(loc)
        }
      } else {
        for (const loc of locs) rawPages.add(loc)
      }
    }

    if (rawPages.size === 0) return EMPTY_RESULT
    const pages = toScopedPages(rawPages, ctx.baseUrl, ctx.inScope)
    return { pages, endpoints: [], confidence: pages.length > 0 ? 1 : 0 }
  },
}

register(sitemap)
export { sitemap }
