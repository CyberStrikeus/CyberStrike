// The Vortex-level send bridge: maps between the traffic model (`Transaction`) and the raw-HTTP
// send engine (`./send`). It is AGENT-AGNOSTIC on purpose — a plain async `send()` with no LLM/
// tool coupling — so BOTH consumers drive the same core: an agent tool (imperative, at wiring) and
// the DSL/ActiveRule engine (deterministic — query the corpus, send a probe, diff, signal).
//
// Two entry shapes, matching http_replay's dual capability:
//   - toRequest(tx)      : replay a CAPTURED request (Transaction → raw Request).
//   - buildRequest(spec) : build a FRESH raw request from scratch.
import type { Transaction, Header, Response as VxResponse } from "./transaction"
import { HttpMessage, Apply, Send, BackendFetch, ReplayResponse } from "./send"

// Build a fresh request from a simple spec.
export interface RequestSpec {
  method?: string
  url: string
  headers?: Record<string, string> | Header[]
  body?: string
  version?: string
}

export interface SendOptions {
  mutations?: Apply.Mutation[] // typed mutations applied before sending (auth-strip, set-body, …)
  identity?: string // the identity this probe is sent under (carried onto the replay transaction)
  session?: string
  timeoutMs?: number
  rejectUnauthorized?: boolean
  followRedirects?: boolean
  governors?: Send.Governors
  // Test/customisation seam: perform the ONE real send. Defaults to the fetch backend. A test
  // passes a stub so `send()` is exercised end-to-end with no network.
  transport?: (req: HttpMessage.Request, origin: string) => Promise<ReplayResponse.Result>
}

export interface SendResult {
  transaction: Transaction // the replay itself — source "replay", derivedFrom the origin request
  result: Send.Result // raw engine result (status/headers/body/timing/attempts/skipped)
}

const enc = new TextEncoder()
const decLatin1 = new TextDecoder("latin1") // byte-preserving decode of response/request bodies

function headerList(headers: Record<string, string> | Header[] | undefined): Header[] {
  if (!headers) return []
  if (Array.isArray(headers)) return headers
  return Object.entries(headers).map(([name, value]) => ({ name, value: String(value) }))
}

function originAndTarget(url: string): { origin: string; target: string; host: string } {
  const u = new URL(url)
  return { origin: u.origin, target: u.pathname + u.search, host: u.host }
}

// Captured Transaction → raw HttpMessage.Request (+ its origin), for replay.
export function toRequest(tx: Transaction): { req: HttpMessage.Request; origin: string } {
  const { origin, target } = originAndTarget(tx.request.url)
  return {
    req: {
      method: tx.request.method,
      target,
      version: "HTTP/1.1",
      headers: tx.request.headers.map((h) => ({ name: h.name, value: h.value })),
      body: tx.request.body ? enc.encode(tx.request.body) : new Uint8Array(0),
    },
    origin,
  }
}

// Fresh spec → raw HttpMessage.Request (+ origin), built from scratch.
export function buildRequest(spec: RequestSpec): { req: HttpMessage.Request; origin: string } {
  const { origin, target } = originAndTarget(spec.url)
  return {
    req: {
      method: (spec.method ?? "GET").toUpperCase(),
      target,
      version: spec.version ?? "HTTP/1.1",
      headers: headerList(spec.headers),
      body: spec.body ? enc.encode(spec.body) : new Uint8Array(0),
    },
    origin,
  }
}

function resolve(input: Transaction | RequestSpec | { req: HttpMessage.Request; origin: string }): {
  req: HttpMessage.Request
  origin: string
  from?: Transaction
} {
  if ("req" in input && "origin" in input) return { req: (input as { req: HttpMessage.Request }).req, origin: (input as { origin: string }).origin }
  if ("request" in input) return { ...toRequest(input as Transaction), from: input as Transaction }
  return buildRequest(input as RequestSpec)
}

function toResponse(result: ReplayResponse.Result): VxResponse | undefined {
  const r = result.response
  if (!r) return undefined
  return {
    status: r.status,
    headers: r.headers.map((h) => ({ name: h.name, value: h.value })),
    body: decLatin1.decode(r.body),
    bodyLength: r.body.length,
  }
}

// Send a request (captured Transaction, fresh spec, or a prepared {req,origin}), optionally applying
// mutations first. Returns the raw engine result AND a new "replay" Transaction (derivedFrom the
// origin request) ready to drop into the store so the SAME rules run over it.
export async function send(
  input: Transaction | RequestSpec | { req: HttpMessage.Request; origin: string },
  opts: SendOptions = {},
): Promise<SendResult> {
  const base = resolve(input)
  const req = opts.mutations && opts.mutations.length ? Apply.mutations(base.req, opts.mutations) : base.req
  const transport =
    opts.transport ??
    ((r, origin) => BackendFetch.send(r, { origin, totalTimeoutMs: opts.timeoutMs, rejectUnauthorized: opts.rejectUnauthorized, followRedirects: opts.followRedirects }))
  const result = await Send.governed(() => transport(req, base.origin), req.method, opts.governors ?? {}, {})
  const { host } = originAndTarget(base.origin + req.target)
  const transaction: Transaction = {
    id: `vx_${crypto.randomUUID()}`,
    session: opts.session ?? base.from?.session,
    source: "replay",
    host,
    identity: opts.identity ?? base.from?.identity,
    derivedFrom: base.from?.id,
    request: {
      method: req.method,
      url: base.origin + req.target,
      headers: req.headers.map((h) => ({ name: h.name, value: h.value })),
      body: req.body.length ? decLatin1.decode(req.body) : undefined,
    },
    response: toResponse(result),
    timing: { ms: result.timing.totalMs, ttfbMs: result.timing.ttfbMs },
  }
  return { transaction, result }
}
