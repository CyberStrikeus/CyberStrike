// DataCollector (P4, design §5) — the deterministic "collect everything" half of the decoupled
// pipeline. Every request that reaches /ingest is recorded here, regardless of whether the AI
// navigator chose to load that page: the AI decides COVERAGE (which pages load); the collector
// captures the TRAFFIC that results, so the vulnerability pipeline (separate checkers off the DB)
// never depends on the AI's judgment (§12). This is an in-memory, per-session VIEW built for the
// navigator's context — the durable analysis store stays `endpoint_template` / `request_observation`.
//
// Requests are classified by resource kind (from the response content-type, falling back to the
// URL suffix — no extension change needed, the server sees both):
//   - api / html  → known routes the app uses (fed to the navigator as "routes seen in traffic")
//   - js          → script URL only (never the body — by design it stays in the browser); the
//                   substrate for out-of-band JS mining (uncalled routes / secrets) in P4.1
//   - static      → coverage counters only, never analyzed
//   - realtime    → counters only (ws/eventsource protocol notes)
// Response headers/cookies also feed the server-side framework fingerprint (merged with the
// extension's client-side one in the navigator context — resolves the P2 server-signal seam).
import { Log } from "../../util/log"

const log = Log.create({ service: "web-data-collector" })

export namespace DataCollector {
  export type Kind = "api" | "html" | "js" | "static" | "realtime"

  // What the ingest handler hands us per captured request (derived from the normalized request +
  // its optional response). `path` is the concrete path (for a JS url), not the endpoint template.
  export interface Record_ {
    method: string
    origin: string
    path: string
    status?: number
    contentType?: string
    headers?: Record<string, string>
  }

  export interface Endpoint {
    method: string
    origin: string
    path: string
    kind: "api" | "html"
    hits: number
    lastStatus?: number
  }
  export interface ServerSignals {
    headers: Record<string, string> // signal headers only (Server / X-Powered-By / …) for the fingerprint
    cookies: string[] // response cookie names (JSESSIONID / PHPSESSID / …)
  }
  // A route mined out-of-band from a JS bundle (P4.1) — discovered, not yet observed in traffic.
  export interface MinedRoute {
    method: string
    url: string // absolute
  }
  export interface CollectedData {
    endpoints: Endpoint[]
    jsUrls: string[]
    minedRoutes: MinedRoute[]
    counts: Record<Kind, number>
    server: ServerSignals
  }

  interface Store {
    endpoints: Map<string, Endpoint> // key: `${method} ${origin}${path}`
    jsUrls: Set<string>
    mined: Map<string, MinedRoute> // key: `${method} ${url}` — JS-mined routes (P4.1)
    counts: Record<Kind, number>
    headers: Map<string, string> // signal headers (lowercased name → value)
    cookies: Set<string>
  }
  const bySession = new Map<string, Store>()
  function store(sessionID: string): Store {
    let s = bySession.get(sessionID)
    if (!s) {
      s = { endpoints: new Map(), jsUrls: new Set(), mined: new Map(), counts: { api: 0, html: 0, js: 0, static: 0, realtime: 0 }, headers: new Map(), cookies: new Set() }
      bySession.set(sessionID, s)
    }
    return s
  }

  // Response headers that carry a framework/server signal — the ONLY ones we retain (never store
  // arbitrary headers). Single source; extend here.
  const SIGNAL_HEADERS = new Set(["server", "x-powered-by", "x-aspnet-version", "x-drupal-cache", "x-generator", "x-runtime"])

