// Browser → Vortex bridge. The browser SourceAdapter for Vortex: at the ingest handler, the same
// captured request+response that becomes a CS Request row ALSO becomes a Vortex Transaction, so the
// Vortex engine (rules → signals → subjects → inventory → leads) runs over the live web corpus in
// parallel with the existing CS signal fabric (verify-first; the fabric retires once Vortex proves
// out). Never throws — must not break the ingest path.
import { SqliteStore, defaultRegistry, leads, endpointKey, forAgent, injectPoints, probeSession, send, type Vortex, type TrafficStore, type Transaction, type Header, type Lead, type Sender } from "@cyberstrike-io/vortex"
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
  return forAgent(storeFor(sessionID))
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

// ACTIVE injection probing on the live corpus — the ONLY path in Vortex that SENDS attacker payloads
// to the target. Double-gated so nothing fires by accident: (1) it only runs when explicitly called
// (never inline in ingest), and (2) it is a no-op unless CYBERSTRIKE_VORTEX_ACTIVE_PROBE is set.
// When on, it probes each not-yet-probed inject point through a governed, rate-limited, replay-safe
// sender and persists the signals + coverage. Never throws.
const ACTIVE_PROBE = process.env.CYBERSTRIKE_VORTEX_ACTIVE_PROBE === "1" || process.env.CYBERSTRIKE_VORTEX_ACTIVE_PROBE === "true"
const PROBE_MIN_INTERVAL_MS = Math.max(0, Number(process.env.CYBERSTRIKE_VORTEX_PROBE_INTERVAL_MS) || 200) // ~5 rps default

export async function vortexProbe(sessionID: string): Promise<{ enabled: boolean; probed: number; signals: number }> {
  if (!ACTIVE_PROBE) return { enabled: false, probed: 0, signals: 0 }
  const store = storeFor(sessionID)
  // Rate-limited, governed sender: a small pre-send delay caps throughput (probeSession sends
  // sequentially), and Vortex's own send() enforces replay-safety + a per-send timeout.
  let last = 0
  const sender: Sender = async (input, opts) => {
    const wait = PROBE_MIN_INTERVAL_MS - (Date.now() - last)
    if (wait > 0) await new Promise((r) => setTimeout(r, wait))
    last = Date.now()
    return send(input, { ...opts, timeoutMs: opts?.timeoutMs ?? 15_000, followRedirects: false })
  }
  try {
    const res = await probeSession(store, sender)
    log.info("vortex active-probe", { sessionID, probed: res.probed, signals: res.signals.length })
    return { enabled: true, probed: res.probed, signals: res.signals.length }
  } catch (e) {
    log.debug("vortex active-probe failed (ignored)", { err: String(e) })
    return { enabled: true, probed: 0, signals: 0 }
  }
}
