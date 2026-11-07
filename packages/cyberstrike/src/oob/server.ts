import dgram from "node:dgram"
import { Log } from "@/util/log"
import { OobStore } from "./store"
import { OobDns } from "./dns"

const log = Log.create({ service: "oob-server" })

// The self-hosted OOB interaction server (#85). Captures DNS + HTTP callbacks to `*.<DOMAIN>` and files
// each under its token (the subdomain label) so a subagent can confirm a BLIND vuln by polling. Runs as
// its own process (`cyberstrike oob`) on a public IP whose `oob.<domain>` NS is delegated to it.
export namespace OobServer {
  function domainEnv(): string {
    return (process.env.CYBERSTRIKE_OOB_DOMAIN || "").toLowerCase().replace(/^\.+|\.+$/g, "")
  }
  function ip(): string {
    return process.env.CYBERSTRIKE_OOB_IP || "127.0.0.1"
  }
  const DNS_PORT = Math.max(1, Number(process.env.CYBERSTRIKE_OOB_DNS_PORT) || 53)
  const HTTP_PORT = Math.max(1, Number(process.env.CYBERSTRIKE_OOB_HTTP_PORT) || 80)
  // Management API port — the agent backend polls GET /i/:token here (CYBERSTRIKE_OOB_API). Loopback /
  // internal only; never expose it publicly. Explicit 0 disables it (in-process deployments read the
  // store directly); unset defaults to 8053.
  const API_PORT = (() => {
    const v = process.env.CYBERSTRIKE_OOB_API_PORT
    if (v === undefined) return 8053
    const n = Number(v)
    return Number.isFinite(n) && n > 0 ? n : 0
  })()

  let dnsSock: dgram.Socket | undefined
  let httpServer: { stop: () => void } | undefined
  let apiServer: { stop: () => void } | undefined

  export function domain(): string {
    return domainEnv()
  }
  export function configured(): boolean {
    return !!domainEnv()
  }

  const QTYPE: Record<number, string> = { 1: "A", 2: "NS", 5: "CNAME", 15: "MX", 16: "TXT", 28: "AAAA" }

  export function start(): void {
    const DOMAIN = domainEnv()
    if (!DOMAIN) {
      log.warn("OOB server not started — set CYBERSTRIKE_OOB_DOMAIN (and _IP, delegate its NS to this host)")
      return
    }

    // DNS: log every query under *.DOMAIN (captures blind DNS-only callbacks) and answer A with our IP so
    // an HTTP follow-up (the common blind-SSRF/RCE second stage) reaches us too.
    dnsSock = dgram.createSocket("udp4")
    dnsSock.on("message", (msg, rinfo) => {
      try {
        const q = OobDns.parseQuery(msg)
        if (!q) return
        OobStore.capture(q.qname, DOMAIN, {
          protocol: "dns",
          remoteAddr: rinfo.address,
          at: Date.now(),
          detail: `${QTYPE[q.qtype] ?? `TYPE${q.qtype}`} ${q.qname}`,
        })
        dnsSock!.send(OobDns.buildResponse(msg, q, ip()), rinfo.port, rinfo.address)
      } catch (e) {
        log.debug("oob dns handler failed (ignored)", { err: String(e) })
      }
    })
    dnsSock.on("error", (e) => log.warn("oob dns socket error", { err: String(e) }))
    dnsSock.bind(DNS_PORT)

    // HTTP: log every request to *.DOMAIN (the blind SSRF/RCE/XXE second stage carries the path + headers).
    httpServer = Bun.serve({
      port: HTTP_PORT,
      fetch(req, server) {
        try {
          const host = (req.headers.get("host") || "").split(":")[0]
          const url = new URL(req.url)
          const remote = server.requestIP(req)?.address || ""
          OobStore.capture(host, DOMAIN, {
            protocol: "http",
            remoteAddr: remote,
            at: Date.now(),
            detail: `${req.method} ${url.pathname}${url.search} (Host: ${host})`,
            raw: [...req.headers].map(([k, v]) => `${k}: ${v}`).join("\n"),
          })
        } catch (e) {
          log.debug("oob http handler failed (ignored)", { err: String(e) })
        }
        return new Response("ok\n")
      },
    })

    // Management API (internal): the agent backend reads captured interactions here (GET /i/:token).
    if (API_PORT > 0) {
      apiServer = Bun.serve({
        port: API_PORT,
        fetch(req) {
          const url = new URL(req.url)
          const m = url.pathname.match(/^\/i\/([^/]+)$/)
          if (!m) return new Response("not found\n", { status: 404 })
          return Response.json({ token: m[1], interactions: OobStore.poll(decodeURIComponent(m[1]!)) })
        },
      })
    }

    log.info("OOB server started", { domain: DOMAIN, ip: ip(), dnsPort: DNS_PORT, httpPort: HTTP_PORT, apiPort: API_PORT || "off" })
  }

  export function stop(): void {
    try {
      dnsSock?.close()
    } catch {}
    try {
      httpServer?.stop()
    } catch {}
    try {
      apiServer?.stop()
    } catch {}
    dnsSock = undefined
    httpServer = undefined
    apiServer = undefined
  }
}
