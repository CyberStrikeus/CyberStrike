// Well-known API-doc / recon probe (deterministic discovery, design §5 — sibling of JsMiner).
// Once per session, out-of-band, it fetches the well-known paths a target may serve — OpenAPI /
// Swagger specs, robots.txt, sitemap.xml — parses them, and:
//   - API routes (from the spec) → DataCollector + EMITTED to /session/ingest as synthetic
//     requests (Approach B: response:null, X-Discovered-By) so they land in endpoint_template and
//     the vuln sub-agents test them. This catches Swagger WITHOUT the AI navigating to it (which
//     would be redundant tunnelling — the collector, not the navigator, should grab API docs).
//   - Pages (from robots/sitemap) → the crawl frontier, so the AI navigates them naturally.
// Deterministic recon belongs HERE, not in the LLM navigator (wastes model calls, re-introduces
// tunnelling) nor in the vuln sub-agents (they TEST what's discovered, they don't discover).
//
// KNOWN LIMIT: server-side fetch — auth-gated specs (rare) may 401. Injectable fetch/emit for tests.
import { OpenApi } from "./openapi"
import { DataCollector } from "./data-collector"
import { WebScope } from "./scope"
import { WebControl } from "./control"
import { Crawl } from "./crawl"
import { HBLog } from "./hblog"
import { Server } from "../../server/server"
import { Log } from "../../util/log"

const log = Log.create({ service: "web-well-known" })

export namespace WellKnown {
  export type Fetcher = (url: string) => Promise<string | null>
  export type Emit = (sessionID: string, method: string, url: string, source: string) => Promise<void>

  const MAX_BYTES = 3_000_000
  const FETCH_TIMEOUT_MS = 8000
  const MAX_EMIT = 300 // bound synthetic-ingest fan-out (each dispatches a vuln sub-agent)

  const probed = new Set<string>() // session probed once

