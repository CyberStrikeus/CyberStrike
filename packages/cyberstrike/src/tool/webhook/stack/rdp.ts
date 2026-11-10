// RDP stack checks — 1:1 port of the HTTP-based check in infra-security-mcp
// `providers/rdp`. Every RD Web Access / RD Gateway path and indicator matches
// the source exactly; only the transport (scope-guarded webhook sender) and the
// Check/severity adapter are CyberStrike's.
// NOTE: the raw-TCP checks (rdp_detect, rdp_nla_check, rdp_bluekeep_check,
// rdp_encryption_check — X.224 Connection Request on port 3389) are node:net
// socket probes and are intentionally NOT ported here — deferred to #32.
import z from "zod"
import { defineWebhookTool } from "../define"
import type { HttpSender } from "../transport"
import { get, failed, base, summarize, verdict, type Check, type Finding } from "./shared"

export namespace Rdp {
  export async function webExposure(sender: HttpSender, origin: string): Promise<Check> {
    const paths = [
      { path: "/RDWeb/", name: "RD Web Access" },
      { path: "/rdweb/", name: "RD Web Access (lowercase)" },
      { path: "/RDWeb/Pages/en-US/login.aspx", name: "RD Web Access Login" },
      { path: "/RDWeb/Feed/webfeed.aspx", name: "RD Web Feed" },
      { path: "/rpc", name: "RPC over HTTP (RD Gateway)" },
      { path: "/remoteDesktopGateway/", name: "RD Gateway" },
    ]
    const indicators = ["rdweb", "remote desktop", "rd web access", "tswa", "rdgateway"]

    const findings: Finding[] = []
    for (const p of paths) {
      const res = await get(sender, `${origin}${p.path}`)
      if (failed(res)) continue
      const bodyLower = res.body.toLowerCase()
      const matched = indicators.filter((i) => bodyLower.includes(i))
      if (matched.length > 0 || (res.status >= 200 && res.status < 400 && bodyLower.includes("login"))) findings.push({ severity: "medium", detail: `${p.name} exposed at ${origin}${p.path} (status ${res.status})${matched.length ? ` — indicators: ${matched.join(", ")}` : " — login page"}`, evidence: bodyLower.match(/<title>([^<]*)<\/title>/)?.[1]?.trim() })
    }

    return verdict("web_exposure", findings, "no RDP web gateway exposed")
  }

  const RUNNERS: Record<string, (s: HttpSender, o: string) => Promise<Check>> = {
    web_exposure: webExposure,
  }

  export async function run(sender: HttpSender, origin: string, which: string): Promise<Check[]> {
    const names = which === "all" ? Object.keys(RUNNERS) : [which]
    const out: Check[] = []
    for (const n of names) out.push(await RUNNERS[n](sender, origin))
    return out
  }
}

const DESCRIPTION = `RDP HTTP check (Remote Desktop Web Access / RD Gateway exposure at /RDWeb/, /rdweb/, /RDWeb/Pages/en-US/login.aspx, /RDWeb/Feed/webfeed.aspx, /rpc, /remoteDesktopGateway/ — reveals internal resource names and provides browser-based RDP access). 1:1 port of the HTTP check in the infra-security rdp provider.

NOTE: the raw-TCP checks (rdp_detect, rdp_nla_check, rdp_bluekeep_check, rdp_encryption_check — X.224 Connection Request on port 3389) are node:net socket probes and are deferred to #32; this tool covers only the HTTP-reachable surface. check="all" (default) runs every check.`

export const RdpTestTool = defineWebhookTool({
  name: "rdp_test",
  description: DESCRIPTION,
  parameters: z.object({
    target: z.string().describe("Target origin or URL (e.g. https://target.com)."),
    check: z
      .enum(["all", "web_exposure"])
      .default("all")
      .describe("Which check to run; 'all' runs every RDP HTTP check."),
  }),
  async run(params, ctx) {
    const origin = base(params.target)
    const results = await Rdp.run(ctx.sender, origin, params.check)
    return { target: origin, results }
  },
  format(r) {
    return summarize("rdp_test", r.target, r.results)
  },
})
