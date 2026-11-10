// ssh stack checks (HTTP subset) — ported from infra-security-mcp `providers/ssh`.
// The raw-TCP checks (banner grab, KEXINIT algo audit, auth methods, key enum) need
// a scoped TCP transport and are deferred (see the raw-socket follow-up issue).
import z from "zod"
import { defineWebhookTool } from "../define"
import type { HttpSender } from "../transport"
import { get, failed, base, host, withPort, summarize, type Check } from "./shared"

export namespace Ssh {
  export async function webExposure(sender: HttpSender, origin: string): Promise<Check> {
    const h = host(origin)
    const targets = [
      `${origin}/shellinabox/`, `${withPort(origin, 4200)}/`, `${origin}/webssh/`, `${origin}/guacamole/`,
      `${withPort(origin, 8080)}/guacamole/`, `${origin}/ttyd/`, `${withPort(origin, 7681)}/`, `${origin}/wetty/`,
    ]
    for (const t of targets) {
      const res = await get(sender, t)
      if (failed(res)) continue
      if (res.status < 400 && /(Shell In A Box|guacamole|ttyd|wetty|webssh|terminal)/i.test(res.body))
        return { check: "web_exposure", hit: true, severity: "high", detail: `browser-based SSH terminal exposed at ${t}`, evidence: res.body.slice(0, 120) }
    }
    return { check: "web_exposure", hit: false, severity: "info", detail: `no browser SSH terminal on ${h}` }
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

const DESCRIPTION = `SSH HTTP checks (browser-based SSH terminal exposure — ShellInABox / Guacamole / ttyd / wetty / webssh).

The raw-TCP checks (banner grab, KEXINIT weak-algorithm audit, auth-method enum, CVE-2018-15473 key enum) are deferred to a scoped TCP transport. Probes go through the scope-guarded replay engine.`

export const SshTestTool = defineWebhookTool({
  name: "ssh_test",
  description: DESCRIPTION,
  parameters: z.object({
    target: z.string().describe("Target origin or URL (e.g. https://target.com)."),
    check: z.enum(["all", "web_exposure"]).default("all").describe("Which HTTP check to run."),
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
