// API-direct fast test lane (discovery-fast-testing-plan §D). The deterministic-first half of
// testing: for every known endpoint, run a small set of cheap probes BEFORE spending any LLM, and
// turn a hit into a queued specialist retest via the signal fabric / retest queue. This is the
// model-on-hit path that makes API-first testing fast, instead of one LLM sub-agent per endpoint.
//
// SAFETY: the autonomous sweep replays real requests, so it only probes SAFE (non-mutating) GET/
// HEAD endpoints and never sends PUT/DELETE/POST autonomously — mutation is left to an LLM
// specialist that can reason about idempotency. The probe builders themselves are PURE (mutate a
// base HttpMessage); send + credential list are injected so the lane unit-tests with no network.
import { HttpMessage } from "@/replay/message"
import { Mutate } from "@/replay/mutate"
import { Send } from "@/replay/send"
import { Bus } from "@/bus"
import { Database, eq } from "../../storage/db"
import { RequestTable } from "../session.sql"
import { WebCredential, COMMON_AUTH_HEADERS } from "./web-credential"
import { WebInspect } from "./web-inspect"
import { WebScope } from "./scope"
import { DataCollector } from "./data-collector"
import { Request } from "../request"
import { scanProbeResponse } from "./signal/ingest"
import { governedSend } from "@/replay/govern"
import { Instance } from "@/project/instance"
import { Log } from "@/util/log"
import { createHash } from "node:crypto"

export namespace ApiProbe {
  const log = Log.create({ service: "api-probe" })

  // Only these methods are replayed autonomously — they don't change server state.
  const SAFE_METHODS = new Set(["GET", "HEAD"])
  const is2xx = (s: number | null | undefined) => !!s && s >= 200 && s < 300

  export interface Probe {
    name: string
    // Return the mutated request, or null when the probe does not apply to this endpoint.
    build(base: HttpMessage.Request): HttpMessage.Request | null
  }

  // Query keys present on the target (for the error canary).
  function queryKeys(target: string): string[] {
    const q = target.indexOf("?")
    if (q < 0) return []
    return target
      .slice(q + 1)
      .split("&")
      .map((p) => p.split("=")[0])
      .filter(Boolean)
  }

  function stripAuth(msg: HttpMessage.Request): { out: HttpMessage.Request; removed: boolean } {
    let out = msg
    let removed = false
    for (const h of msg.headers) {
      if (COMMON_AUTH_HEADERS.includes(h.name.toLowerCase())) {
        out = Mutate.removeHeader(out, h.name)
        removed = true
      }
    }
    return { out, removed }
  }

  function hostOf(origin: string): string {
    try {
      return new URL(origin).host.toLowerCase()
    } catch {
      return ""
    }
  }

  // ── The deterministic probe set ────────────────────────────────────────────
  // auth-strip: remove auth headers → unauthenticated access = broken access control.
  const authStrip: Probe = { name: "auth-strip", build: (base) => (stripAuth(base).removed ? stripAuth(base).out : null) }

  // error-canary: inject a single quote into a query param → SQL/engine error signature.
  const errorCanary: Probe = {
    name: "error-canary",
    build(base) {
      const keys = queryKeys(base.target)
      if (keys.length === 0) return null // no param to tamper (path/body injection is the LLM's job)
      let out = base
      for (const k of keys) out = Mutate.setQuery(out, k, "'")
      return out
    },
  }

  // method swap → find methods the server wrongly allows. Only non-mutating methods run autonomously.
  function methodProbe(method: string): Probe {
    return { name: `method-${method}`, build: (base) => (base.method.toUpperCase() === method ? null : Mutate.setMethod(base, method)) }
  }

  // Full builder set (usable by an LLM specialist that reasons about idempotency).
  export const PROBES: Probe[] = [authStrip, errorCanary, methodProbe("PUT"), methodProbe("DELETE"), methodProbe("TRACE")]
  // The subset the AUTONOMOUS sweep is allowed to send — all non-mutating.
  const SAFE_PROBES: Probe[] = [authStrip, errorCanary, methodProbe("OPTIONS"), methodProbe("TRACE")]

