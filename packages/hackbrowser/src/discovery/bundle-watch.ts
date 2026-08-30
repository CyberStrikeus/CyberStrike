import type { Page, Response } from "playwright"
import { Log } from "../log.ts"
import type { ScopeMatcher } from "../scope.ts"
import { mineEndpoints } from "./mine.ts"
import { emitEndpoints } from "./emit.ts"

const log = Log.create({ service: "hackbrowser:discovery" })

const MAX_BODY_BYTES = 3_000_000

export interface BundleMinerOptions {
  /** App origin — root-relative paths in a bundle resolve against this. */
  origin: string
  inScope: ScopeMatcher
  serverUrl: string
  sessionID: string
  credentialId: string | undefined
  /** Crawl-wide emitted-endpoint keys, so we never re-ingest one. */
  seen: Set<string>
}

function isScript(url: string, response: Response): boolean {
  if (response.request().resourceType() === "script") return true
  const type = (response.headers()["content-type"] ?? "").toLowerCase()
  if (type.includes("javascript") || type.includes("ecmascript")) return true
  return /\.[mc]?js(\?|$)/i.test(url)
}

async function mineResponse(response: Response, opts: BundleMinerOptions): Promise<void> {
  try {
    const url = response.url()
    if (!isScript(url, response)) return
    let host: string
    try {
      host = new URL(url).hostname
    } catch {
      return
    }
    if (!opts.inScope(host)) return
    // Skip oversized bodies by declared length before reading them.
    const declared = Number(response.headers()["content-length"] ?? "0")
    if (declared > MAX_BODY_BYTES) return
    const text = await response.text()
    if (!text || text.length > MAX_BODY_BYTES) return
    const endpoints = mineEndpoints(text, opts.origin, opts.inScope)
    if (endpoints.length === 0) return
    const sent = await emitEndpoints(endpoints, opts.serverUrl, opts.sessionID, opts.credentialId, opts.seen)
    if (sent > 0) log.info("bundle-miner ingested endpoints", { url, endpoints: sent })
  } catch {
    // Body unavailable (redirect / aborted / page navigated) — ignore.
  }
}

/**
 * Attach a response listener that mines endpoints from every in-scope JS bundle
 * loaded DURING the crawl — crucially the lazy route chunks a seed-time DOM scan
 * cannot see (an Angular/React app loads `users.chunk.js` only when you reach
 * that route). Fire-and-forget, best-effort, fully guarded; emitted endpoints are
 * deduped crawl-wide and tested by the proxy-agents (Approach B), never hit here.
 */
export function attachBundleMiner(page: Page, opts: BundleMinerOptions): void {
  page.on("response", (response) => {
    void mineResponse(response, opts)
  })
}
