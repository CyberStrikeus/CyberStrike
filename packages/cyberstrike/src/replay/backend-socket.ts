// Backend B — byte-exact send over a raw TCP/TLS socket. Where backend A (fetch)
// normalizes the request, this backend writes the EXACT bytes it is given and
// parses the raw response itself. This is what makes request smuggling / desync,
// intentionally-malformed messages, duplicate/odd-case headers, and Host-header
// overrides testable — the whole "nothing is impossible" half of the two-level
// model (design §2).
//
// Body-completion is detected from Content-Length or chunked framing so the read
// doesn't hang on a keep-alive connection; absent both, it reads until the peer
// closes or the timeout fires.

import net from "node:net"
import tls from "node:tls"
import { ReplayResponse } from "./response"
import { ReplayError } from "./errors"
import { Governor } from "./governor"

export namespace BackendSocket {
  export interface SendOptions {
    host: string
    port: number
    tls?: boolean
    /** SNI server name (defaults to host). Lets you connect to an IP while
     * presenting a different name — vhost / host-confusion tests. */
    servername?: string
    rejectUnauthorized?: boolean
    totalTimeoutMs?: number
    connectTimeoutMs?: number
    bodyCapBytes?: number
    signal?: AbortSignal
  }

  const CR = 0x0d
  const LF = 0x0a
  const dec = new TextDecoder("latin1")

  /** Offset of the first body byte, or -1 if the header block hasn't fully
   * arrived yet. */
  function headerEnd(buf: Buffer): number {
    for (let i = 0; i + 1 < buf.length; i++) {
      if (buf[i] === CR && buf[i + 1] === LF && i + 3 < buf.length && buf[i + 2] === CR && buf[i + 3] === LF) {
        return i + 4
      }
      if (buf[i] === LF && buf[i + 1] === LF) return i + 2
    }
    return -1
  }

  function headerValue(headerText: string, name: string): string | undefined {
    const lower = name.toLowerCase()
    for (const line of headerText.split("\n")) {
      const l = line.endsWith("\r") ? line.slice(0, -1) : line
      const colon = l.indexOf(":")
      if (colon === -1) continue
      if (l.slice(0, colon).trim().toLowerCase() === lower) return l.slice(colon + 1).trim()
    }
    return undefined
  }

  /** Whether the accumulated buffer holds a complete response. `capReached`
   * forces completion when the body cap is hit so we stop reading. */
  function isComplete(buf: Buffer, cap: number): boolean {
    const he = headerEnd(buf)
    if (he === -1) return false
    const bodyLen = buf.length - he
    if (bodyLen >= cap) return true

    const headerText = dec.decode(buf.subarray(0, he))
    const cl = headerValue(headerText, "content-length")
    if (cl !== undefined) {
      const n = Number.parseInt(cl, 10)
      if (Number.isFinite(n)) return bodyLen >= n
    }
    const te = headerValue(headerText, "transfer-encoding")
    if (te && te.toLowerCase().includes("chunked")) {
      // Terminal chunk: 0 CRLF CRLF.
      const tail = buf.subarray(Math.max(he, buf.length - 7))
      return dec.decode(tail).includes("0\r\n\r\n")
    }
    // No length signal — can only be sure the message ended when the peer closes.
    return false
  }

  /**
   * Send raw bytes over a socket and return the unified Result. Never rejects —
   * failures come back classified in `result.error`, with `timing.totalMs`
   * always set.
   */
  export function send(raw: Uint8Array, opts: SendOptions): Promise<ReplayResponse.Result> {
    const start = performance.now()
    const totalTimeout = opts.totalTimeoutMs ?? Governor.DEFAULTS.totalTimeoutMs
    const connectTimeout = opts.connectTimeoutMs ?? Governor.DEFAULTS.connectTimeoutMs
    const cap = opts.bodyCapBytes ?? Governor.DEFAULTS.responseBodyCapBytes

    return new Promise((resolve) => {
      const chunks: Buffer[] = []
      let ttfbMs: number | undefined
      let settled = false

      const socket = opts.tls
        ? tls.connect({
            host: opts.host,
            port: opts.port,
            servername: opts.servername ?? opts.host,
            rejectUnauthorized: opts.rejectUnauthorized ?? true,
          })
        : net.connect({ host: opts.host, port: opts.port })

      const connectTimer = setTimeout(() => finishError("timeout", "connect timeout"), connectTimeout)
      const totalTimer = setTimeout(() => finishError("timeout", "total timeout"), totalTimeout)

      const cleanup = () => {
        clearTimeout(connectTimer)
        clearTimeout(totalTimer)
        if (opts.signal) opts.signal.removeEventListener("abort", onAbort)
        socket.destroy()
      }
      const timing = () => ({ totalMs: performance.now() - start, ttfbMs })

      function finishError(kind: ReplayError.Kind, message: string) {
        if (settled) return
        settled = true
        cleanup()
        resolve({ error: { kind, message }, timing: timing() })
      }
      function finishOk() {
        if (settled) return
        settled = true
        cleanup()
        try {
          const buf = Buffer.concat(chunks)
          const he = headerEnd(buf)
          const bodyStart = he === -1 ? buf.length : he
          const bodyEnd = Math.min(buf.length, bodyStart + cap)
          const trimmed = buf.subarray(0, bodyEnd)
          resolve({ response: ReplayResponse.parse(new Uint8Array(trimmed)), timing: timing() })
        } catch (e) {
          resolve({
            error: { kind: "unknown", message: e instanceof Error ? e.message : String(e) },
            timing: timing(),
          })
        }
      }

      const onAbort = () => finishError("timeout", "aborted")
      if (opts.signal) {
        if (opts.signal.aborted) return finishError("timeout", "aborted")
        opts.signal.addEventListener("abort", onAbort, { once: true })
      }

      const onConnect = () => {
        clearTimeout(connectTimer)
        socket.write(Buffer.from(raw))
      }
      if (opts.tls) socket.once("secureConnect", onConnect)
      else socket.once("connect", onConnect)

      socket.on("data", (d: Buffer) => {
        if (ttfbMs === undefined) ttfbMs = performance.now() - start
        chunks.push(d)
        const buf = Buffer.concat(chunks)
        if (isComplete(buf, cap)) finishOk()
      })
      socket.on("end", finishOk) // peer closed — message is whatever we have
      socket.on("close", finishOk)
      socket.on("error", (e: NodeJS.ErrnoException) =>
        finishError(ReplayError.classify(e), e.message ?? "socket error"),
      )
    })
  }
}
