// API-direct fast test lane (discovery-fast-testing-plan §D). The deterministic-first half of
// testing: for every known endpoint, run a small set of cheap probes BEFORE spending any LLM, and
// feed each response to the signal fabric. A specialist (LLM) is dispatched ONLY when a probe
// raises a signal — the model-on-hit model that makes API-first testing fast, instead of one LLM
// sub-agent per endpoint.
//
// Probes are PURE request builders (mutate a base HttpMessage); the send + signal wiring is
// injected, so the whole lane unit-tests with a fake sender and no network/DB.
import { HttpMessage } from "@/replay/message"
import { Mutate } from "@/replay/mutate"
import { Send } from "@/replay/send"
import { Database, eq } from "../../storage/db"
import { RequestTable } from "../session.sql"
import { WebCredential, COMMON_AUTH_HEADERS } from "./web-credential"
import { scanProbeResponse } from "./signal/ingest"
import { governedSend } from "@/replay/govern"
import { Log } from "@/util/log"

export namespace ApiProbe {
  const log = Log.create({ service: "api-probe" })

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

  // ── The deterministic probe set ────────────────────────────────────────────
  // auth-strip: remove auth headers → unauthenticated access = broken access control.
  const authStrip: Probe = {
    name: "auth-strip",
    build(base) {
      let out = base
      let removed = false
      for (const h of base.headers) {
        if (COMMON_AUTH_HEADERS.includes(h.name.toLowerCase())) {
          out = Mutate.removeHeader(out, h.name)
          removed = true
        }
      }
      return removed ? out : null // nothing to strip → skip (endpoint was already anonymous)
    },
  }

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

  // method-matrix: swap the method → find state-changing methods the server wrongly allows.
  function methodProbe(method: string): Probe {
    return {
      name: `method-${method}`,
      build(base) {
        if (base.method.toUpperCase() === method) return null
        return Mutate.setMethod(base, method)
      },
    }
  }

  export const PROBES: Probe[] = [authStrip, errorCanary, methodProbe("PUT"), methodProbe("DELETE"), methodProbe("TRACE")]

  export type Sender = (msg: HttpMessage.Request, origin: string) => Promise<Send.Result>

  // Run the probe set against ONE endpoint (a captured request's raw + origin). Each probe response
  // is fed to the signal fabric, which enqueues a specialist retest only on a signal. Returns a
  // per-probe summary. NEVER throws — a probe failure must not stop the sweep.
  export async function runEndpoint(input: {
    sessionID: string
    requestId: string
    rawRequest: string
    origin: string
    send: Sender
    signal?: AbortSignal
  }): Promise<{ probe: string; status: number | null; signals: number }[]> {
    let base: HttpMessage.Request
    try {
      base = HttpMessage.parse(input.rawRequest)
    } catch (e) {
      log.debug("api-probe: unparseable raw request", { requestId: input.requestId, err: String(e) })
      return []
    }
    const out: { probe: string; status: number | null; signals: number }[] = []
    for (const probe of PROBES) {
      if (input.signal?.aborted) break
      const msg = probe.build(base)
      if (!msg) continue
      try {
        const res = await input.send(msg, input.origin)
        const parsed = res.response
        const status = parsed?.status ?? null
        let signals = 0
        if (parsed) {
          const headers: Record<string, string> = {}
          for (const h of parsed.headers) headers[h.name] = h.value
          signals = scanProbeResponse({
            sessionID: input.sessionID,
            requestId: input.requestId, // a real captured row → a signal here queues a specialist retest
            method: msg.method,
            url: input.origin + msg.target,
            status: parsed.status,
            headers,
            body: new TextDecoder("latin1").decode(parsed.body),
            sourceIsCaptured: true,
          })
        }
        out.push({ probe: probe.name, status, signals })
      } catch (e) {
        log.debug("api-probe: probe send failed (ignored)", { probe: probe.name, err: String(e) })
      }
    }
    return out
  }

  // One representative captured request per endpoint (key_hash) that has a raw request to replay.
  interface EndpointRow {
    keyHash: string
    requestId: string
    rawRequest: string
    origin: string
  }
  function endpoints(sessionID: string): EndpointRow[] {
    const byKey = new Map<string, EndpointRow>()
    Database.use((db) => {
      for (const r of db
        .select({
          key_hash: RequestTable.key_hash,
          id: RequestTable.id,
          raw_request: RequestTable.raw_request,
          origin: RequestTable.origin,
          scheme: RequestTable.scheme,
          host: RequestTable.host,
        })
        .from(RequestTable)
        .where(eq(RequestTable.session_id, sessionID))
        .all()) {
        if (!r.key_hash || byKey.has(r.key_hash) || !r.raw_request) continue
        const origin = r.origin || (r.scheme && r.host ? `${r.scheme}://${r.host}` : "")
        if (!origin) continue
        byKey.set(r.key_hash, { keyHash: r.key_hash, requestId: r.id, rawRequest: r.raw_request, origin })
      }
    })
    return [...byKey.values()]
  }

  // Sweep every known endpoint with the deterministic probe set. Sender defaults to the governed
  // backend; injectable for tests. Returns how many endpoints were probed.
  export async function sweep(sessionID: string, opts: { send?: Sender; signal?: AbortSignal } = {}): Promise<number> {
    const send: Sender = opts.send ?? ((msg, origin) => governedSend(msg, origin, { signal: opts.signal }))
    const eps = endpoints(sessionID)
    let probed = 0
    for (const ep of eps) {
      if (opts.signal?.aborted) break
      await runEndpoint({
        sessionID,
        requestId: ep.requestId,
        rawRequest: ep.rawRequest,
        origin: ep.origin,
        send,
        signal: opts.signal,
      })
      probed++
    }
    return probed
  }
}