  const JS_RE = /\.m?js(\?|#|$)/i
  const STATIC_RE = /\.(css|png|jpe?g|gif|svg|webp|avif|ico|woff2?|ttf|eot|otf|mp4|webm|mp3|wav|pdf|map)(\?|#|$)/i
  const HTML_RE = /\.(html?|xhtml|jsp|asp|aspx|php)(\?|#|$)/i

  // Classify by content-type first (authoritative), then URL suffix (for captures with no
  // response). Pure + exported for tests. A path with no extension + no content-type ⇒ "html"
  // (a route, e.g. /account) so it surfaces as a navigable route rather than being dropped.
  export function classify(path: string, contentType?: string): Kind {
    const ct = (contentType ?? "").toLowerCase()
    if (ct) {
      if (ct.includes("javascript") || ct.includes("ecmascript")) return "js"
      if (ct.includes("text/html") || ct.includes("application/xhtml")) return "html"
      if (ct.includes("application/json") || ct.includes("graphql") || ct.includes("+json")) return "api"
      if (ct.startsWith("image/") || ct.startsWith("font/") || ct.startsWith("video/") || ct.startsWith("audio/") || ct.includes("text/css")) return "static"
      if (ct.includes("event-stream")) return "realtime"
    }
    if (JS_RE.test(path)) return "js"
    if (STATIC_RE.test(path)) return "static"
    if (HTML_RE.test(path)) return "html"
    // No signal either way: a bare route path (/account, /api/users) — treat as a navigable route.
    return "html"
  }

  // Record one captured request. Called on EVERY ingest (including dedup skips) — collection is
  // decoupled from what the AI navigated. Never throws (collection must not break ingest).
  export function record(sessionID: string, rec: Record_): Kind {
    try {
      const s = store(sessionID)
      const kind = classify(rec.path, rec.contentType)
      s.counts[kind]++
      if (kind === "js") {
        s.jsUrls.add(rec.origin + rec.path)
      } else if (kind === "api" || kind === "html") {
        const key = `${rec.method} ${rec.origin}${rec.path}`
        const prev = s.endpoints.get(key)
        if (prev) {
          prev.hits++
          if (rec.status !== undefined) prev.lastStatus = rec.status
        } else {
          s.endpoints.set(key, { method: rec.method, origin: rec.origin, path: rec.path, kind, hits: 1, lastStatus: rec.status })
        }
      }
      collectServer(s, rec.headers)
      return kind
    } catch (e) {
      log.debug("DataCollector.record failed (ignored)", { err: String(e) })
      return "static"
    }
  }

  // Retain only signal headers + response cookie names — the fingerprint substrate, nothing else.
  function collectServer(s: Store, headers?: Record<string, string>) {
    if (!headers) return
    for (const [k, v] of Object.entries(headers)) {
      const name = k.toLowerCase()
      if (SIGNAL_HEADERS.has(name)) s.headers.set(name, v)
      if (name === "set-cookie") for (const c of cookieNames(v)) s.cookies.add(c)
    }
  }
  // Extract cookie NAMES from a Set-Cookie value (possibly several cookies). We never keep values.
  function cookieNames(setCookie: string): string[] {
    return setCookie
      .split(/,(?=[^;]+?=)|\n/) // split multiple cookies (comma before `name=` or newline)
      .map((c) => c.split("=")[0]?.trim())
      .filter((n): n is string => !!n && !n.includes(" ")) // drop attribute fragments (e.g. "Expires")
  }

  const ENDPOINT_CAP = 200 // bound the per-session view; the DB holds the full set
  const MINED_CAP = 200

  // Record routes mined from JS bundles (P4.1). Append-only + deduped by `${method} ${url}`.
  export function addMined(sessionID: string, routes: MinedRoute[]): void {
    if (routes.length === 0) return
    const s = store(sessionID)
    for (const r of routes) {
      const key = `${r.method} ${r.url}`
      if (!s.mined.has(key)) s.mined.set(key, r)
    }
  }

  export function latest(sessionID: string): CollectedData {
    const s = bySession.get(sessionID)
    if (!s) return { endpoints: [], jsUrls: [], minedRoutes: [], counts: { api: 0, html: 0, js: 0, static: 0, realtime: 0 }, server: { headers: {}, cookies: [] } }
    return {
      // html routes first (navigable), then api; each by descending hits — most-used surface first.
      endpoints: [...s.endpoints.values()]
        .sort((a, b) => (a.kind === b.kind ? b.hits - a.hits : a.kind === "html" ? -1 : 1))
        .slice(0, ENDPOINT_CAP),
      jsUrls: [...s.jsUrls],
      minedRoutes: [...s.mined.values()].slice(0, MINED_CAP),
      counts: { ...s.counts },
      server: { headers: Object.fromEntries(s.headers), cookies: [...s.cookies] },
    }
  }

  export function clearSession(sessionID: string): void {
    bySession.delete(sessionID)
  }
  export function _reset(): void {
    bySession.clear()
  }
}