  export const defaultFetcher: Fetcher = async (url) => {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), redirect: "follow" })
      if (!res.ok) return null
      const len = Number(res.headers.get("content-length") ?? "0")
      if (len && len > MAX_BYTES) return null
      const text = await res.text()
      return text.length > MAX_BYTES ? text.slice(0, MAX_BYTES) : text
    } catch (e) {
      log.debug("well-known fetch failed", { url, err: String(e) })
      return null
    }
  }

  // Ingest a discovered route/page as a synthetic request (Approach B — discovered, not hit).
  const defaultEmit: Emit = async (sessionID, method, url, source) => {
    try {
      const u = new URL(url)
      const path = (u.pathname || "/") + u.search
      const raw = `${method} ${path} HTTP/1.1\r\nHost: ${u.host}\r\nX-Discovered-By: ${source}\r\n\r\n`
      await fetch(new URL("session/ingest", Server.url()).href, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionID, text: raw, scheme: u.protocol === "http:" ? "http" : "https" }),
      })
    } catch (e) {
      log.debug("well-known emit failed", { url, err: String(e) })
    }
  }

  function originOf(target: string): string | null {
    try {
      return new URL(target).origin
    } catch {
      return null
    }
  }

  // robots.txt Disallow/Allow path rules → absolute page urls (a wildcard/`$` rule is skipped).
  function parseRobots(text: string, origin: string): string[] {
    const out: string[] = []
    for (const line of text.split(/\r?\n/)) {
      const m = /^\s*(?:dis)?allow\s*:\s*(\S+)/i.exec(line)
      if (!m) continue
      const p = m[1]
      if (p === "/" || p.includes("*") || p.includes("$")) continue
      try {
        out.push(new URL(p, origin).href)
      } catch {}
    }
    return out
  }

  // sitemap.xml <loc> urls (also handles a sitemap index the same way — nested maps aren't fetched).
  function parseSitemap(text: string): string[] {
    const out: string[] = []
    const re = /<loc>\s*([^<\s]+)\s*<\/loc>/gi
    let m: RegExpExecArray | null
    while ((m = re.exec(text))) out.push(m[1].trim())
    return out
  }

  // Run the probe once for a session. `target` is the crawl origin. Returns how many routes/pages
  // were emitted/queued. Never throws.
  export async function probe(sessionID: string, target: string, opts?: { fetch?: Fetcher; emit?: Emit }): Promise<number> {
    if (probed.has(sessionID)) return 0
    probed.add(sessionID)
    const origin = originOf(target)
    if (!origin) return 0
    // Prefer the extension's in-page (authed) fetch when connected, else server-side — so an
    // auth-gated swagger/openapi spec is reachable (a server-side fetch would 401).
    const fetcher = opts?.fetch ?? WebControl.fetcher(sessionID, defaultFetcher)
    const emit = opts?.emit ?? defaultEmit
    const inScope = (u: string) => WebScope.allowed(sessionID, u)

    const routes = new Map<string, OpenApi.Endpoint>()
    const specUrls: string[] = []
    // 1) OpenAPI / Swagger specs → API routes.
    for (const cand of OpenApi.SPEC_CANDIDATES) {
      const specUrl = origin + cand
      if (!inScope(specUrl)) continue
      const text = await fetcher(specUrl)
      if (!text || !OpenApi.looksLikeSpec(text)) continue
      specUrls.push(specUrl)
      for (const e of OpenApi.parse(text, specUrl, inScope)) routes.set(`${e.method} ${e.url}`, e)
    }
    // 2) robots.txt + sitemap.xml → pages (fed to the frontier, navigated naturally).
    const pages = new Set<string>()
    const robots = await fetcher(origin + "/robots.txt")
    if (robots) for (const u of parseRobots(robots, origin)) if (inScope(u)) pages.add(u)
    const sitemap = await fetcher(origin + "/sitemap.xml")
    if (sitemap) for (const u of parseSitemap(sitemap)) if (inScope(u)) pages.add(u)

    const routeList = [...routes.values()].slice(0, MAX_EMIT)
    const pageList = [...pages].slice(0, MAX_EMIT)

    // Feed the navigator context (DataCollector) + emit routes to the vuln pipeline; pages go to
    // the crawl frontier so the AI reaches them itself (real capture, not synthetic).
    DataCollector.addMined(sessionID, routeList)
    Crawl.discover(sessionID, pageList)
    let n = 0
    for (const s of specUrls) {
      await emit(sessionID, "GET", s, "well-known-spec") // the spec doc itself
      n++
    }
    for (const r of routeList) {
      await emit(sessionID, r.method, r.url, "openapi")
      n++
    }
    HBLog.record(sessionID, "server", "well-known", { specs: specUrls.length, routes: routeList.length, pages: pageList.length })
    return n
  }

  // Parse an ALREADY-captured OpenAPI/Swagger spec — one seen in traffic, or surfaced by any sub-agent
  // as a finding — and emit its routes into the pipeline. This is the deterministic correlation the
  // sub-agents DON'T do on their own: a specialist flags "spec exposed" and stops, so its documented
  // endpoints were never enumerated. Here, ANY spec that reaches ingest ALWAYS gets its endpoints
  // enumerated + scanned (as the captured identity, so it's authenticated coverage), not just flagged —
  // no reliance on an agent thinking to follow up. Deduped per spec so a repeated capture doesn't
  // re-fan-out. Never throws.
  const specsSeen = new Set<string>()
  export async function ingestSpec(sessionID: string, specUrl: string, specText: string, opts?: { emit?: Emit }): Promise<number> {
    try {
      if (!specText || !OpenApi.looksLikeSpec(specText)) return 0
      const key = `${sessionID} ${specUrl}`
      if (specsSeen.has(key)) return 0
      specsSeen.add(key)
      const emit = opts?.emit ?? defaultEmit
      const inScope = (u: string) => WebScope.allowed(sessionID, u)
      const routes = [...new Map(OpenApi.parse(specText, specUrl, inScope).map((e) => [`${e.method} ${e.url}`, e])).values()].slice(0, MAX_EMIT)
      if (routes.length === 0) return 0
      DataCollector.addMined(sessionID, routes)
      for (const r of routes) await emit(sessionID, r.method, r.url, "openapi-captured")
      HBLog.record(sessionID, "server", "spec-ingested", { specUrl, routes: routes.length })
      log.info("captured OpenAPI spec enumerated → endpoints queued for scanning", { sessionID, specUrl, routes: routes.length })
      return routes.length
    } catch (e) {
      log.debug("ingestSpec failed (ignored)", { specUrl, err: String(e) })
      return 0
    }
  }

  export function _reset(): void {
    probed.clear()
    specsSeen.clear()
  }
}
