// WireGuard stack checks — 1:1 port of the HTTP-based checks in infra-security-mcp
// `providers/wireguard`. Every management-UI path/indicator and wg config path
// matches the source exactly; only the transport (scope-guarded webhook sender)
// and the Check/severity adapter are CyberStrike's.
// NOTE: the raw-UDP `wireguard_detect` and `wireguard_endpoint_enum` (handshake
// initiation on port 51820 etc.) are node:dgram socket probes and are
// intentionally NOT ported here — deferred to #32.
import z from "zod"
import { defineWebhookTool } from "../define"
import type { HttpSender } from "../transport"
import { get, failed, ok, base, summarize, verdict, type Check, type Finding } from "./shared"

export namespace Wireguard {
  export async function webUi(sender: HttpSender, origin: string): Promise<Check> {
    const panels = [
      { path: "/", indicators: ["wg-easy", "wireguard"], name: "wg-easy" },
      { path: "/login", indicators: ["wireguard-ui", "wg-ui", "wireguard"], name: "wireguard-ui" },
      { path: "/status", indicators: ["wireguard", "wg0", "peer"], name: "WireGuard Status" },
      { path: ":5000/", indicators: ["subspace", "wireguard"], name: "Subspace" },
      { path: ":51821/", indicators: ["wg-easy", "wireguard"], name: "wg-easy (alt port)" },
      { path: "/api/wireguard", indicators: ["peers", "interface", "wireguard"], name: "WireGuard API" },
    ]

    const findings: Finding[] = []
    for (const panel of panels) {
      const url = panel.path.startsWith(":") ? `${origin.replace(/:\d+/, "")}${panel.path}` : `${origin}${panel.path}`
      const res = await get(sender, url)
      if (failed(res)) continue
      const bodyLower = res.body.toLowerCase()
      const matched = panel.indicators.filter((i) => bodyLower.includes(i))
      if (matched.length > 0) findings.push({ severity: "medium", detail: `${panel.name} exposed at ${url} (status ${res.status}) — indicators: ${matched.join(", ")}`, evidence: bodyLower.match(/<title>([^<]*)<\/title>/)?.[1]?.trim() })
    }

    return verdict("web_ui", findings, "no WireGuard web UI exposed")
  }

  export async function configLeak(sender: HttpSender, origin: string): Promise<Check> {
    const paths = [
      "/wg0.conf", "/wireguard/wg0.conf", "/etc/wireguard/wg0.conf",
      "/vpn/wg0.conf", "/config/wg0.conf", "/backup/wg0.conf",
      "/wg.conf", "/wireguard.conf", "/.wireguard/wg0.conf",
      "/download/wg0.conf", "/client.conf",
    ]

    const findings: Finding[] = []
    for (const path of paths) {
      const res = await get(sender, `${origin}${path}`)
      if (!ok(res) || res.status !== 200) continue
      const body = res.body
      const isWgConfig = body.includes("[Interface]") && (body.includes("PrivateKey") || body.includes("Address"))
      if (isWgConfig) {
        const hasPrivateKey = /PrivateKey\s*=\s*\S+/.test(body)
        const peers = (body.match(/\[Peer\]/g) ?? []).length
        const endpoints = [...body.matchAll(/Endpoint\s*=\s*(\S+)/g)].map((m) => m[1])
        findings.push({ severity: hasPrivateKey ? "critical" : "high", detail: `WireGuard config exposed at ${path} (${body.length} bytes, ${peers} peer(s))${hasPrivateKey ? " — embeds PrivateKey" : ""}${endpoints.length ? ` — endpoints: ${endpoints.join(", ")}` : ""}`, evidence: body.slice(0, 200) })
      }
    }

    return verdict("config_leak", findings, "no exposed WireGuard config file")
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

const DESCRIPTION = `WireGuard HTTP checks (management UIs wg-easy/wireguard-ui/subspace/WireGuard-API at /, /login, /status, :5000/, :51821/, /api/wireguard; exposed wg0.conf config leak with PrivateKey/peer/Endpoint extraction). 1:1 port of the HTTP checks in the infra-security wireguard provider.

NOTE: the raw-UDP wireguard_detect and wireguard_endpoint_enum (handshake-initiation port probes) are node:dgram socket probes and are deferred to #32; this tool covers only the HTTP-reachable surface. check="all" (default) runs every check.`

export const WireguardTestTool = defineWebhookTool({
  name: "wireguard_test",
  description: DESCRIPTION,
  parameters: z.object({
    target: z.string().describe("Target origin or URL (e.g. https://wg.target.com)."),
    check: z
      .enum(["all", "web_ui", "config_leak"])
      .default("all")
      .describe("Which check to run; 'all' runs every WireGuard HTTP check."),
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
