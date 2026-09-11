// Browser → Vortex bridge. The browser SourceAdapter for Vortex: at the ingest handler, the same
// captured request+response that becomes a CS Request row ALSO becomes a Vortex Transaction, so the
// Vortex engine (rules → signals → subjects → inventory → leads) runs over the live web corpus in
// parallel with the existing CS signal fabric (verify-first; the fabric retires once Vortex proves
// out). Never throws — must not break the ingest path.
import { SqliteStore, defaultRegistry, leads, endpointKey, forAgent, injectPoints, probeSession, send, discoveredId, type Vortex, type TrafficStore, type Transaction, type Header, type Lead, type Sender } from "@cyberstrike-io/vortex"
import { Database } from "bun:sqlite"
import { Global } from "@/global"
import { Log } from "@/util/log"
import path from "path"

const log = Log.create({ service: "vortex-bridge" })

// One DURABLE, session-scoped Vortex store per session — backed by a single shared bun:sqlite file
// under the app data dir (SqliteStore scopes every op by session, so one file holds all sessions
// without bleeding). Survives restarts and holds thousands of requests (not memory). The rule
// registry (baseline catalog) is shared across sessions.
let db: Database | undefined
function database(): Database {
  if (!db) db = new Database(path.join(Global.Path.data, "vortex.db"))
  return db
}
const stores = new Map<string, TrafficStore>()
const registry = defaultRegistry()
function storeFor(sessionID: string): TrafficStore {
  let s = stores.get(sessionID)
  if (!s) {
    s = new SqliteStore(database(), sessionID)
    stores.set(sessionID, s)
  }
  return s
}
export function dropSession(sessionID: string): void {
  stores.delete(sessionID)
}

// The narrow agent facade over this session's Vortex store — what the Vortex agent tools call.
export function vortexApi(sessionID: string): Vortex {
  // Pass the governed, rate-limited sender so the agent's vortex_probe can actively probe on demand.
  // vortex_probe RETURNS its findings and does NOT persist to the store — an agent's probe attempts
  // never mark Vortex's coverage; only this session's autonomous auto-probe writes it.
  return forAgent(storeFor(sessionID), probeSender())
}

// Parse a raw HTTP request (the extension's captured text) into headers + body. First line is the
// request line (skipped); a blank line separates headers from body.
function parseRawRequest(raw: string): { headers: Header[]; body?: string } {
  const split = raw.split(/\r?\n\r?\n/)
  const head = split[0] ?? ""
  const body = split.length > 1 ? split.slice(1).join("\n\n") : undefined
  const lines = head.split(/\r?\n/)
  const headers: Header[] = []
  for (let i = 1; i < lines.length; i++) {
    const idx = lines[i]!.indexOf(":")
    if (idx > 0) headers.push({ name: lines[i]!.slice(0, idx).trim(), value: lines[i]!.slice(idx + 1).trim() })
  }
  return { headers, body: body || undefined }
}

function recordToHeaders(h?: Record<string, string>): Header[] {
  if (!h) return []
  const out: Header[] = []
  for (const name in h) out.push({ name, value: h[name]! })
  return out
}

export interface BrowserIngest {
  sessionID: string
  requestID: string
  method: string
  url: string
  host: string
  identity?: string // the credential/role this ran under
  pageUrl?: string // the page the request was captured from (for the Vortex-sourced Captures > Pages view)
  rawRequest?: string
  response?: { status?: number; headers?: Record<string, string>; body?: string }
}

// Feed one captured request+response into the session's Vortex store and run the per-transaction
// rules over it (cheap; corpus/chain rules run in vortexReport). Returns running counts.
export function ingestBrowserTransaction(i: BrowserIngest): { transactions: number; signals: number } {
  try {
    const store = storeFor(i.sessionID)
    const parsed = i.rawRequest ? parseRawRequest(i.rawRequest) : { headers: [] as Header[], body: undefined }
    const tx: Transaction = {
      id: i.requestID,
      session: i.sessionID,
      source: "browser",
      host: i.host,
      identity: i.identity,
      pageUrl: i.pageUrl,
      request: { method: i.method, url: i.url, headers: parsed.headers, body: parsed.body },
      response: i.response ? { status: i.response.status ?? 0, headers: recordToHeaders(i.response.headers), body: i.response.body } : undefined,
    }
    store.add(tx)
    const sigs = registry.run(tx) // per-transaction rules on the new tx
    const added = store.addSignals(sigs)
    // Enumerate + persist this request's injection points (issue #9). Cheap, no network — just parse
    // every query/body-dotpath/path/header input into the inventory so active probing (vortexProbe,
    // gated) and coverage can run off it. Never throws.
    const points = store.addInjectPoints(injectPoints(tx))
    log.info("vortex ingest", { sessionID: i.sessionID, endpoint: endpointKey(tx), transactions: store.size(), newSignals: added, newParams: points, ruleIds: sigs.map((s) => s.ruleId) })
    // Auto-probe the new points in the background when active probing is enabled (no-op otherwise).
    // Fire-and-forget: must not block or break the ingest path.
    kickProbe(i.sessionID)
    return { transactions: store.size(), signals: store.signals().length }
  } catch (e) {
    log.debug("vortex ingest failed (ignored)", { err: String(e) })
    return { transactions: 0, signals: 0 }
  }
}

