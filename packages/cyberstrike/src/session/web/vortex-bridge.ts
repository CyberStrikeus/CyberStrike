// Browser → Vortex bridge. The browser SourceAdapter for Vortex: at the ingest handler, the same
// captured request+response that becomes a CS Request row ALSO becomes a Vortex Transaction, so the
// Vortex engine (rules → signals → subjects → inventory → leads) runs over the live web corpus in
// parallel with the existing CS signal fabric (verify-first; the fabric retires once Vortex proves
// out). Never throws — must not break the ingest path.
import { SqliteStore, defaultRegistry, registerPlugin, leads, endpointKey, forAgent, injectPoints, probeSession, send, discoveredId, scanStored, canaryFor, subjects, humanName, params, responseFields as txResponseFields, type Vortex, type TrafficStore, type Transaction, type Header, type Lead, type Sender, type Signal, type CanaryKind, type VortexPlugin, type Discovered } from "@cyberstrike-io/vortex"
import { Database } from "bun:sqlite"
import { Global } from "@/global"
import { Log } from "@/util/log"
import { WebInspect } from "./web-inspect"
import { WebObject } from "./web-object"
import { WebFunction } from "./web-function"
import { WebRole } from "./web-role"
import { ownerForSignal, signalPriority, shouldRoute, type VortexSeverity } from "./signal/vortex-route"
import path from "path"

const log = Log.create({ service: "vortex-bridge" })

// One DURABLE, session-scoped Vortex store per session — backed by a single shared bun:sqlite file
// under the app data dir (SqliteStore scopes every op by session, so one file holds all sessions
// without bleeding). Survives restarts and holds thousands of requests (not memory). The rule
// registry (baseline catalog) is shared across sessions.
const stores = new Map<string, TrafficStore>()
let db: Database | undefined
let dbPath: string | undefined
function database(): Database {
  const p = path.join(Global.Path.data, "vortex.db")
  // Re-open (and drop the per-session store cache) when the data dir changes — e.g. a new Instance in
  // tests, or a project switch. In production the path is stable, so this opens exactly once.
  if (!db || dbPath !== p) {
    db = new Database(p)
    dbPath = p
    stores.clear()
  }
  return db
}
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

