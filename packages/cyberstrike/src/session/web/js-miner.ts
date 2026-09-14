// JS-mining service (P4.1 routes + P4.2 secrets & source maps, design §5) — the out-of-band half.
// The extension can't read response bodies (MV3), so this fetches the JS bundle URLs DataCollector
// collected and, for each, deterministically extracts:
//   - candidate API routes (JsMine) → DataCollector.addMined
//   - hardcoded secrets (JsSecrets, redacted) → DataCollector.addSecrets + HBLog
//   - its source map (inline data-URI or external .map) → mine the ORIGINAL un-minified source
//     content the same way (routes + secrets the minifier obscured).
// Raw JS/source never reaches an LLM — only the extracted route/secret lists do.
//
// Bounded + best-effort: each bundle AND each map is fetched at most ONCE per session, a pass
// fetches at most a handful, fetches time out + size-cap, source-map source content is byte-
// budgeted, a failure never retries or throws. The fetcher is injectable so tests exercise the
// pipeline with canned bundles instead of the network.
//
// KNOWN LIMIT: this fetches server-side, so auth-gated JS (rare — bundles are usually public
// static assets) may 401; the 1.x discovery-core mined inside the authed browser context. An
// extension-side fetch is the future fix — flagged, not built here.
import * as VortexBridge from "./vortex-bridge"
import { DataCollector } from "./data-collector"
import { JsMine } from "./js-mine"
import { JsSecrets } from "./js-secrets"
import { JsSourceMap } from "./js-sourcemap"
import { WebScope } from "./scope"
import { WebControl } from "./control"
import { ApiProbe } from "./api-probe"
import { HBLog } from "./hblog"
import { Log } from "../../util/log"

const log = Log.create({ service: "web-js-miner" })

export namespace JsMiner {
  // Returns the resource's text, or null on any failure (best-effort).
  export type Fetcher = (url: string) => Promise<string | null>

  const MAX_BYTES = 3_000_000 // skip / truncate resources bigger than ~3MB (memory bound)
  const FETCH_TIMEOUT_MS = 8000
  const MAX_PER_PASS = 8 // how many new bundles one pass fetches
  const MAX_SOURCES = 60 // source-map sourcesContent entries scanned per map
  const MAP_BYTE_BUDGET = 2_000_000 // total source-map content bytes scanned per map

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

  const minedBySession = new Map<string, Set<string>>() // resource urls already fetched (mined-or-failed)
  const inflight = new Set<string>() // sessions with a pass currently running
  function seen(sessionID: string): Set<string> {
    let s = minedBySession.get(sessionID)
    if (!s) {
      s = new Set()
      minedBySession.set(sessionID, s)
    }
    return s
  }

  const inScopeOf = (sessionID: string) => (u: string) => WebScope.allowed(sessionID, u)
  async function safeFetch(fetcher: Fetcher, url: string): Promise<string | null> {
    try {
      return await fetcher(url)
    } catch (e) {
      log.debug("js fetcher threw", { url, err: String(e) })
      return null
    }
  }

  // Mine routes + secrets out of one blob of source, recording both. `sourceUrl` labels where a
  // secret was found (redacted preview only). Returns the count of NEWLY-seen routes recorded.
  function processText(sessionID: string, text: string, origin: string, sourceUrl: string): number {
    const routes = JsMine.mineEndpoints(text, origin, inScopeOf(sessionID))
    DataCollector.addMined(sessionID, routes)
    // Recursive: this bundle may reference other bundles (webpack/vite chunks, dynamic imports) —
    // register them so a later pass fetches and mines them too (they carry more endpoints).
    const chunks = JsMine.mineChunkUrls(text, sourceUrl, inScopeOf(sessionID))
    if (chunks.length > 0) DataCollector.addJsUrls(sessionID, chunks)
    const secrets = JsSecrets.scan(text)
    if (secrets.length > 0) {
      DataCollector.addSecrets(
        sessionID,
        secrets.map((s) => ({ type: s.type, preview: s.preview, source: sourceUrl })),
      )
      for (const s of secrets) HBLog.record(sessionID, "codrive", "secret", { type: s.type, preview: s.preview, source: sourceUrl })
    }
    return routes.length
  }

