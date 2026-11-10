// SSH stack checks — 1:1 port of the HTTP-based check in infra-security-mcp
// `providers/ssh`. Every browser-terminal path/indicator matches the source
// exactly; only the transport (scope-guarded webhook sender) and the
// Check/severity adapter are CyberStrike's.
// NOTE: the raw-TCP checks (ssh_banner_grab, ssh_algo_audit, ssh_auth_methods,
// ssh_key_enum — version-banner grab and KEXINIT parse on port 22) are node:net
// socket probes and are intentionally NOT ported here — deferred to #32.
import z from "zod"
import { defineWebhookTool } from "../define"
import type { HttpSender } from "../transport"
import { get, failed, base, summarize, verdict, type Check, type Finding } from "./shared"

export namespace Ssh {
  export async function webExposure(sender: HttpSender, origin: string): Promise<Check> {
    const panels = [
      { path: "/shellinabox/", indicators: ["shellinabox", "shell in a box"], name: "Shellinabox" },
      { path: ":4200/", indicators: ["shellinabox", "shell in a box"], name: "Shellinabox (default port)" },
      { path: "/webssh/", indicators: ["webssh", "web ssh", "ssh client"], name: "WebSSH" },
      { path: "/ssh/", indicators: ["webssh", "terminal", "ssh"], name: "Web SSH (generic)" },
      { path: "/guacamole/", indicators: ["guacamole", "apache guacamole"], name: "Apache Guacamole" },
      { path: ":8080/guacamole/", indicators: ["guacamole"], name: "Guacamole (8080)" },
      { path: "/ttyd/", indicators: ["ttyd", "terminal"], name: "ttyd" },
      { path: ":7681/", indicators: ["ttyd", "terminal"], name: "ttyd (default port)" },
      { path: "/wetty/", indicators: ["wetty", "terminal"], name: "WeTTY" },
      { path: ":3000/wetty/", indicators: ["wetty"], name: "WeTTY (3000)" },
    ]

    const findings: Finding[] = []
    for (const panel of panels) {
      const url = panel.path.startsWith(":") ? `${origin.replace(/:\d+/, "")}${panel.path}` : `${origin}${panel.path}`
      const res = await get(sender, url)
      if (failed(res)) continue
      const bodyLower = res.body.toLowerCase()
      const matched = panel.indicators.filter((i) => bodyLower.includes(i))
      if (matched.length > 0) findings.push({ severity: "high", detail: `${panel.name} exposed at ${url} (status ${res.status}) — indicators: ${matched.join(", ")}`, evidence: bodyLower.match(/<title>([^<]*)<\/title>/)?.[1]?.trim() })
    }

    return verdict("web_exposure", findings, "no browser-based SSH terminal exposed")
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

const DESCRIPTION = `SSH HTTP check (browser-based terminal exposure: Shellinabox, WebSSH, Apache Guacamole, ttyd, WeTTY at /shellinabox/, :4200/, /webssh/, /ssh/, /guacamole/, :8080/guacamole/, /ttyd/, :7681/, /wetty/, :3000/wetty/ — provides direct browser shell access). 1:1 port of the HTTP check in the infra-security ssh provider.

NOTE: the raw-TCP checks (ssh_banner_grab, ssh_algo_audit, ssh_auth_methods, ssh_key_enum — banner grab and KEXINIT algorithm audit on port 22) are node:net socket probes and are deferred to #32; this tool covers only the HTTP-reachable surface. check="all" (default) runs every check.`

export const SshTestTool = defineWebhookTool({
  name: "ssh_test",
  description: DESCRIPTION,
  parameters: z.object({
    target: z.string().describe("Target origin or URL (e.g. https://target.com)."),
    check: z
      .enum(["all", "web_exposure"])
      .default("all")
      .describe("Which check to run; 'all' runs every SSH HTTP check."),
  }),
  async run(params, ctx) {
    const origin = base(params.target)
    const results = await Ssh.run(ctx.sender, origin, params.check)
    return { target: origin, results }
  },
  format(r) {
    return summarize("ssh_test", r.target, r.results)
  },
})
