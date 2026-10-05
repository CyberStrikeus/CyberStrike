import {
  injectPoints,
  mutationForPoint,
  mintCanary,
  canaryFor,
  endpointKey,
  type Transaction,
  type Signal,
  type Sender,
  type TrafficStore,
  type InjectPoint,
} from "@cyberstrike-io/vortex"
import { Log } from "@/util/log"
import { OobStore } from "../../oob/store"
import { Oob } from "../../oob/client"

const log = Log.create({ service: "ssrf-probe" })

// SSRF out-of-band probe (#89). Unlike the in-band injection classes, SSRF is ASYNCHRONOUS: we inject a
// unique OOB host (the #85 server) into a url-ish param and the target reaches it LATER — so detection
// cannot be synchronous. The flow is send → record-pending → reconcile(poll the OOB store) → signal.
// Vortex stays OOB-agnostic; this lives on the bridge side where the OOB store is.
export namespace Ssrf {
  // url-ish param families where a URL/host value plausibly reaches a server-side fetch. Broader than
  // open-redirect: SSRF sinks include image/webhook/feed/proxy/avatar/fetch, not just redirect targets.
  const URL_FAMILY = /url|uri|host|webhook|callback|image|img|src|dest|destination|feed|rss|proxy|fetch|load|domain|target|link|site|endpoint|avatar|icon|photo|remote|upstream|origin|forward/i
  const PROBE_TYPES = new Set(["string", "empty"])
  const MAX_POINTS_PER_PASS = Math.max(1, Number(process.env.CYBERSTRIKE_SSRF_MAX_POINTS) || 20)
  const PENDING_TTL_MS = Math.max(30_000, Number(process.env.CYBERSTRIKE_SSRF_TTL_MS) || 120_000)

  interface Pending {
    token: string
    host: string
    txId: string
    endpoint: string
    param: { location: InjectPoint["location"]; dotpath: string; name?: string }
    at: number
  }

  // Per-session pending probes (token → context) + the set of points already SSRF-probed this session
  // (so a point is not re-injected on every pass). In-memory: a hunt is one agentic session; a restart
  // interrupts it anyway, and a lost pending SSRF is re-probed when the point is seen again.
  const pending = new Map<string, Map<string, Pending>>()
  const seen = new Map<string, Set<string>>()

  function pendingFor(sessionID: string): Map<string, Pending> {
    const m = pending.get(sessionID) ?? new Map<string, Pending>()
    if (!pending.has(sessionID)) pending.set(sessionID, m)
    return m
  }
  function seenFor(sessionID: string): Set<string> {
    const s = seen.get(sessionID) ?? new Set<string>()
    if (!seen.has(sessionID)) seen.set(sessionID, s)
    return s
  }

  export function pendingCount(sessionID: string): number {
    return pending.get(sessionID)?.size ?? 0
  }

  function applies(pt: InjectPoint): boolean {
    if (!PROBE_TYPES.has(pt.valueType)) return false
    return URL_FAMILY.test(`${pt.name ?? ""} ${pt.dotpath}`)
  }

  // Send an OOB URL into every not-yet-probed url-ish point (bounded). Records a pending entry per send
  // and registers a `callback` canary for traceability. Skips entirely when OOB is not configured.
  // `deps` lets tests inject the domain + sender without a live OOB server.
  export async function probe(
    sessionID: string,
    store: TrafficStore,
    send: Sender,
    deps: { domain?: string } = {},
  ): Promise<{ sent: number }> {
    const domain = deps.domain ?? Oob.domain()
    if (!domain) return { sent: 0 } // OOB not configured — nothing to confirm against

    const seenSet = seenFor(sessionID)
    const pend = pendingFor(sessionID)
    let sent = 0
    for (const pt of store.injectPoints()) {
      if (sent >= MAX_POINTS_PER_PASS) break
      if (!applies(pt)) continue
      const tx = store.get(pt.transactionId)
      if (!tx) continue
      const endpoint = endpointKey(tx)
      const key = `${endpoint}:${pt.location}:${pt.dotpath}`
      if (seenSet.has(key)) continue
      seenSet.add(key)

      const token = mintCanary() // reuse the canary mint for the unique OOB label
      const host = `${token}.${domain}`
      try {
        store.addCanaries([canaryFor(token, tx, { kind: "callback", field: pt.dotpath, vulnClass: "ssrf" })])
      } catch {
        /* canary registration is traceability only — never block the probe */
      }
      // Inject the OOB URL. followRedirects is governed by the sender; the server-side fetch (the SSRF
      // sink) is what we are after, confirmed out-of-band — we do not read this response.
      try {
        await send(tx, { mutations: [mutationForPoint(pt, `http://${host}/`)] })
      } catch {
        /* a failed send just means no pending confirmation for this one — don't abort the pass */
        continue
      }
      pend.set(token, {
        token,
        host,
        txId: pt.transactionId,
        endpoint,
        param: { location: pt.location, dotpath: pt.dotpath, name: pt.name },
        at: Date.now(),
      })
      sent++
    }
    if (sent > 0) log.info("ssrf probes sent", { sessionID, sent, pending: pend.size })
    return { sent }
  }

  // Poll the OOB store for each pending token; a captured callback confirms blind SSRF → one signal,
  // added to the store and returned for routing. Expires pending older than the TTL. `read` is injectable
  // for tests. Does NOT route (the bridge owns routing) — it persists + returns the confirmed signals.
  export async function reconcile(
    sessionID: string,
    store: TrafficStore,
    read: (token: string) => Promise<OobStore.Interaction[]> = Oob.readInteractions,
  ): Promise<Signal[]> {
    const pend = pending.get(sessionID)
    if (!pend || pend.size === 0) return []
    const out: Signal[] = []
    const now = Date.now()
    for (const [token, p] of [...pend]) {
      if (now - p.at > PENDING_TTL_MS) {
        pend.delete(token) // never confirmed within the window — stop polling it
        continue
      }
      let hits: OobStore.Interaction[] = []
      try {
        hits = await read(token)
      } catch {
        continue // transient read failure — keep the pending entry, retry next pass
      }
      if (hits.length === 0) continue
      pend.delete(token)
      const first = hits[0]!
      const sig: Signal = {
        ruleId: "ssrf-oob",
        transactionId: p.txId,
        severity: "high",
        category: "injection",
        title: `Blind SSRF confirmed at ${p.endpoint} (${p.param.name ?? p.param.dotpath}) — out-of-band callback`,
        evidence: `Injected OOB host ${p.host} into ${p.param.location}.${p.param.dotpath}; the target made ${hits.length} callback(s): ${first.protocol.toUpperCase()} from ${first.remoteAddr} at ${new Date(first.at).toISOString()}`,
        param: { location: p.param.location, dotpath: p.param.dotpath, name: p.param.name },
        dedupKey: `ssrf-oob:${p.endpoint}:${p.param.dotpath}`,
      }
      try {
        store.addSignals([sig])
      } catch {
        /* persistence failure — still return it so the caller can route */
      }
      out.push(sig)
    }
    if (out.length > 0) log.info("ssrf confirmed via OOB callback", { sessionID, confirmed: out.length })
    return out
  }

  // Test/teardown: drop a session's SSRF state.
  export function clear(sessionID: string): void {
    pending.delete(sessionID)
    seen.delete(sessionID)
  }
}