// Enterprise extension seam: register a Vortex plugin (e.g. jsmine's JS-miner) onto the shared
// registry so its per-transaction hooks run at ingest (see the extractor block in
// ingestBrowserTransaction). Called ONCE by an Enterprise-only bootstrap at startup — core
// cyberstrike never imports the plugin package, so the free build simply never calls this and the
// hook list stays empty (the ingest block is a guarded no-op). Idempotent-friendly: the shared
// registry is process-wide, so one registration covers every session.
export function registerVortexExtractor(plugin: VortexPlugin): void {
  registerPlugin(registry, plugin)
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
    bridgeSubjects(i.sessionID, tx, i.requestID)
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
    // Extractor plugins (Enterprise jsmine JS-miner) — run any registered per-transaction hooks and
    // bridge what they produce: discovered endpoints/JS land in the inventory, secret signals route
    // to their WSTG owner (information-gathering). Re-bridging this tx's already-routed signals is
    // idempotent (WebInspect dedups). No-op on the free/default build — no extractor plugin registered.
    if (registry.listHooks().length > 0) {
      registry.runHooks(store, tx)
      bridgeSignals(i.sessionID, store, store.signals({ transactionId: tx.id }))
    }
    // Cross-request canary correlation (#15 step 2): scan the observed corpus for any registered
    // canary that renders in a DIFFERENT transaction than it was injected at — a STORED reflection.
    // Emits Vortex `stored-reflection` signals (category "injection"), which the bridge routes to the
    // input-validation specialist like any other Vortex signal. GUARDED on canary presence: with no
    // canary registered (the whole crawl phase, before an agent injects) scanStored is skipped, so
    // per-hit ingest — now on EVERY hit (slice 0) — never pays the O(txs) corpus scan for nothing.
    let stored = 0
    if (store.canaries().length > 0) {
      const storedSignals = scanStored(store)
      stored = storedSignals.length
      if (stored > 0) bridgeSignals(i.sessionID, store, storedSignals)
    }
    log.info("vortex ingest", { sessionID: i.sessionID, endpoint: endpointKey(tx), transactions: store.size(), newSignals: added, newParams: points, routed, stored, ruleIds: sigs.map((s) => s.ruleId) })
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

// JS-body ingest (issue #22). The capture extension can't read response bodies (MV3), so first-party
// JS bundles are fetched out-of-band by JsMiner. Persist each fetched body into Vortex as an OBSERVED
// transaction so the full DSL rule engine (secret-in-response, tech/version, vuln-library, the JS rule
// packs) runs over the script AND — when the Enterprise jsmine extractor is registered — its hook
// mines endpoints/secrets/source maps. This makes JS analysis re-scannable OFFLINE (no re-fetch): a
// new rule sweeps the stored bodies. Scope: JsMiner only fetches in-scope (first-party) JS; CDN/vendor
// bundles are out-of-scope, so they never reach here — they stay URL-only (vortexDiscoverJs) and their
// version is flagged by the req.url→CVE rules without storing the vendor body. Body is size-capped and
// the tx id is URL-stable, so re-mining the same bundle REPLACES its row rather than duplicating it.
const JS_BODY_CAP = Math.max(0, Number(process.env.CYBERSTRIKE_VORTEX_JS_BODY_CAP) || 2_000_000)
export function ingestJsBody(sessionID: string, url: string, body: string, status = 200): { signals: number } {
  try {
    if (!url || !body) return { signals: 0 }
    let host: string
    try {
      host = new URL(url).host
    } catch {
      return { signals: 0 } // a non-absolute ref never becomes a transaction
    }
    const store = storeFor(sessionID)
    const text = body.length > JS_BODY_CAP ? body.slice(0, JS_BODY_CAP) : body
    const tx: Transaction = {
      id: `jsbody:${url}`, // URL-stable → idempotent (INSERT OR REPLACE): one row per bundle, re-mine safe
      session: sessionID,
      source: "browser", // OBSERVED — so scan()/extract() include it (a "replay" tx would be excluded)
      host,
      pageUrl: url,
      request: { method: "GET", url, headers: [] },
      response: { status, headers: [{ name: "content-type", value: "application/javascript" }], body: text },
    }
    store.add(tx)
    const sigs = registry.run(tx) // core DSL rules over the JS body (secret-in-response / tech / cve / JS packs)
    const added = store.addSignals(sigs)
    let routed = bridgeSignals(sessionID, store, sigs)
    // Enterprise extractor (jsmine): endpoints/JS land in the inventory, secret + source-map signals
    // route to their WSTG owner. No-op on the free build (no hook registered).
    if (registry.listHooks().length > 0) {
      registry.runHooks(store, tx)
      routed += bridgeSignals(sessionID, store, store.signals({ transactionId: tx.id }))
    }
    log.info("vortex js-body ingest", { sessionID, url, bytes: text.length, newSignals: added, routed, ruleIds: sigs.map((s) => s.ruleId) })
    return { signals: added }
  } catch (e) {
    // Best-effort — a JS body that fails to ingest is simply not analyzed; never break the mining pass.
    log.warn("vortex js-body ingest failed", { sessionID, url, err: String(e) })
    return { signals: 0 }
  }
}

// --- Referenced-vs-loaded evidence (issue #22) ---------------------------------------------------
// A JS asset can be shipped/referenced without the app ever loading it — reporting a vuln in such a
// dead asset is the classic "we don't load that" false positive. The capture extension now reports the
// browser's OWN load record (PerformanceResourceTiming) and the libraries live at runtime; we persist
// both so a JS finding can be scoped to what the app truly loaded/executed.

const LOAD_RANK: Record<string, number> = { referenced: 0, preloaded: 1, loaded: 2, executed: 3 }
type LoadState = NonNullable<Discovered["loadState"]>

// Record what the page actually LOADED (from performance timing). Upserts each JS URL's loadState in
// the discovered inventory, keeping the strongest state seen (never downgrades executed→referenced).
// NOT scope-filtered: a CDN/vendor load is evidence, not a probe target. Returns rows touched.
export function vortexRecordLoads(sessionID: string, resources: { url: string; type: string; size: number }[]): number {
  try {
    const store = storeFor(sessionID)
    const existing = new Map(store.discovered("js").map((d) => [d.value, d]))
    const items: Discovered[] = []
    for (const r of resources) {
      if (!r.url || !/^https?:\/\//i.test(r.url)) continue
      const incoming: LoadState = r.type === "script" ? "executed" : r.size > 0 ? "loaded" : "preloaded"
      const prev = existing.get(r.url)
      const loadState: LoadState = prev?.loadState && LOAD_RANK[prev.loadState]! >= LOAD_RANK[incoming]! ? prev.loadState : incoming
      items.push({ id: discoveredId("js", r.url), kind: "js", value: r.url, fromTransaction: prev?.fromTransaction, source: prev?.source ?? "perf", hit: true, loadState })
    }
    if (!items.length) return 0
    store.addDiscovered(items)
    log.info("vortex record loads", { sessionID, count: items.length })
    return items.length
  } catch (e) {
    log.warn("vortex record loads failed", { sessionID, err: String(e) })
    return 0
  }
}

// Known-vulnerable library versions, matched against the RUNTIME version (a live global) — the highest
// confidence there is: the library provably loaded AND executed. Complements the URL-based cve.ts rules
// (which fire on a CDN <script src> version) and covers bundled libs that expose a global but have no
// standalone URL. `below` is exclusive; angularjs 1.x is wholly EOL, so any version is flagged.
const RUNTIME_VULN: { lib: string; below: string; severity: Signal["severity"]; note: string }[] = [
  { lib: "jquery", below: "3.5.0", severity: "medium", note: "XSS via htmlPrefilter (CVE-2020-11022/11023) — upgrade ≥3.5.0" },
  { lib: "lodash", below: "4.17.21", severity: "high", note: "prototype pollution / ReDoS (CVE-2020-8203, CVE-2021-23337) — upgrade ≥4.17.21" },
  { lib: "moment", below: "2.29.4", severity: "medium", note: "ReDoS + path traversal (CVE-2022-24785, CVE-2022-31129) — upgrade ≥2.29.4" },
  { lib: "bootstrap", below: "4.3.1", severity: "medium", note: "XSS in data-* attributes (CVE-2019-8331) — upgrade ≥4.3.1" },
  { lib: "handlebars", below: "4.7.7", severity: "high", note: "prototype pollution / RCE in compiler (CVE-2019-19919, CVE-2021-23369) — upgrade ≥4.7.7" },
  { lib: "axios", below: "0.21.2", severity: "medium", note: "SSRF + credential leak on redirect (CVE-2020-28168, CVE-2021-3749) — upgrade ≥0.21.2" },
  { lib: "angularjs", below: "999.0.0", severity: "medium", note: "AngularJS 1.x is End-of-Life — no security fixes; migrate off" },
]
function cmpVersion(a: string, b: string): number {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0)
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d < 0 ? -1 : 1
  }
  return 0
}

