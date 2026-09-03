// JS-mining service (P4.1, design §5) — the out-of-band half. The extension can't read response
// bodies (MV3), so mining fetches the JS bundle URLs DataCollector already collected, extracts
// candidate API routes deterministically (JsMine — raw JS never reaches an LLM), and records them
// back into DataCollector as "mined routes". Those then surface in the navigator context as
// known-but-unvisited routes and feed the decoupled vuln pipeline.
//
// Bounded and best-effort: each bundle is fetched at most ONCE per session, a pass fetches at most
// a handful, fetches time out + size-cap, and a failure never retries or throws. The fetcher is
// injectable so tests exercise the pipeline with canned bundles instead of the network.
//
// KNOWN LIMIT: this fetches server-side, so auth-gated JS (rare — bundles are usually public
// static assets) may 401; the 1.x discovery-core mined inside the authed browser context. An
// extension-side fetch is the future fix — flagged, not built here.
import { DataCollector } from "./data-collector"
import { JsMine } from "./js-mine"
import { WebScope } from "./scope"
import { Log } from "../../util/log"

const log = Log.create({ service: "web-js-miner" })

export namespace JsMiner {
  // Returns the JS bundle's source text, or null on any failure (best-effort).
  export type Fetcher = (url: string) => Promise<string | null>

  const MAX_BYTES = 3_000_000 // skip / truncate bundles bigger than ~3MB (memory bound)
  const FETCH_TIMEOUT_MS = 8000
  const MAX_PER_PASS = 8 // how many new bundles one pass fetches

  export const defaultFetcher: Fetcher = async (url) => {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), redirect: "follow" })
      if (!res.ok) return null
      const len = Number(res.headers.get("content-length") ?? "0")
      if (len && len > MAX_BYTES) return null
      const text = await res.text()
      return text.length > MAX_BYTES ? text.slice(0, MAX_BYTES) : text
    } catch (e) {
      log.debug("js fetch failed", { url, err: String(e) })
      return null
    }
  }

  const minedBySession = new Map<string, Set<string>>() // js urls already fetched (mined-or-failed)
  const inflight = new Set<string>() // sessions with a pass currently running
  function seen(sessionID: string): Set<string> {
    let s = minedBySession.get(sessionID)
    if (!s) {
      s = new Set()
      minedBySession.set(sessionID, s)
    }
    return s
  }

  // Fetch + mine the in-scope JS URLs collected for this session that haven't been mined yet, and
  // record the discovered routes into DataCollector. Returns how many routes were newly recorded
  // (0 when nothing new or a pass is already running). Never throws.
  export async function mineNew(sessionID: string, fetcher: Fetcher = defaultFetcher, maxPerPass = MAX_PER_PASS): Promise<number> {
    if (inflight.has(sessionID)) return 0
    const done = seen(sessionID)
    const targets = DataCollector.latest(sessionID)
      .jsUrls.filter((u) => !done.has(u) && WebScope.allowed(sessionID, u))
      .slice(0, maxPerPass)
    if (targets.length === 0) return 0
    inflight.add(sessionID)
    let count = 0
    try {
      for (const url of targets) {
        done.add(url) // mark before fetch so a broken URL can't retry-loop (flag: no re-mine on transient failure)
        const origin = originOf(url)
        if (!origin) continue
        let text: string | null = null
        try {
          text = await fetcher(url)
        } catch (e) {
          log.debug("js fetcher threw", { url, err: String(e) })
        }
        if (!text) continue
        const routes = JsMine.mineEndpoints(text, origin, (u) => WebScope.allowed(sessionID, u))
        DataCollector.addMined(sessionID, routes)
        count += routes.length
      }
    } finally {
      inflight.delete(sessionID)
    }
    return count
  }

  function originOf(url: string): string | null {
    try {
      return new URL(url).origin
    } catch {
      return null
    }
  }

  export function _reset(): void {
    minedBySession.clear()
    inflight.clear()
  }
}