// On-demand: run the FULL analysis (per-tx + corpus/chain rules) over the session corpus and return
// the assembled leads. Used to inspect what Vortex has found.
export function vortexReport(sessionID: string): { transactions: number; signals: number; leads: Lead[] } {
  const store = storeFor(sessionID)
  try {
    store.addSignals(registry.analyze(store.all()))
  } catch (e) {
    log.debug("vortex analyze failed (ignored)", { err: String(e) })
  }
  return { transactions: store.size(), signals: store.signals().length, leads: leads(store) }
}

// Record a discovered JS asset in the session's Vortex store so JS is visible from the ONE source
// (the Captures > JS Files view reads Vortex, not a separate web_js copy). Best-effort — a failure
// here must never break capture. Deduped by (kind,value) inside the store.
export function vortexDiscoverJs(sessionID: string, url: string): void {
  const u = String(url || "").trim()
  if (!u) return
  try {
    storeFor(sessionID).addDiscovered([{ id: discoveredId("js", u), kind: "js", value: u, source: "extract", hit: false }])
  } catch (e) {
    log.debug("vortex discover-js failed (ignored)", { err: String(e) })
  }
}

// The Captures view, sourced entirely from the session's Vortex store — the single source of truth
// the TUI sidebar reads (no divergent session-web copy). `requests` are the captured transactions
// (the sidebar groups them by host and derives distinct pages from pageUrl); `jsFiles` are the
// discovered JS assets. Pure reads over the store.
export function vortexCaptures(sessionID: string): {
  requests: { id: string; method: string; host: string; url: string; status?: number; identity?: string; pageUrl?: string }[]
  jsFiles: { url: string; hit: boolean }[]
} {
  const store = storeFor(sessionID)
  const requests = store.all().map((t) => ({
    id: t.id,
    method: t.request.method,
    host: t.host,
    url: t.request.url,
    status: t.response?.status,
    identity: t.identity,
    pageUrl: t.pageUrl,
  }))
  const jsFiles = store.discovered("js").map((d) => ({ url: d.value, hit: d.hit }))
  return { requests, jsFiles }
}

// ACTIVE injection probing on the live corpus — the path in Vortex that SENDS payloads to the
// target (that IS how a probe produces a signal). Gated by CYBERSTRIKE_VORTEX_ACTIVE_PROBE: setting
// it is the deliberate opt-in, and when set, probing runs automatically in the BACKGROUND after
// ingest (no manual trigger needed). Off by default. Every send is rate-limited + replay-safe
// (Vortex's send() refuses session-minting requests). Never throws.
const ACTIVE_PROBE = process.env.CYBERSTRIKE_VORTEX_ACTIVE_PROBE === "1" || process.env.CYBERSTRIKE_VORTEX_ACTIVE_PROBE === "true"
const PROBE_MIN_INTERVAL_MS = Math.max(0, Number(process.env.CYBERSTRIKE_VORTEX_PROBE_INTERVAL_MS) || 200) // ~5 rps default

// A rate-limited, governed sender: a small pre-send delay caps throughput (probeSession sends
// sequentially), and Vortex's own send() enforces replay-safety + a per-send timeout.
function probeSender(): Sender {
  let last = 0
  return async (input, opts) => {
    const wait = PROBE_MIN_INTERVAL_MS - (Date.now() - last)
    if (wait > 0) await new Promise((r) => setTimeout(r, wait))
    last = Date.now()
    return send(input, { ...opts, timeoutMs: opts?.timeoutMs ?? 15_000, followRedirects: false })
  }
}

// One probing pass over a session's not-yet-probed inject points. Persists signals + coverage.
export async function vortexProbe(sessionID: string): Promise<{ enabled: boolean; probed: number; signals: number }> {
  if (!ACTIVE_PROBE) return { enabled: false, probed: 0, signals: 0 }
  try {
    const res = await probeSession(storeFor(sessionID), probeSender())
    log.info("vortex active-probe", { sessionID, probed: res.probed, signals: res.signals.length })
    return { enabled: true, probed: res.probed, signals: res.signals.length }
  } catch (e) {
    log.debug("vortex active-probe failed (ignored)", { err: String(e) })
    return { enabled: true, probed: 0, signals: 0 }
  }
}

// Background auto-probe: when enabled, drain a session's unprobed points off the ingest path (fire-
// and-forget, never awaited by ingest). One loop per session at a time — a run in progress absorbs
// new ingests via its re-check, so ingest never blocks and probes never stampede.
const probing = new Set<string>()
export function kickProbe(sessionID: string): void {
  if (!ACTIVE_PROBE || probing.has(sessionID)) return
  probing.add(sessionID)
  void (async () => {
    try {
      for (let pass = 0; pass < 50; pass++) {
        if (storeFor(sessionID).injectPoints({ probed: false }).length === 0) break
        const res = await vortexProbe(sessionID)
        if (res.probed === 0) break
      }
    } finally {
      probing.delete(sessionID)
    }
  })()
}
