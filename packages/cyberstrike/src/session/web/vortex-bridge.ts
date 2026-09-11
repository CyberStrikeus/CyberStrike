// Browser → Vortex bridge. The browser SourceAdapter for Vortex: at the ingest handler, the same
// captured request+response that becomes a CS Request row ALSO becomes a Vortex Transaction, so the
// Vortex engine (rules → signals → subjects → inventory → leads) runs over the live web corpus in
// parallel with the existing CS signal fabric (verify-first; the fabric retires once Vortex proves
// out). Never throws — must not break the ingest path.
import { SqliteStore, defaultRegistry, leads, endpointKey, forAgent, injectPoints, probeSession, send, discoveredId, scanStored, canaryFor, type Vortex, type TrafficStore, type Transaction, type Header, type Lead, type Sender, type Signal, type CanaryKind } from "@cyberstrike-io/vortex"
import { Database } from "bun:sqlite"
import { Global } from "@/global"
import { Log } from "@/util/log"
import { WebRetest } from "./web-retest"
import { categoryToClass, signalPriority, shouldRoute, type VortexSeverity } from "./signal/vortex-route"
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
  normalizedPath?: string // the platform's display path (so the Vortex captures view shows the same path)
  keyHash?: string // the platform's per-endpoint key (so observations resolve off Vortex rows, no drift)
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
      normalizedPath: i.normalizedPath,
      keyHash: i.keyHash,
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
    // Route the new passive signals into the deterministic retest pipeline (issue #14), so a
    // Vortex-found lead reaches its owning specialist without waiting on agent initiative. Additive
    // to the CS signal fabric that scanned the same response; dedup collapses any overlap.
    const routed = bridgeSignals(i.sessionID, store, sigs)
    // Cross-request canary correlation (#15 step 2): scan the observed corpus for any registered
    // canary that renders in a DIFFERENT transaction than it was injected at — a STORED reflection.
    // Emits Vortex `stored-reflection` signals (category "injection"), which the bridge routes to the
    // input-validation specialist like any other Vortex signal. No-op until a canary is registered.
    const stored = scanStored(store)
    if (stored.length > 0) bridgeSignals(i.sessionID, store, stored)
    log.info("vortex ingest", { sessionID: i.sessionID, endpoint: endpointKey(tx), transactions: store.size(), newSignals: added, newParams: points, routed, stored: stored.length, ruleIds: sigs.map((s) => s.ruleId) })
    // Auto-probe the new points in the background when active probing is enabled (no-op otherwise).
    // Fire-and-forget: must not block or break the ingest path.
    kickProbe(i.sessionID)
    return { transactions: store.size(), signals: store.signals().length }
  } catch (e) {
    // A capture that fails to ingest is absent from the Vortex store — and therefore from the
    // Vortex-sourced Captures view and from everything agents see. WARN (not debug) so this drift
    // from what was actually captured is diagnosable; still swallowed so one bad request never
    // aborts the capture stream.
    log.warn("vortex ingest failed — request absent from Vortex source", { sessionID: i.sessionID, requestID: i.requestID, err: String(e) })
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
    // Best-effort so a store hiccup never breaks capture — but WARN (not debug): a swallowed failure
    // means Vortex silently misses a JS asset the session-web copy still has, i.e. the single source
    // drifts. Surfaced so such a gap is diagnosable, not invisible.
    log.warn("vortex discover-js failed — JS missing from Vortex source", { sessionID, url: u, err: String(e) })
  }
}

// The Captures view, sourced entirely from the session's Vortex store — the single source of truth
// the TUI sidebar reads (no divergent session-web copy). `requests` are the captured transactions
// (the sidebar groups them by host and derives distinct pages from pageUrl); `jsFiles` are the
// discovered JS assets. Pure reads over the store.
export interface VortexCaptureRequest {
  id: string
  method: string
  host: string
  // snake_case to match the fields the TUI sidebar row already reads (near drop-in repoint).
  normalized_path: string
  page_url?: string
  key_hash?: string // present → the per-endpoint observations expansion resolves off this Vortex row
  status?: number
  identity?: string
}

function pathFromUrl(url: string): string {
  try {
    return new URL(url).pathname
  } catch {
    const q = url.indexOf("?")
    const noQuery = q === -1 ? url : url.slice(0, q)
    return noQuery.replace(/^[a-z]+:\/\/[^/]+/i, "") || "/"
  }
}

