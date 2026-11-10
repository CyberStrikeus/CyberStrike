// rdp stack checks (HTTP subset) — ported from infra-security-mcp `providers/rdp`.
// The raw-TCP TPKT/X.224 checks (detect, NLA, BlueKeep, encryption) need a scoped
// TCP transport and are deferred (see the raw-socket follow-up issue).
import z from "zod"
import { defineWebhookTool } from "../define"
import type { HttpSender } from "../transport"
import { get, failed, base, summarize, type Check } from "./shared"

export namespace Rdp {
  export async function webExposure(sender: HttpSender, origin: string): Promise<Check> {
    const paths = ["/RDWeb/", "/RDWeb/Pages/en-US/login.aspx", "/RDWeb/Feed/webfeed.aspx", "/rpc", "/remoteDesktopGateway/"]
    for (const p of paths) {
      const res = await get(sender, `${origin}${p}`)
      if (failed(res)) continue
      if (res.status < 500 && /(RD Web Access|RDWeb|Remote Desktop|RDGateway|tswa)/i.test(res.body))
        return { check: "web_exposure", hit: true, severity: "medium", detail: `RD Web Access / RD Gateway exposed at ${p}`, evidence: res.body.slice(0, 120) }
    }
    return { check: "web_exposure", hit: false, severity: "info", detail: "no RDWeb/RD Gateway web surface" }
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

const DESCRIPTION = `RDP HTTP checks (RD Web Access / RD Gateway web-surface exposure).

The raw-TCP TPKT/X.224 checks (detection, NLA, BlueKeep CVE-2019-0708 heuristic, encryption) are deferred to a scoped TCP transport. Probes go through the scope-guarded replay engine.`

export const RdpTestTool = defineWebhookTool({
  name: "rdp_test",
  description: DESCRIPTION,
  parameters: z.object({
    target: z.string().describe("Target origin or URL (e.g. https://target.com)."),
    check: z.enum(["all", "web_exposure"]).default("all").describe("Which HTTP check to run."),
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
