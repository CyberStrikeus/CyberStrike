// Backend A — structured send via native fetch (undici under the hood, the same
// engine inject_probe already uses). Covers the large majority of targets:
// HTTP/1.1 + HTTP/2, automatic encoding, connection pooling. The payload travels
// as request DATA (body bytes / header values), never through a shell, so the
// two-layer-escaping fragility of curl-in-bash is gone.
//
// Limitations by design (the raw-socket backend covers these): fetch normalizes
// the request, so it cannot send intentionally-malformed messages, cannot
// override forbidden headers like Host, and collapses duplicate response headers.
// Anything needing byte-exactness routes to backend B.

import { HttpMessage } from "./message"
import { ReplayResponse } from "./response"
import { ReplayError } from "./errors"
import { Governor } from "./governor"

export namespace BackendFetch {
  export interface SendOptions {
    /** Scheme + authority the request-target is resolved against, e.g.
     * "https://app.example.com" or "http://127.0.0.1:8080". */
    origin: string
    totalTimeoutMs?: number
    bodyCapBytes?: number
    /** TLS certificate verification (default true). false = accept self-signed. */
    rejectUnauthorized?: boolean
    /** External cancellation (e.g. the chat turn's abort). */
    signal?: AbortSignal
  }

  const BODYLESS = new Set(["GET", "HEAD"])

  /** Read a response body stream, stopping once `cap` bytes are collected. */
  async function readCapped(res: Response, cap: number): Promise<Uint8Array> {
    if (!res.body) {
      const buf = new Uint8Array(await res.arrayBuffer())
      return buf.length > cap ? buf.subarray(0, cap) : buf
    }
    const reader = res.body.getReader()
    const chunks: Uint8Array[] = []
    let total = 0
    while (total < cap) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) {
        chunks.push(value)
        total += value.length
      }
    }
    void reader.cancel().catch(() => {})
    const out = new Uint8Array(Math.min(total, cap))
    let off = 0
    for (const c of chunks) {
      if (off >= cap) break
      const take = Math.min(c.length, cap - off)
      out.set(c.subarray(0, take), off)
      off += take
    }
    return out
  }

  /**
   * Send `req` via fetch and return the unified Result. Never throws — a
   * transport failure comes back as `result.error` with a classified kind, and
   * `timing.totalMs` is always populated (so a timeout still carries elapsed ms,
   * the signal a time-based-injection test reads).
   */
  export async function send(req: HttpMessage.Request, opts: SendOptions): Promise<ReplayResponse.Result> {
    const start = performance.now()
    const totalTimeout = opts.totalTimeoutMs ?? Governor.DEFAULTS.totalTimeoutMs
    const cap = opts.bodyCapBytes ?? Governor.DEFAULTS.responseBodyCapBytes

    const controller = new AbortController()
    const onAbort = () => controller.abort()
    if (opts.signal) opts.signal.addEventListener("abort", onAbort, { once: true })
    const timer = setTimeout(() => controller.abort(), totalTimeout)

    try {
      const url = opts.origin.replace(/\/+$/, "") + req.target

      const headers = new Headers()
      for (const h of req.headers) {
        try {
          headers.append(h.name, h.value)
        } catch {
          // fetch forbids a few headers (e.g. Host); the raw-socket backend
          // handles those. Skip rather than fail the whole send.
        }
      }

      const hasBody = !BODYLESS.has(req.method.toUpperCase()) && req.body.length > 0

      const init: RequestInit & { tls?: { rejectUnauthorized: boolean } } = {
        method: req.method,
        headers,
        // TS 5.7 types Uint8Array as generic over its backing buffer and won't
        // accept Uint8Array<ArrayBufferLike> as BodyInit, though fetch handles it
        // fine at runtime. Cast through unknown for this lib-generics friction.
        body: hasBody ? (req.body as unknown as BodyInit) : undefined,
        redirect: "manual",
        signal: controller.signal,
      }
      if (opts.rejectUnauthorized === false) init.tls = { rejectUnauthorized: false }

      const res = await fetch(url, init)
      const ttfbMs = performance.now() - start

      const body = await readCapped(res, cap)
      const totalMs = performance.now() - start

      const parsed: ReplayResponse.Parsed = {
        version: "HTTP/1.1",
        status: res.status,
        reason: res.statusText,
        headers: [...res.headers].map(([name, value]) => ({ name, value })),
        body,
      }
      return { response: parsed, timing: { totalMs, ttfbMs } }
    } catch (err) {
      return {
        error: {
          kind: ReplayError.classify(err),
          message: err instanceof Error ? err.message : String(err),
        },
        timing: { totalMs: performance.now() - start },
      }
    } finally {
      clearTimeout(timer)
      if (opts.signal) opts.signal.removeEventListener("abort", onAbort)
    }
  }
}
