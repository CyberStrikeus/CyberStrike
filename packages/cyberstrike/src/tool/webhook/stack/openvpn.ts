// OpenVPN stack checks — 1:1 port of the HTTP-based checks in infra-security-mcp
// `providers/openvpn`. Every panel path, .ovpn config path, version regex and
// detection branch matches the source exactly; only the transport (scope-guarded
// webhook sender) and the Check/severity adapter are CyberStrike's.
// NOTE: the raw-TCP `openvpn_detect` (port 1194 control-reset handshake) is a
// node:net socket probe and is intentionally NOT ported here — deferred to #32.
import z from "zod"
import { defineWebhookTool } from "../define"
import type { HttpSender } from "../transport"
import { get, header, failed, ok, base, summarize, verdict, type Check, type Finding } from "./shared"

export namespace Openvpn {
  export async function webPanel(sender: HttpSender, origin: string): Promise<Check> {
    const panels = [
      { path: "/admin", name: "OpenVPN Access Server Admin" },
      { path: "/__session", name: "OpenVPN Access Server" },
      { path: "/", name: "OpenVPN Access Server Client" },
      { path: ":9090/", name: "Pritunl" },
      { path: ":443/login", name: "Pritunl Login" },
    ]
    const indicators = ["openvpn", "access server", "pritunl", "ovpn", "vpn-login", "openvpn-gui"]

    const findings: Finding[] = []
    for (const panel of panels) {
      const url = panel.path.startsWith(":") ? `${origin.replace(/:\d+/, "")}${panel.path}` : `${origin}${panel.path}`
      const res = await get(sender, url)
      if (failed(res)) continue
      const bodyLower = res.body.toLowerCase()
      const matched = indicators.filter((i) => bodyLower.includes(i))
      if (matched.length > 0) findings.push({ severity: "medium", detail: `${panel.name} exposed at ${url} (status ${res.status}) — indicators: ${matched.join(", ")}`, evidence: bodyLower.match(/<title>([^<]*)<\/title>/)?.[1]?.trim() })
    }

    return verdict("web_panel", findings, "no OpenVPN web management panel exposed")
  }

  export async function configLeak(sender: HttpSender, origin: string): Promise<Check> {
    const paths = [
      "/client.ovpn", "/vpn/client.ovpn", "/openvpn/client.ovpn",
      "/config.ovpn", "/vpn.ovpn", "/openvpn.ovpn",
      "/download/client.ovpn", "/files/client.ovpn",
      "/vpn/config/client.ovpn", "/etc/openvpn/client.conf",
      "/.openvpn/client.ovpn", "/backup/vpn.ovpn",
    ]

    const findings: Finding[] = []
    for (const path of paths) {
      const res = await get(sender, `${origin}${path}`)
      if (!ok(res) || res.status !== 200) continue
      const body = res.body
      const isConfig = body.includes("remote ") || (body.includes("client") && body.includes("dev tun"))
      if (isConfig) {
        const hasKey = body.includes("<ca>") || body.includes("<cert>") || body.includes("<key>") || body.includes("<tls-auth>")
        const remoteMatch = body.match(/^remote\s+(\S+)\s+(\d+)/m)
        findings.push({ severity: hasKey ? "critical" : "high", detail: `OpenVPN config exposed at ${path} (${body.length} bytes)${hasKey ? " — embeds CA/cert/key material" : ""}${remoteMatch ? ` — remote ${remoteMatch[1]}:${remoteMatch[2]}` : ""}`, evidence: body.slice(0, 200) })
      }
    }

    return verdict("config_leak", findings, "no exposed .ovpn config file")
  }

  export async function versionDetect(sender: HttpSender, origin: string): Promise<Check> {
    const endpoints = ["/admin", "/__session", "/rest/GetUserlogin", "/api/version"]
    const vPatterns = [
      /OpenVPN[- ](?:Access Server[- ])?v?(\d+\.\d+(?:\.\d+)?)/i,
      /openvpn_version['":\s]+v?(\d+\.\d+(?:\.\d+)?)/i,
      /version['":\s]+v?(\d+\.\d+(?:\.\d+)?[^'"<\s]*)/i,
    ]

    const versions = new Map<string, string>()
    for (const ep of endpoints) {
      const res = await get(sender, `${origin}${ep}`)
      if (failed(res)) continue
      for (const pat of vPatterns) {
        const match = res.body.match(pat)
        if (match) versions.set(match[1], ep)
      }
      const server = header(res, "server")
      if (server.toLowerCase().includes("openvpn")) versions.set(server, `${ep} (Server header)`)
    }

    const findings: Finding[] = [...versions].map(([version, source]) => ({ severity: "low" as const, detail: `OpenVPN version '${version}' disclosed via ${source}` }))
    return verdict("version_detect", findings, "no OpenVPN version disclosed")
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

const DESCRIPTION = `OpenVPN HTTP checks (Access Server / Pritunl admin panels at /admin, /__session, :9090/, :443/login; exposed .ovpn config leak with embedded CA/cert/key detection; Access Server version disclosure via /admin, /__session, /rest/GetUserlogin, /api/version). 1:1 port of the HTTP checks in the infra-security openvpn provider.

NOTE: the raw-TCP openvpn_detect (port 1194 control-reset handshake) is a node:net socket probe and is deferred to #32; this tool covers only the HTTP-reachable surface. check="all" (default) runs every check.`

export const OpenvpnTestTool = defineWebhookTool({
  name: "openvpn_test",
  description: DESCRIPTION,
  parameters: z.object({
    target: z.string().describe("Target origin or URL (e.g. https://vpn.target.com)."),
    check: z
      .enum(["all", "web_panel", "config_leak", "version_detect"])
      .default("all")
      .describe("Which check to run; 'all' runs every OpenVPN HTTP check."),
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