// Record libraries executing at runtime ("name@version"). Each becomes a high-confidence technology
// signal, and a known-vulnerable version becomes a runtime-CONFIRMED vulnerable-component finding —
// the direct answer to "we ship it but don't load it": the global is live, so it demonstrably ran.
export function vortexRecordRuntimeLibs(sessionID: string, libs: string[], pageUrl?: string): number {
  try {
    const store = storeFor(sessionID)
    const txId = `runtime:${sessionID}` // synthetic observed anchor — a runtime fact has no HTTP tx of its own
    if (!store.get(txId)) {
      let host = "runtime"
      try {
        if (pageUrl) host = new URL(pageUrl).host
      } catch {}
      store.add({ id: txId, session: sessionID, source: "browser", host, pageUrl, request: { method: "GET", url: pageUrl ?? "about:runtime", headers: [] } } as Transaction)
    }
    const sigs: Signal[] = []
    for (const entry of libs) {
      const at = entry.indexOf("@")
      if (at <= 0) continue
      const lib = entry.slice(0, at).toLowerCase()
      const version = entry.slice(at + 1)
      if (!version) continue
      sigs.push({ ruleId: "runtime-library", transactionId: txId, severity: "info", category: "technology", title: `Runtime library: ${lib} ${version}`, evidence: entry, dedupKey: `runtime-library:${lib}:${version}` })
      const vuln = RUNTIME_VULN.find((v) => v.lib === lib && cmpVersion(version, v.below) < 0)
      if (vuln) sigs.push({ ruleId: `runtime-vuln-${lib}`, transactionId: txId, severity: vuln.severity, category: "vulnerable-component", title: `Outdated ${lib} ${version} (runtime-confirmed loaded): ${vuln.note}`, evidence: entry, dedupKey: `runtime-vuln:${lib}:${version}` })
    }
    if (!sigs.length) return 0
    const added = store.addSignals(sigs)
    bridgeSignals(sessionID, store, sigs)
    log.info("vortex record runtime libs", { sessionID, libs: libs.length, newSignals: added })
    return added
  } catch (e) {
    log.warn("vortex record runtime libs failed", { sessionID, err: String(e) })
    return 0
  }
}

