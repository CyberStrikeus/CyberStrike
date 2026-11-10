// openvpn stack checks (HTTP subset) — ported from infra-security-mcp `providers/openvpn`.
// The raw-TCP `openvpn_detect` (port 1194 handshake) needs a scoped TCP transport
// and is deferred (see the raw-socket follow-up issue).
import z from "zod"
import { defineWebhookTool } from "../define"
import type { HttpSender } from "../transport"
import { get, header, failed, ok, base, host, withPort, summarize, type Check } from "./shared"

export namespace Openvpn {
  export async function webPanel(sender: HttpSender, origin: string): Promise<Check> {
    const targets = [`${origin}/admin`, `${origin}/__session`, origin, `${withPort(origin, 9090)}/`, `https://${host(origin)}/login`]
    for (const t of targets) {
      const res = await get(sender, t)
      if (failed(res)) continue
      if (res.status < 400 && /(OpenVPN Access Server|Pritunl|openvpn|ovpn)/i.test(res.body))
        return { check: "web_panel", hit: true, severity: "medium", detail: `OpenVPN web panel reachable at ${t}`, evidence: res.body.slice(0, 120) }
    }
    return { check: "web_panel", hit: false, severity: "info", detail: "no OpenVPN web panel" }
  }

  export async function configLeak(sender: HttpSender, origin: string): Promise<Check> {
    const paths = ["/client.ovpn", "/server.ovpn", "/openvpn.conf", "/config.ovpn", "/vpn/client.ovpn", "/.ovpn", "/server.conf"]
    for (const p of paths) {
      const res = await get(sender, `${origin}${p}`)
      if (failed(res)) continue
      if (res.status === 200 && /(remote |client|dev tun|<ca>|<cert>|<key>|tls-auth)/i.test(res.body)) {
        const keys = /<key>|<tls-auth>/i.test(res.body)
        const ep = (res.body.match(/remote\s+(\S+)\s+(\d+)/i) || []).slice(1).join(":")
        return { check: "config_leak", hit: true, severity: keys ? "critical" : "high", detail: `OpenVPN config exposed at ${p}${keys ? " (embedded private key!)" : ""}${ep ? ` → ${ep}` : ""}`, evidence: res.body.slice(0, 120) }
      }
    }
    return { check: "config_leak", hit: false, severity: "info", detail: "no exposed .ovpn/.conf" }
  }

  export async function versionDetect(sender: HttpSender, origin: string): Promise<Check> {
    for (const p of ["/admin", "/rest/GetUserlogin", "/api/version", "/"]) {
      const res = await get(sender, `${origin}${p}`)
      if (failed(res)) continue
      const m = (header(res, "server") + res.body.slice(0, 1000)).match(/OpenVPN[- ]?(?:Access Server )?([\d.]+)/i)
      if (m) return { check: "version_detect", hit: true, severity: "low", detail: `OpenVPN ${m[1]} disclosed at ${p}`, evidence: m[0] }
    }
    return { check: "version_detect", hit: false, severity: "info", detail: "OpenVPN version not disclosed over HTTP" }
  }

  const RUNNERS: Record<string, (s: HttpSender, o: string) => Promise<Check>> = {
    web_panel: webPanel,
    config_leak: configLeak,
    version_detect: versionDetect,
  }

  export async function run(sender: HttpSender, origin: string, which: string): Promise<Check[]> {
    const names = which === "all" ? Object.keys(RUNNERS) : [which]
    const out: Check[] = []
    for (const n of names) out.push(await RUNNERS[n](sender, origin))
    return out
  }
}

const DESCRIPTION = `OpenVPN HTTP checks (web panel exposure, .ovpn/.conf config leak incl. embedded keys, version disclosure).

The raw-TCP port-1194 handshake detection is deferred to a scoped TCP transport. Probes go through the scope-guarded replay engine. check="all" (default) runs every HTTP check.`

export const OpenvpnTestTool = defineWebhookTool({
  name: "openvpn_test",
  description: DESCRIPTION,
  parameters: z.object({
    target: z.string().describe("Target origin or URL (e.g. https://target.com)."),
    check: z.enum(["all", "web_panel", "config_leak", "version_detect"]).default("all").describe("Which HTTP check to run."),
  }),
  async run(params, ctx) {
    const origin = base(params.target)
    const results = await Openvpn.run(ctx.sender, origin, params.check)
    return { target: origin, results }
  },
  format(r) {
    return summarize("openvpn_test", r.target, r.results)
  },
})