  export type Sender = (msg: HttpMessage.Request, origin: string) => Promise<Send.Result>

  function headersOf(parsed: { headers: { name: string; value: string }[] }): Record<string, string> {
    const h: Record<string, string> = {}
    for (const x of parsed.headers) h[x.name] = x.value
    return h
  }

  // Feed one probe response to the signal fabric; returns how many signals it raised (which, for a
  // real captured request, each queue a specialist retest).
  function feed(input: { sessionID: string; requestId: string; realRequest: boolean; method: string; url: string; parsed: Send.Result["response"] }): number {
    if (!input.parsed) return 0
    return scanProbeResponse({
      sessionID: input.sessionID,
      requestId: input.requestId,
      method: input.method,
      url: input.url,
      status: input.parsed.status,
      headers: headersOf(input.parsed),
      body: new TextDecoder("latin1").decode(input.parsed.body),
      sourceIsCaptured: input.realRequest,
    })
  }

  export interface EndpointInput {
    sessionID: string
    requestId: string
    keyHash?: string // present for a captured endpoint → access-control flags can be queued
    credentialId?: string // the identity that captured it (for cross-identity comparison)
    rawRequest: string
    origin: string
    send: Sender
    probes?: Probe[] // default: full PROBES (tests); the sweep passes SAFE_PROBES
    accessControl?: boolean // run baseline-compared auth-strip + cross-identity (sweep: true)
    minedAuthCheck?: boolean // mined endpoint (no captured row): run authed-vs-unauthed, materialize on hit
    method?: string // mined endpoint's method (for materialization)
    sourceLabel?: string // provenance for a materialized mined endpoint (e.g. "js-mined")
    signal?: AbortSignal
  }

  // Stable synthetic key_hash for a mined endpoint (method + template path), matching the 16-hex
  // shape of captured key_hashes so it flows through the retest queue / dispatch identically.
  function minedKeyHash(method: string, target: string): string {
    const path = target.split("?")[0]
    return createHash("sha1").update(`${method} ${path}`).digest("hex").slice(0, 16)
  }

  // A JSON (not HTML) 2xx — real API data, not an SPA catch-all shell (which returns 200 + index.html
  // for any path and would false-positive an access-control check).
  function isJsonOk(parsed: Send.Result["response"]): boolean {
    if (!is2xx(parsed?.status)) return false
    const ct = (parsed!.headers.find((h) => h.name.toLowerCase() === "content-type")?.value ?? "").toLowerCase()
    return ct.includes("json") || (!ct.includes("html") && !ct.includes("text/"))
  }

  // Materialize a mined endpoint as a real Request row ONLY when a scenario found something worth
  // escalating — so a hit dispatches a specialist + shows in the report, WITHOUT creating a row for
  // all 82 mined endpoints (the fan-out we avoid). Records provenance. Returns the key_hash.
  function materializeMined(sessionID: string, method: string, origin: string, target: string, rawRequest: string): string {
    const keyHash = minedKeyHash(method, target)
    try {
      let host = ""
      try {
        host = new URL(origin).host
      } catch {}
      Request.add({
        sessionID,
        method: method as "GET" | "HEAD",
        normalizedPath: target.split("?")[0],
        rawRequest,
        origin,
        host: host || undefined,
        keyHash,
        normSource: "js-mined",
      })
    } catch (e) {
      log.debug("api-probe: materializeMined failed (ignored)", { err: String(e) })
    }
    return keyHash
  }

