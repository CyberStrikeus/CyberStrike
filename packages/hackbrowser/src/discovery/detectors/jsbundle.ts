import type { Page } from "playwright"
import { register } from "../registry.ts"
import { EMPTY_RESULT, type Detector, type DiscoveryContext, type DiscoveryResult, type Endpoint } from "../detector.ts"
import { mineEndpoints } from "../mine.ts"

// Bounds so a script-heavy SPA can't stall discovery or exhaust memory.
const MAX_SCRIPTS = 30
const MAX_BUNDLE_BYTES = 3_000_000
const MAX_INLINE_BYTES = 500_000

interface PageScripts {
  external: string[] // absolute <script src> URLs
  inline: string // concatenated inline <script> bodies
}

/** External script URLs + inline script bodies on the current page. */
async function collectScripts(page: Page): Promise<PageScripts> {
  return page.evaluate(() => {
    const external = new Set<string>()
    let inline = ""
    document.querySelectorAll("script").forEach((el) => {
      const src = el.src
      if (src) external.add(src)
      else if (el.textContent) inline += el.textContent + "\n"
    })
    return { external: [...external], inline }
  })
}

/**
 * Mine endpoints from the page's JS — both external bundles and inline scripts.
 * External scripts are kept when in-scope (covers CDN subdomains, not just the
 * page origin) and fetched through the authenticated browser context (inherits
 * auth + proxy). Inline scripts often carry bootstrap config (apiBase, etc.), so
 * they're mined too. Confidence is modest — mined strings are candidates, not
 * declared contracts — so the proxy-agents test them (Approach B).
 */
const jsbundle: Detector = {
  name: "jsbundle",
  kind: "api-call",
  async applies(): Promise<boolean> {
    return true
  },
  async detect(ctx: DiscoveryContext): Promise<DiscoveryResult> {
    const origin = new URL(ctx.baseUrl).origin
    let scripts: PageScripts
    try {
      scripts = await collectScripts(ctx.page)
    } catch {
      return EMPTY_RESULT
    }

    const endpoints = new Map<string, Endpoint>()
    const collect = (source: string): void => {
      for (const endpoint of mineEndpoints(source, origin, ctx.inScope)) {
        endpoints.set(`${endpoint.method} ${endpoint.url}`, endpoint)
      }
    }

    // Inline scripts (resolve root-relative paths against the app origin).
    if (scripts.inline) collect(scripts.inline.slice(0, MAX_INLINE_BYTES))

    // External bundles — in-scope only, bounded, fetched via the page context.
    const inScopeExternal = scripts.external.filter((src) => {
      try {
        return ctx.inScope(new URL(src).hostname)
      } catch {
        return false
      }
    })
    for (const src of inScopeExternal.slice(0, MAX_SCRIPTS)) {
      const text = await ctx.fetchText(src)
      if (!text || text.length > MAX_BUNDLE_BYTES) continue
      collect(text)
    }

    if (endpoints.size === 0) return EMPTY_RESULT
    return { pages: [], endpoints: [...endpoints.values()], confidence: 0.5 }
  },
}

register(jsbundle)
export { jsbundle }