// Vortex→WebObject/WebFunction/WebRole bridge (Part D): deterministic extraction replaces wstg-analyzer.
// Runs subjects() on the transaction and writes to the SQLite tables the TUI sidebar, session context,
// and ingest-summary all read from — so all downstream consumers work without change.
function bridgeSubjects(sessionID: string, tx: Transaction, requestID: string): void {
  try {
    const s = subjects(tx)
    const p = params(tx)
    const respFields = txResponseFields(tx)
    const allReqFields = Object.keys({ ...p.query, ...p.body })
    const allRespFields = Object.keys(respFields)

    if (s.role) {
      const existing = WebRole.getByName(sessionID, s.role)
      if (!existing) WebRole.add({ sessionID, name: s.role, discoveredFrom: "vortex" })
    }

    const roleObj = s.role ? WebRole.getByName(sessionID, s.role) : undefined

    for (const o of s.objects) {
      const obj = WebObject.add({
        sessionID,
        name: o.resource ?? o.ref,
        fields: allReqFields.concat(allRespFields),
        sensitiveFields: allReqFields.concat(allRespFields).filter((f) => /^(password|passwd|pwd|secret|token|api_?key|private_?key|access_?key|ssn|social_?security|credit_?card|card_?number|cvv|cvc|pin|auth|authorization|session|cookie|bearer)/i.test(f.split(".").pop() ?? f)),
        idFields: allReqFields.concat(allRespFields).filter((f) => /(_id|Id|_uuid|_ref|_key)$|^id$/i.test(f.split(".").pop() ?? f)),
        discoveredFrom: "vortex",
      })
      WebObject.addValue({
        sessionID,
        objectID: obj.id,
        fieldName: o.name ?? "id",
        value: o.value,
        credentialID: tx.identity,
        discoveredFrom: "vortex",
      })
    }

    const funcName = humanName(s.function.method, s.function.endpoint)
    WebFunction.add({
      sessionID,
      name: funcName,
      actionType: s.function.crud,
      requestID,
      roleID: roleObj?.id,
      objects: s.objects.map((o) => o.ref),
    })
  } catch (e) {
    log.debug("bridgeSubjects failed (ignored)", { sessionID, err: String(e) })
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
export function vortexDiscoverJs(sessionID: string, url: string, loadState?: LoadState): void {
  const u = String(url || "").trim()
  if (!u) return
  try {
    const store = storeFor(sessionID)
    // Keep the strongest load state ever seen for this URL (a later "referenced" must not clobber an
    // earlier "loaded"/"executed"). #22: script-src ⇒ referenced, a captured network response ⇒ loaded.
    const prev = store.discovered("js").find((d) => d.value === u)
    let state = loadState
    if (prev?.loadState && (!state || LOAD_RANK[prev.loadState]! >= LOAD_RANK[state]!)) state = prev.loadState
    const hit = state === "loaded" || state === "executed" ? true : (prev?.hit ?? false)
    store.addDiscovered([{ id: discoveredId("js", u), kind: "js", value: u, source: prev?.source ?? "extract", fromTransaction: prev?.fromTransaction, hit, loadState: state }])
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

// ── Programmatic signal recording (#15 step 2) ────────────────────────────────────────
// Write a tool-produced signal (reflected_input, rate_limit_absent, etc.) directly into
// the session's Vortex store AND route it through the retest bridge — so tool findings
// appear in vortexSignals() (the agent's context) and trigger the right specialist
// exactly as passive Vortex-rule signals do. `transactionId` must be a Vortex-known tx
// id (a captured request id). Never throws — a write failure is swallowed and logged,
// just like the rest of the bridge.
export function vortexRecordSignal(
  sessionID: string,
  input: { ruleId: string; transactionId: string; category: string; severity: string; title: string; evidence?: string },
): void {
  try {
    const store = storeFor(sessionID)
    const tx = store.get(input.transactionId)
    if (!tx) return
    const sig: Signal = {
      ruleId: input.ruleId,
      transactionId: input.transactionId,
      severity: input.severity as "high" | "medium" | "low" | "info",
      category: input.category,
      title: input.title,
      evidence: input.evidence,
      dedupKey: `${input.ruleId}:${endpointKey(tx)}`,
    }
    store.addSignals([sig])
    bridgeSignals(sessionID, store, [sig])
  } catch (e) {
    log.debug("vortexRecordSignal failed (ignored)", { err: String(e) })
  }
}

// Run Vortex rules over a probe response that didn't come through the browser ingest
// path (inject_probe / http_replay tool sends). Creates a synthetic transaction scoped
// to the origin request, runs the per-tx rule registry, persists + bridges the signals.
// Never throws — a failure must not break the probe loop.
export function vortexScanProbeResponse(
  sessionID: string,
  input: { requestId: string; method: string; url: string; status: number; headers: Record<string, string>; body: string },
): number {
  try {
    const store = storeFor(sessionID)
    const originTx = store.get(input.requestId)
    if (!originTx) return 0
    const headers: Header[] = []
    for (const name in input.headers) headers.push({ name, value: input.headers[name]! })
    const probeTx: Transaction = {
      id: `probe:${input.requestId}:${Date.now()}`,
      session: sessionID,
      source: "replay",
      host: originTx.host,
      keyHash: originTx.keyHash,
      normalizedPath: originTx.normalizedPath,
      request: { method: input.method, url: input.url, headers: originTx.request.headers, body: undefined },
      response: { status: input.status, headers, body: input.body },
    }
    const sigs = registry.run(probeTx)
    if (sigs.length === 0) return 0
    // Anchor signals to the ORIGIN transaction so they show up under the right endpoint.
    const anchored = sigs.map((s) => ({ ...s, transactionId: input.requestId }))
    store.addSignals(anchored)
    bridgeSignals(sessionID, store, anchored)
    return anchored.length
  } catch (e) {
    log.debug("vortexScanProbeResponse failed (ignored)", { err: String(e) })
    return 0
  }
}

// ── Vortex signals → retest pipeline bridge (issue #14) ─────────────────────────────
// Route freshly-produced Vortex signals into the deterministic retest queue so the OWNING WSTG
// specialist confirms them — instead of leaving it to an agent's initiative to read vortex_leads
// (the best-effort fragility the retest-worker exists to remove). Additive to the CS signal fabric
// + traffic-driven feeds; dedup is free (WebInspect.flag keys per (key_hash,value), Vortex dedups
// signals per dedupKey). Priority-gated (shouldRoute): only medium+ with an owning class auto-spawn;
// low/info + unmapped categories stay visible in the sidebar but never burn a specialist. Never
// throws — a routing failure must never break the ingest or probe path.
function bridgeSignals(sessionID: string, store: TrafficStore, signals: Signal[]): number {
  let routed = 0
  for (const s of signals) {
    try {
      const severity = s.severity as VortexSeverity
      if (!shouldRoute(s.category, severity)) continue
      const owner = ownerForSignal(s.ruleId, s.category)
      if (!owner) continue
      const keyHash = store.get(s.transactionId)?.keyHash
      if (!keyHash) continue // no platform key_hash on this tx ⇒ can't anchor a retest (still recorded in Vortex)
      // A technology signal carries its stack slug as a 3rd ":"-segment (ruleId `tech-<slug>`), so the
      // retest dispatch injects that stack's TechPlaybook — parity with the CS technology path.
      const value =
        s.category === "technology"
          ? `${s.category}:${owner}:${s.ruleId.replace(/^tech-/, "")}`
          : `${s.category}:${owner}`
      WebInspect.flag({ sessionID, keyHash, type: "signal", value, priority: signalPriority(severity) })
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
  // Free-form supporting detail. For aggregate ("one finding, many URLs") signals this carries the
  // enumerated affected-endpoint list — the report needs it, so it must reach the agent, not be dropped.
  evidence?: string
  requestId: string // the originating transaction id (== the CS request id — works with web_get_request_detail)
  method?: string
  endpoint?: string
  keyHash?: string
  owner?: string
  routed: boolean
  status?: "pending" | "examined"
  // For a JS-origin finding: whether the app actually loaded/executed the asset it fired on (#22).
  // "referenced" = shipped but the page was never observed loading it → the finding is down-ranked
  // (the classic "we don't load that" false positive). Absent for non-JS findings and unknown loads.
  loadState?: LoadState
}

export function vortexSignals(sessionID: string): { signals: VortexSignalView[] } {
  try {
    const store = storeFor(sessionID)
    // Materialize cross-transaction findings before reading. Per-tx rules run incrementally at ingest,
    // but CORPUS rules (access-control, chains, and the aggregate "one finding, many URLs" rules —
    // CORS etc.) only fire over the whole corpus. Run just those here (cheap: corpus rules only) and
    // persist them; addSignals dedups by dedupKey, so this is idempotent across repeated reads. Without
    // it an aggregate finding never reaches the sidebar or the agent's session context.
    try {
      store.addSignals(registry.analyzeCorpus(store.all()))
    } catch (e) {
      log.debug("vortex corpus analyze failed (ignored)", { err: String(e) })
    }
    const statusMap = WebInspect.statusByKeyHash(sessionID)
    // Referenced-vs-loaded reconciliation (#22): a JS-origin finding inherits the load state of the
    // asset it fired on, so a finding on JS the app never actually loaded is flagged + down-ranked.
    const loadByUrl = new Map<string, LoadState | undefined>(store.discovered("js").map((d) => [d.value, d.loadState]))
    const loadStateFor = (s: Signal, tx?: Transaction): LoadState | undefined => {
      if (s.transactionId.startsWith("runtime:")) return "executed" // a live global provably ran
      const url = tx?.request.url
      if (!url) return undefined
      if (loadByUrl.has(url)) return loadByUrl.get(url)
      return undefined
    }
    const out: VortexSignalView[] = []
    for (const s of store.signals()) {
      const tx = store.get(s.transactionId)
      const keyHash = tx?.keyHash
      out.push({
        ruleId: s.ruleId,
        category: s.category,
        severity: s.severity,
        title: s.title,
        evidence: s.evidence,
        requestId: s.transactionId,
        method: tx?.request.method,
        endpoint: tx?.normalizedPath,
        keyHash,
        owner: ownerForSignal(s.ruleId, s.category),
        routed: shouldRoute(s.category, s.severity as VortexSeverity),
        status: keyHash ? statusMap[keyHash] : undefined,
        loadState: loadStateFor(s, tx),
      })
    }
    const rank: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 }
    // Within a severity, sort by how strongly the asset loaded (executed → referenced), so a
    // "referenced, never loaded" finding sinks below confirmed-loaded ones. Non-JS findings (no
    // loadState) sit neutrally in the middle so their order is unchanged.
    const loadOrder = (ls?: LoadState) => (ls === undefined ? 2 : LOAD_RANK[ls]!)
    out.sort((a, b) => (rank[a.severity] ?? 5) - (rank[b.severity] ?? 5) || loadOrder(b.loadState) - loadOrder(a.loadState))
    return { signals: out }
  } catch (e) {
    log.warn("vortexSignals read failed — returning empty", { sessionID, err: String(e) })
    return { signals: [] }
  }
}