  // Probe ONE endpoint. Non-mutating probes feed the signal fabric; when `accessControl` is set and
  // the endpoint was captured authenticated, a baseline-compared auth-strip / cross-identity replay
  // queues a targeted access-control retest on real evidence (2xx as the wrong identity) — the
  // deterministic replacement for the blanket cross-cred fan-out. NEVER throws.
  export async function runEndpoint(input: EndpointInput): Promise<{ probe: string; status: number | null; signals: number }[]> {
    let base: HttpMessage.Request
    try {
      base = HttpMessage.parse(input.rawRequest)
    } catch (e) {
      log.debug("api-probe: unparseable raw request", { requestId: input.requestId, err: String(e) })
      return []
    }
    const out: { probe: string; status: number | null; signals: number }[] = []
    const host = hostOf(input.origin)

    // ── Access-control comparison (evidence-based) ────────────────────────────
    // Requires a captured, authenticated baseline + a real request row to anchor the retest.
    if (input.accessControl && input.keyHash && input.credentialId) {
      try {
        const baseRes = await input.send(base, input.origin)
        if (is2xx(baseRes.response?.status)) {
          // unauth: the same request without auth → 2xx = broken access control.
          const { out: stripped, removed } = stripAuth(base)
          if (removed) {
            const r = await input.send(stripped, input.origin)
            if (is2xx(r.response?.status)) {
              WebInspect.flag({ sessionID: input.sessionID, keyHash: input.keyHash, type: "signal", value: "unauth_access:access-control", priority: "high" })
            }
          }
          // cross-identity: replay as every OTHER identity that has auth for this host → 2xx = a
          // cross-tenant/BFLA lead. Flag the offending credential (routes to authz + idor).
          for (const cred of WebCredential.get(input.sessionID)) {
            if (input.signal?.aborted) break
            if (cred.id === input.credentialId) continue
            const auth = WebCredential.authForHost(cred.authByHost, host)
            if (Object.keys(auth).length === 0) continue // this identity never authenticated to this host
            let msg = stripAuth(base).out
            for (const [name, value] of Object.entries(auth)) msg = Mutate.setHeader(msg, name, value)
            const r = await input.send(msg, input.origin)
            if (is2xx(r.response?.status)) {
              WebInspect.flag({ sessionID: input.sessionID, keyHash: input.keyHash, type: "credential", value: cred.id, priority: "high" })
            }
          }
        }
      } catch (e) {
        log.debug("api-probe: access-control comparison failed (ignored)", { err: String(e) })
      }
    }

    // ── Mined-endpoint access-control scenario (no captured row) ──────────────
    // A JS-mined endpoint was never visited, so it has no row/baseline. Run the scenario the user
    // asked for: send it with EVERY auth header the session's identity holds for this host (cookie /
    // bearer / x-api-key / whatever was captured — via authForHost, not just cookie) AND send it
    // unauthenticated. If the UNAUTH send returns real API data (JSON 2xx, not the SPA shell), that
    // is broken access control — materialize the endpoint as a row ONLY THEN (so a hit dispatches a
    // specialist + shows in the report) and flag it. No row for the endpoints that behave correctly.
    if (input.minedAuthCheck && !input.keyHash) {
      try {
        const creds = WebCredential.get(input.sessionID).filter((c) => Object.keys(WebCredential.authForHost(c.authByHost, host)).length > 0)
        const unauth = await input.send(stripAuth(base).out, input.origin)
        const unauthOk = isJsonOk(unauth.response)
        // With a credential: confirm the endpoint is real (authed serves data) so unauth-2xx isn't a
        // generic public page. Without a credential we can only note unauth data exposure.
        let authedOk = creds.length === 0
        for (const cred of creds) {
          if (input.signal?.aborted) break
          let msg = stripAuth(base).out
          for (const [name, value] of Object.entries(WebCredential.authForHost(cred.authByHost, host))) msg = Mutate.setHeader(msg, name, value)
          const r = await input.send(msg, input.origin)
          if (isJsonOk(r.response)) authedOk = true
        }
        if (unauthOk && authedOk) {
          const method = input.method ?? base.method
          const target = base.target
          const kh = materializeMined(input.sessionID, method, input.origin, target, input.rawRequest)
          WebInspect.flag({ sessionID: input.sessionID, keyHash: kh, type: "signal", value: "unauth_access:access-control", priority: "high" })
          out.push({ probe: "mined-unauth-access", status: unauth.response?.status ?? null, signals: 1 })
        }
      } catch (e) {
        log.debug("api-probe: mined access-control failed (ignored)", { err: String(e) })
      }
    }

    // ── Signal-fabric probes ──────────────────────────────────────────────────
    for (const probe of input.probes ?? PROBES) {
      if (input.signal?.aborted) break
      const msg = probe.build(base)
      if (!msg) continue
      try {
        const res = await input.send(msg, input.origin)
        const signals = feed({
          sessionID: input.sessionID,
          requestId: input.requestId,
          realRequest: !!input.keyHash,
          method: msg.method,
          url: input.origin + msg.target,
          parsed: res.response,
        })
        out.push({ probe: probe.name, status: res.response?.status ?? null, signals })
      } catch (e) {
        log.debug("api-probe: probe send failed (ignored)", { probe: probe.name, err: String(e) })
      }
    }
    return out
  }

