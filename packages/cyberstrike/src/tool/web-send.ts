// The ONE core request-sender every target-facing tool routes through.
//
// It composes the three layers that must agree on every outbound attack request —
// network policy (Network.forUrl: proxy, extra CA, client cert, TLS strictness),
// governance (Send.governed: retry / circuit-breaker / budget), and the transport
// (BackendFetch, which stays pure and takes only primitive fields) — and adds the
// proxy-aware error/status framing. Because http_replay AND inject_probe (and any
// future sender) all call this, a change here — a new proxy behaviour, a TLS rule,
// an auth step, an observability hook — reaches every tool at once. Nothing about a
// send that should be identical across tools belongs in the tools themselves.
//
// The per-tool concerns (which credential, how to observe the response, mutations /
// payload batteries) stay in the tools; only the act of putting one request on the
// wire lives here.

import { Network } from "../network/network"
import { Send } from "../replay/send"
import { BackendFetch } from "../replay/backend-fetch"
import type { HttpMessage } from "../replay/message"

export namespace WebSend {
  export interface Options {
    /** Governor instances the caller owns — per-call (http_replay) or per-battery
     *  (inject_probe). Omitted = ungoverned single send. */
    governors?: Send.Governors
    /** Explicit per-call TLS override (http_replay's `insecure_tls`); when unset,
     *  config's `tls.rejectUnauthorized` decides, defaulting to accepting bad certs. */
    insecureTls?: boolean
    followRedirects?: boolean
    totalTimeoutMs?: number
    bodyCapBytes?: number
    signal?: AbortSignal
  }

  /**
   * Send one request through the governed, network-aware transport.
   * Returns the same Send.Result the backend produces, with proxy framing applied
   * (see below) so every caller reports a proxy failure the same way.
   */
  export async function send(msg: HttpMessage.Request, origin: string, opts: Options = {}): Promise<Send.Result> {
    // Resolve transport ONCE, outside the thunk: Send.governed may call it again on retry.
    // A misconfigured proxy (bad URL, unsupported scheme) must fail CLOSED — return a
    // clean structured error, NEVER fall through to a direct send that leaks past the
    // proxy, and never throw out of the tool's execute().
    let net: Network.Outbound
    try {
      net = await Network.forUrl(origin)
    } catch (e) {
      return {
        error: { kind: "unknown", message: `outbound network config error: ${e instanceof Error ? e.message : String(e)}` },
        timing: { totalMs: 0 },
        attempts: 0,
      }
    }
    // Single source of truth for the per-call → config → default TLS precedence.
    const rejectUnauthorized = Network.tlsRejectUnauthorized(opts.insecureTls, net)

    const result = await Send.governed(
      () =>
        BackendFetch.send(msg, {
          origin,
          ...net,
          rejectUnauthorized,
          totalTimeoutMs: opts.totalTimeoutMs,
          bodyCapBytes: opts.bodyCapBytes,
          followRedirects: opts.followRedirects,
          signal: opts.signal,
        }),
      msg.method,
      opts.governors ?? {},
      {},
    )

    // A transport failure through a proxy is reported by the runtime against the
    // TARGET url, so a dead proxy reads as "target refused the connection" — an agent
    // then draws "host down, out of scope" and stops testing a live target. Name the
    // proxy (authority only, never credentials) so the reader can tell the two apart.
    if (result.error && net.proxy) {
      return {
        ...result,
        error: {
          ...result.error,
          message: `${result.error.message} [sent via proxy ${Network.proxyAuthority(net.proxy)} — the proxy, not the target, may be what failed]`,
        },
      }
    }

    // A 407 is the PROXY refusing, not the target. Left unlabelled it reads as an
    // authentication finding about the endpoint. Only Basic is supported here, so name
    // the scheme the proxy actually asked for — an enterprise proxy demanding NTLM or
    // Negotiate cannot be satisfied, and that is worth saying once.
    if (net.proxy && result.response?.status === 407) {
      const scheme = result.response.headers.find((h) => h.name.toLowerCase() === "proxy-authenticate")?.value
      return {
        ...result,
        proxyNote:
          `Rejected by the proxy ${Network.proxyAuthority(net.proxy)}, not by the target` +
          (scheme ? ` — it requires ${scheme.split(/[\s,]/)[0]} authentication.` : ".") +
          ` network.proxy.auth sends Basic credentials only.`,
      }
    }

    return result
  }
}