export function vortexCaptures(sessionID: string): { requests: VortexCaptureRequest[]; jsFiles: { url: string; hit: boolean }[] } {
  // A read the TUI polls; a store failure must degrade to an empty view, never 500 the route and
  // blank the sidebar. Return-empty-on-error keeps the sidebar rendering (as "no captures yet")
  // instead of erroring, and the failure is logged for diagnosis.
  try {
    const store = storeFor(sessionID)
    // One row per ENDPOINT (matching the sidebar's "endpoints" label), not per transaction — the same
    // request hit N times must not show N times. Dedup by key_hash when present, else method+path.
    // First occurrence wins, but a later transaction that has a response upgrades the kept row so the
    // status dot reflects a real response rather than a pending first hit.
    const byEndpoint = new Map<string, VortexCaptureRequest>()
    for (const t of store.all()) {
      const normalized_path = t.normalizedPath ?? pathFromUrl(t.request.url)
      const dedupKey = t.keyHash ?? `${t.request.method} ${t.host}${normalized_path}`
      const existing = byEndpoint.get(dedupKey)
      if (existing) {
        if (existing.status === undefined && t.response?.status !== undefined) existing.status = t.response.status
        continue
      }
      byEndpoint.set(dedupKey, {
        id: t.id,
        method: t.request.method,
        host: t.host,
        normalized_path,
        page_url: t.pageUrl,
        key_hash: t.keyHash,
        status: t.response?.status,
        identity: t.identity,
      })
    }
    const requests = [...byEndpoint.values()]
    const jsFiles = store.discovered("js").map((d) => ({ url: d.value, hit: d.hit }))
    return { requests, jsFiles }
  } catch (e) {
    log.warn("vortexCaptures read failed — returning empty", { sessionID, err: String(e) })
    return { requests: [], jsFiles: [] }
  }
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
    const store = storeFor(sessionID)
    const res = await probeSession(store, probeSender())
    // Route the actively-probed signals into the retest pipeline (issue #14) — an active-probe
    // hit is exactly the high-value lead a specialist should confirm without waiting on initiative.
    const routed = bridgeSignals(sessionID, store, res.signals)
    log.info("vortex active-probe", { sessionID, probed: res.probed, signals: res.signals.length, routed })
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

// Register a canary token into this session's Vortex store (#15 step 2), so a later observed page
// that renders it is caught as a cross-request STORED reflection by scanStored at the next ingest.
// Called alongside the CS CanaryRegistry from the agent tools (inject_probe / http_replay) during
// the migration. `requestId` anchors the origin transaction; a synthetic/unknown id (a constructed
// target with no Vortex tx) is skipped — the CS canary still covers that case. Never throws.
export function vortexRegisterCanary(
  sessionID: string,
  input: { token: string; kind?: CanaryKind; requestId: string; field?: string; vulnClass?: string; agent?: string },
): void {
  try {
    const store = storeFor(sessionID)
    const tx = store.get(input.requestId)
    if (!tx) return
    store.addCanaries([canaryFor(input.token, tx, { kind: input.kind, field: input.field, vulnClass: input.vulnClass, agent: input.agent })])
  } catch (e) {
    log.debug("vortex canary register failed (ignored)", { err: String(e) })
  }
}

// ── Vortex signals → retest pipeline bridge (issue #14) ─────────────────────────────
// Route freshly-produced Vortex signals into the deterministic retest queue so the OWNING WSTG
// specialist confirms them — instead of leaving it to an agent's initiative to read vortex_leads
// (the best-effort fragility the retest-worker exists to remove). Additive to the CS signal fabric
// + traffic-driven feeds; dedup is free (WebRetest.flag keys per (key_hash,value), Vortex dedups
// signals per dedupKey). Priority-gated (shouldRoute): only medium+ with an owning class auto-spawn;
// low/info + unmapped categories stay visible in the sidebar but never burn a specialist. Never
// throws — a routing failure must never break the ingest or probe path.
function bridgeSignals(sessionID: string, store: TrafficStore, signals: Signal[]): number {
  let routed = 0
  for (const s of signals) {
    try {
      const severity = s.severity as VortexSeverity
      if (!shouldRoute(s.category, severity)) continue
      const owner = categoryToClass(s.category)
      if (!owner) continue
      const keyHash = store.get(s.transactionId)?.keyHash
      if (!keyHash) continue // no platform key_hash on this tx ⇒ can't anchor a retest (still recorded in Vortex)
      WebRetest.flag({ sessionID, keyHash, type: "signal", value: `${s.category}:${owner}`, priority: signalPriority(severity) })
      routed++
    } catch (e) {
      log.debug("vortex signal bridge failed (ignored)", { ruleId: s.ruleId, err: String(e) })
    }
  }
  return routed
}

// The TUI "Vortex Signals" sidebar view (issue #14): every persisted Vortex signal with its owning
// class, whether it auto-routed, and its endpoint's retest-queue status (pending = queued for a
// specialist, examined = an agent has worked it) — so the operator SEES what Vortex found, what is
// queued, and what got picked up. Degrades to empty on error (never blanks the sidebar hard).
export interface VortexSignalView {
  ruleId: string
  category: string
  severity: string
  title: string
  method?: string
  endpoint?: string
  keyHash?: string
  owner?: string
  routed: boolean
  status?: "pending" | "examined"
}

export function vortexSignals(sessionID: string): { signals: VortexSignalView[] } {
  try {
    const store = storeFor(sessionID)
    const statusMap = WebRetest.statusByKeyHash(sessionID)
    const out: VortexSignalView[] = []
    for (const s of store.signals()) {
      const tx = store.get(s.transactionId)
      const keyHash = tx?.keyHash
      out.push({
        ruleId: s.ruleId,
        category: s.category,
        severity: s.severity,
        title: s.title,
        method: tx?.request.method,
        endpoint: tx?.normalizedPath,
        keyHash,
        owner: categoryToClass(s.category),
        routed: shouldRoute(s.category, s.severity as VortexSeverity),
        status: keyHash ? statusMap[keyHash] : undefined,
      })
    }
    const rank: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 }
    out.sort((a, b) => (rank[a.severity] ?? 5) - (rank[b.severity] ?? 5))
    return { signals: out }
  } catch (e) {
    log.warn("vortexSignals read failed — returning empty", { sessionID, err: String(e) })
    return { signals: [] }
  }
}
