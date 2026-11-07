// Crawl — the discovery producer (SHALLOW scaffold). Given a seed URL and a Sender, it walks
// same-host page links breadth-first, stores each fetched response as a Transaction (so the whole
// corpus/rule/inventory pipeline sees crawled traffic), and records the endpoints + script URLs it
// finds into the discovered inventory (via ingestExtract) so `untestedEndpoints` and a later JS-mine
// pass can pick them up. Bounded so it can't run away.
//
// DELIBERATELY SHALLOW (deepen separately — see the tracking issue): HTML href/action/src regex
// only. No JS execution / SPA rendering, no form submission, no auth/login flow, no robots.txt, no
// rate control beyond the page cap, no JS-body mining (that's the jsmine module). It fetches through
// the Sender, so it inherits credentials/replay-safety from send().
import type { TrafficStore } from "./store"
import type { Sender } from "./active"
import { ingestExtract } from "./discovery"

export interface CrawlOptions {
  maxPages?: number // frontier bound (default 50)
  sameHostOnly?: boolean // stay on the seed's host (default true)
}
export interface CrawlResult {
  fetched: string[] // page URLs actually requested
  discovered: string[] // links found (pages + scripts), in the store's discovered inventory
}

function hostOf(url: string): string | undefined {
  try {
    return new URL(url).host
  } catch {
    return undefined
  }
}

// Pull same-page navigations (href/action) and script srcs out of an HTML body, absolutised.
function extractLinks(html: string, base: string): { pages: string[]; scripts: string[] } {
  const abs = (u: string): string | undefined => {
    try {
      const url = new URL(u, base)
      return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : undefined
    } catch {
      return undefined
    }
  }
  const pages = new Set<string>()
  const scripts = new Set<string>()
  for (const m of html.matchAll(/(?:href|action)\s*=\s*["']([^"'#\s]+)["']/gi)) {
    const u = abs(m[1]!)
    if (u) pages.add(u)
  }
  for (const m of html.matchAll(/<script[^>]+src\s*=\s*["']([^"'\s]+)["']/gi)) {
    const u = abs(m[1]!)
    if (u) scripts.add(u)
  }
  return { pages: [...pages], scripts: [...scripts] }
}

export async function crawl(store: TrafficStore, seed: string, send: Sender, opts: CrawlOptions = {}): Promise<CrawlResult> {
  const maxPages = opts.maxPages ?? 50
  const sameHostOnly = opts.sameHostOnly ?? true
  const seedHost = hostOf(seed)
  const inScope = (url: string) => !sameHostOnly || hostOf(url) === seedHost

  const queue: string[] = [seed]
  const seen = new Set<string>()
  const fetched: string[] = []
  const discovered = new Set<string>()

  while (queue.length && fetched.length < maxPages) {
    const url = queue.shift()!
    if (seen.has(url)) continue
    seen.add(url)
    if (!inScope(url)) continue

    const res = await send({ url, method: "GET" }, {})
    store.add(res.transaction) // crawled traffic joins the corpus
    fetched.push(url)

    const body = res.transaction.response?.body ?? ""
    const { pages, scripts } = extractLinks(body, url)
    const inScopePages = pages.filter(inScope)
    for (const u of [...inScopePages, ...scripts]) discovered.add(u)
    // feed the discovered inventory: pages → endpoints, scripts → jsUrls (a later JS-mine pass fetches these)
    ingestExtract(store, res.transaction.id, { endpoints: inScopePages, jsUrls: scripts, tech: [], secrets: [] })

    for (const u of inScopePages) if (!seen.has(u)) queue.push(u)
  }

  return { fetched, discovered: [...discovered] }
}