  // ── Endpoint sources ────────────────────────────────────────────────────────
  interface Target {
    keyHash?: string
    requestId: string
    credentialId?: string
    rawRequest: string
    origin: string
    method: string
  }

  // Captured endpoints: one representative row per key_hash that has a raw request to replay.
  function capturedTargets(sessionID: string): Target[] {
    const byKey = new Map<string, Target>()
    Database.use((db) => {
      for (const r of db
        .select({
          key_hash: RequestTable.key_hash,
          id: RequestTable.id,
          method: RequestTable.method,
          raw_request: RequestTable.raw_request,
          origin: RequestTable.origin,
          scheme: RequestTable.scheme,
          host: RequestTable.host,
          credential_id: RequestTable.credential_id,
        })
        .from(RequestTable)
        .where(eq(RequestTable.session_id, sessionID))
        .all()) {
        if (!r.key_hash || byKey.has(r.key_hash) || !r.raw_request) continue
        const origin = r.origin || (r.scheme && r.host ? `${r.scheme}://${r.host}` : "")
        if (!origin) continue
        byKey.set(r.key_hash, {
          keyHash: r.key_hash,
          requestId: r.id,
          credentialId: r.credential_id ?? undefined,
          rawRequest: r.raw_request,
          origin,
          method: (r.method ?? "GET").toUpperCase(),
        })
      }
    })
    return [...byKey.values()]
  }

  // JS-mined / OpenAPI routes never fired at runtime. No captured row, so a synthetic GET request is
  // constructed and probed (signals surface in context; no auto-retest without a real row). This is
  // the "known-unvisited" surface the browser-driven crawl would miss.
  function minedTargets(sessionID: string, seenOrigins: Set<string>): Target[] {
    const out: Target[] = []
    let data: DataCollector.CollectedData
    try {
      data = DataCollector.latest(sessionID)
    } catch {
      return out
    }
    const add = (method: string, absUrl: string) => {
      let u: URL
      try {
        u = new URL(absUrl)
      } catch {
        return
      }
      if (!WebScope.allowed(sessionID, absUrl)) return
      const origin = `${u.protocol}//${u.host}`
      const target = (u.pathname || "/") + u.search
      const raw = `${method} ${target} HTTP/1.1\r\nHost: ${u.host}\r\nAccept: */*\r\n\r\n`
      out.push({ requestId: `mined:${method}:${absUrl}`, rawRequest: raw, origin, method: method.toUpperCase() })
    }
    for (const e of data.endpoints) if (e.kind === "api") add(e.method || "GET", e.origin + e.path)
    for (const m of data.minedRoutes) add(m.method || "GET", m.url)
    // Prefer captured coverage: skip a mined target whose origin+path we already have as captured
    // would need path-template matching; cheap dedup by absolute string is done at the sweep level.
    void seenOrigins
    return out
  }