  // Find + mine a bundle's source map (inline data-URI, else external .map fetched once + in-scope).
  // Mines each original source's un-minified content, byte- and count-bounded. Returns routes count.
  async function processSourceMap(sessionID: string, jsText: string, jsUrl: string, origin: string, fetcher: Fetcher, done: Set<string>): Promise<number> {
    let parsed = JsSourceMap.inline(jsText)
    let label = `${jsUrl} (inline map)`
    if (!parsed) {
      const mapUrl = JsSourceMap.refUrl(jsText, jsUrl)
      if (!mapUrl || done.has(mapUrl) || !WebScope.allowed(sessionID, mapUrl)) return 0
      done.add(mapUrl)
      const mapText = await safeFetch(fetcher, mapUrl)
      if (!mapText) return 0
      parsed = JsSourceMap.parse(mapText)
      label = mapUrl
    }
    if (!parsed) return 0
    let routes = 0
    let budget = MAP_BYTE_BUDGET
    for (const content of parsed.sourcesContent.slice(0, MAX_SOURCES)) {
      if (budget <= 0) break
      const slice = content.length > budget ? content.slice(0, budget) : content
      budget -= slice.length
      routes += processText(sessionID, slice, origin, label)
    }
    return routes
  }

  // Fetch + mine the in-scope JS URLs collected for this session that haven't been mined yet, and
  // record discovered routes + secrets. Returns how many routes were newly recorded (0 when nothing
  // new or a pass is already running). Never throws.
  export async function mineNew(sessionID: string, fetcherOverride?: Fetcher, maxPerPass = MAX_PER_PASS): Promise<number> {
    if (inflight.has(sessionID)) return 0
    // Prefer the extension's in-page (authed) fetch when connected, else server-side. A test/caller
    // can still inject an explicit fetcher.
    const fetcher: Fetcher = fetcherOverride ?? WebControl.fetcher(sessionID, defaultFetcher)
    const done = seen(sessionID)
    const targets = DataCollector.latest(sessionID)
      .jsUrls.filter((u) => !done.has(u) && WebScope.allowed(sessionID, u))
      .slice(0, maxPerPass)
    if (targets.length === 0) return 0
    inflight.add(sessionID)
    let routes = 0
    try {
      for (const url of targets) {
        done.add(url) // mark before fetch so a broken URL can't retry-loop (flag: no re-mine on transient failure)
        const origin = originOf(url)
        if (!origin) continue
        const text = await safeFetch(fetcher, url)
        if (!text) continue
        routes += processText(sessionID, text, origin, url)
        routes += await processSourceMap(sessionID, text, url, origin, fetcher, done)
        // Persist the fetched (first-party, in-scope) bundle body into Vortex as an OBSERVED
        // transaction so the DSL rule engine + the Enterprise jsmine extractor run over the actual
        // script — offline and re-scannable (issue #22). Legacy JsMine/JsSecrets above still run; this
        // is additive while web detection converges on Vortex (#15). Never throws.
        VortexBridge.ingestJsBody(sessionID, url, text)
      }
    } finally {
      inflight.delete(sessionID)
    }
    return routes
  }

  // Recursive drain: keep mining until no NEW bundle remains (chunk-following adds bundles as it
  // goes), bounded by a total per-session cap so a pathological chunk graph can't run away. Then
  // wake the API-direct fast lane so freshly-mined endpoints get probed — JS discovery → fast scan.
  const MAX_TOTAL_BUNDLES = 60
  export async function mineAll(sessionID: string, fetcherOverride?: Fetcher): Promise<number> {
    let total = 0
    for (let i = 0; i < 10; i++) {
      if (seen(sessionID).size >= MAX_TOTAL_BUNDLES) break
      const n = await mineNew(sessionID, fetcherOverride)
      total += n
      // Stop when a pass mined nothing AND left no new bundles queued (jsUrls fully drained).
      const remaining = DataCollector.latest(sessionID).jsUrls.filter((u) => !seen(sessionID).has(u)).length
      if (n === 0 && remaining === 0) break
    }
    if (total > 0) {
      log.info("js mining complete", { sessionID, routes: total, bundles: seen(sessionID).size })
      try {
        ApiProbe.wake(sessionID) // newly-mined endpoints → deterministic probe (fast scan)
      } catch {}
    }
    return total
  }

  // Debounced deterministic trigger — coalesce a burst of new script URLs into one recursive mine.
  // Removes the old LLM-gating (mining now runs from ingest, not only when the navigator chooses to).
  const DEBOUNCE_MS = Math.max(0, Number(process.env.CYBERSTRIKE_JSMINE_DEBOUNCE_MS) || 5000)
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  export function wake(sessionID: string): void {
    if (timers.has(sessionID)) return
    timers.set(
      sessionID,
      setTimeout(() => {
        timers.delete(sessionID)
        void mineAll(sessionID).catch((e) => log.error("js mine drain crashed", { sessionID, err: String(e) }))
      }, DEBOUNCE_MS),
    )
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
    for (const t of timers.values()) clearTimeout(t)
    timers.clear()
  }
}
