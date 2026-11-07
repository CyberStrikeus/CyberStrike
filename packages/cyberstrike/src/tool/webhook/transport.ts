// Shared HTTP transport for the webhook smart tools (plan §05, invariant-2). ONE
// sender the tools compose — authn_test today, ssrf_test / business_test next — so
// none re-implements a send path. Production `ReplaySender` routes through the
// verified replay engine via the shared `governedSend` primitive; tests inject a
// mock HttpSender, so tool orchestration is verified without a socket.
import { HttpMessage } from "@/replay/message"
import { governedSend } from "@/replay/govern"

// Minimal request/response DTOs the tools speak — decoupled from the engine's
// HttpMessage/ReplayResponse so a mock is trivial and the tools stay engine-agnostic.
export interface ProbeRequest {
  method: string
  url: string
  headers: Record<string, string>
  body?: string
}

export interface ProbeResponse {
  status: number
  headers: Record<string, string>
  body: string
}

// The transport seam. Returns a response, or an error object for a transport failure.
export interface HttpSender {
  send(req: ProbeRequest): Promise<ProbeResponse | { error: string }>
}

export interface ReplaySenderOptions {
  insecureTls?: boolean // default true (pentest targets often have bad certs)
  totalTimeoutMs?: number
  followRedirects?: boolean // default false — callers handle redirects explicitly
  signal?: AbortSignal
}

// Production HttpSender: ProbeRequest → HttpMessage → governedSend → ProbeResponse.
export class ReplaySender implements HttpSender {
  constructor(private readonly opts: ReplaySenderOptions = {}) {}

  async send(req: ProbeRequest): Promise<ProbeResponse | { error: string }> {
    let url: URL
    try {
      url = new URL(req.url)
    } catch {
      return { error: `invalid url: ${req.url}` }
    }
    const origin = `${url.protocol}//${url.host}`

    const headers: HttpMessage.Header[] = [{ name: "Host", value: url.host }]
    for (const k in req.headers) headers.push({ name: k, value: req.headers[k] })
    const body = req.body ? new TextEncoder().encode(req.body) : new Uint8Array(0)
    if (body.length > 0 && !headers.some((h) => h.name.toLowerCase() === "content-length")) {
      headers.push({ name: "Content-Length", value: String(body.length) })
    }

    const msg: HttpMessage.Request = {
      method: req.method.toUpperCase(),
      target: (url.pathname || "/") + url.search,
      version: "HTTP/1.1",
      headers,
      body,
    }

    const result = await governedSend(msg, origin, {
      insecureTls: this.opts.insecureTls,
      totalTimeoutMs: this.opts.totalTimeoutMs,
      followRedirects: this.opts.followRedirects,
      signal: this.opts.signal,
    })

    if (result.error || !result.response) return { error: result.error?.message ?? "no response" }
    const res = result.response
    const outHeaders: Record<string, string> = {}
    for (const h of res.headers) outHeaders[h.name] = h.value
    return { status: res.status, headers: outHeaders, body: new TextDecoder("latin1").decode(res.body) }
  }
}