  // ── Autonomous sweep + debounced trigger ──────────────────────────────────
  // Per-session set of already-probed endpoint keys, so re-ingest doesn't re-probe.
  const probed = new Map<string, Set<string>>()
  const running = new Set<string>()
  const pending = new Set<string>()

  function probedSet(sessionID: string): Set<string> {
    let s = probed.get(sessionID)
    if (!s) probed.set(sessionID, (s = new Set()))
    return s
  }

  // Probe every not-yet-probed endpoint (captured + mined), SAFE methods only. Sender is injectable
  // for tests; defaults to the governed backend. Returns how many endpoints were probed.
  export async function sweep(sessionID: string, opts: { send?: Sender; signal?: AbortSignal; force?: boolean } = {}): Promise<number> {
    const send: Sender = opts.send ?? ((msg, origin) => governedSend(msg, origin, { signal: opts.signal }))
    const done = probedSet(sessionID)
    const captured = capturedTargets(sessionID)
    const seenOrigins = new Set(captured.map((c) => c.origin))
    const targets = [...captured, ...minedTargets(sessionID, seenOrigins)]
    let probedCount = 0
    for (const t of targets) {
      if (opts.signal?.aborted) break
      if (!SAFE_METHODS.has(t.method)) continue // never replay a mutating method autonomously
      const dedupKey = t.keyHash ?? t.requestId
      if (!opts.force && done.has(dedupKey)) continue
      done.add(dedupKey)
      await runEndpoint({
        sessionID,
        requestId: t.requestId,
        keyHash: t.keyHash,
        credentialId: t.credentialId,
        rawRequest: t.rawRequest,
        origin: t.origin,
        method: t.method,
        send,
        probes: SAFE_PROBES,
        accessControl: !!t.keyHash && !!t.credentialId,
        minedAuthCheck: !t.keyHash, // a mined endpoint (no captured row) → authed-vs-unauthed scenario
        sourceLabel: "js-mined",
        signal: opts.signal,
      })
      probedCount++
    }
    return probedCount
  }

  // Debounced wake: coalesce a burst of ingests into one sweep. Idempotent while a sweep runs (a
  // wake during a run re-runs once after, catching endpoints ingested mid-sweep).
  const DEBOUNCE_MS = Math.max(0, Number(process.env.CYBERSTRIKE_APIPROBE_DEBOUNCE_MS) || 8000)
  const timers = new Map<string, ReturnType<typeof setTimeout>>()

  export function wake(sessionID: string): void {
    if (running.has(sessionID)) {
      pending.add(sessionID)
      return
    }
    if (timers.has(sessionID)) return
    timers.set(
      sessionID,
      setTimeout(() => {
        timers.delete(sessionID)
        void drain(sessionID)
      }, DEBOUNCE_MS),
    )
  }

  // True while this session's deterministic probe could still produce flags — a sweep is running, a
  // re-run is queued, or a debounced wake is pending. Feeds the SessionLifecycle (#19).
  export function isActive(sessionID: string): boolean {
    return running.has(sessionID) || pending.has(sessionID) || timers.has(sessionID)
  }

  async function drain(sessionID: string): Promise<void> {
    running.add(sessionID)
    try {
      await sweep(sessionID)
    } catch (e) {
      log.error("api-probe sweep crashed", { sessionID, err: String(e) })
    } finally {
      running.delete(sessionID)
      if (pending.delete(sessionID)) wake(sessionID) // endpoints arrived mid-sweep → run once more
    }
  }

  // Instance-scoped reset guard (mirrors other web services) — no cross-instance leakage in tests.
  export const reset = Instance.state(() => {
    probed.clear()
    running.clear()
    pending.clear()
    for (const t of timers.values()) clearTimeout(t)
    timers.clear()
    return {}
  })
}
