// wireguard stack checks (HTTP subset) — ported from infra-security-mcp `providers/wireguard`.
// The raw-UDP detection/endpoint-enum (port 51820 handshake) needs a scoped UDP
// transport and is deferred (see the raw-socket follow-up issue).
import z from "zod"
import { defineWebhookTool } from "../define"
import type { HttpSender } from "../transport"
import { get, failed, ok, base, host, withPort, summarize, type Check } from "./shared"

export namespace Wireguard {
  export async function webUi(sender: HttpSender, origin: string): Promise<Check> {
    const targets = [origin, `${origin}/login`, `${origin}/status`, `${withPort(origin, 5000)}/`, `${withPort(origin, 51821)}/`, `${origin}/api/wireguard`]
    for (const t of targets) {
      const res = await get(sender, t)
      if (failed(res)) continue
      if (res.status < 400 && /(wg-easy|wireguard-ui|subspace|WireGuard)/i.test(res.body))
        return { check: "web_ui", hit: true, severity: "medium", detail: `WireGuard web UI reachable at ${t}`, evidence: res.body.slice(0, 120) }
    }
    return { check: "web_ui", hit: false, severity: "info", detail: "no WireGuard web UI" }
  }

  export async function configLeak(sender: HttpSender, origin: string): Promise<Check> {
    const paths = ["/wg0.conf", "/wireguard.conf", "/wg.conf", "/config/wg0.conf", "/etc/wireguard/wg0.conf", "/.wg0.conf"]
    for (const p of paths) {
      const res = await get(sender, `${origin}${p}`)
      if (failed(res)) continue
      if (res.status === 200 && /\[Interface\]/.test(res.body) && /(PrivateKey|Address)/.test(res.body)) {
        const priv = /PrivateKey\s*=/.test(res.body)
        const peers = (res.body.match(/\[Peer\]/g) || []).length
        const ep = (res.body.match(/Endpoint\s*=\s*(\S+)/i) || [])[1] || ""
        return { check: "config_leak", hit: true, severity: priv ? "critical" : "high", detail: `WireGuard config exposed at ${p}${priv ? " (PrivateKey present!)" : ""} — ${peers} peer(s)${ep ? `, endpoint ${ep}` : ""}`, evidence: res.body.slice(0, 120).replace(/PrivateKey\s*=.*/g, "PrivateKey = [REDACTED]") }
      }
    }
    return { check: "config_leak", hit: false, severity: "info", detail: "no exposed wg*.conf" }
  }

  const RUNNERS: Record<string, (s: HttpSender, o: string) => Promise<Check>> = {
    web_ui: webUi,
    config_leak: configLeak,
  }

  export async function run(sender: HttpSender, origin: string, which: string): Promise<Check[]> {
    const names = which === "all" ? Object.keys(RUNNERS) : [which]
    const out: Check[] = []
    for (const n of names) out.push(await RUNNERS[n](sender, origin))
    return out
  }
}

const DESCRIPTION = `WireGuard HTTP checks (web UI exposure, wg*.conf config leak incl. PrivateKey/peers/endpoint).

The raw-UDP port-51820 handshake detection + endpoint enumeration are deferred to a scoped UDP transport. Probes go through the scope-guarded replay engine. check="all" (default) runs every HTTP check.`

export const WireguardTestTool = defineWebhookTool({
  name: "wireguard_test",
  description: DESCRIPTION,
  parameters: z.object({
    target: z.string().describe("Target origin or URL (e.g. https://target.com)."),
    check: z.enum(["all", "web_ui", "config_leak"]).default("all").describe("Which HTTP check to run."),
  }),
  async run(params, ctx) {
    const origin = base(params.target)
    const results = await Wireguard.run(ctx.sender, origin, params.check)
    return { target: origin, results }
  },
  format(r) {
    return summarize("wireguard_test", r.target, r.results)
  },
})
