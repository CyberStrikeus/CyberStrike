// tomcat stack checks — ported from infra-security-mcp `providers/tomcat`.
import z from "zod"
import { defineWebhookTool } from "../define"
import type { HttpSender } from "../transport"
import { get, header, failed, ok, base, host, summarize, type Check } from "./shared"

const CREDS: [string, string][] = [
  ["tomcat", "tomcat"], ["admin", "admin"], ["admin", ""], ["tomcat", "s3cret"],
  ["admin", "tomcat"], ["manager", "manager"], ["role1", "role1"],
]

export namespace Tomcat {
  export async function version(sender: HttpSender, origin: string): Promise<Check> {
    const [root, miss] = await Promise.all([get(sender, origin), get(sender, `${origin}/__404_${Date.now()}__`)])
    const hay = [root, miss].filter(ok).map((r) => `${header(r, "server")} ${r.body.slice(0, 4000)}`).join(" ")
    const m = hay.match(/(?:Apache Tomcat|Apache-Coyote)\/?([\d.]+)?/i)
    const ver = hay.match(/Tomcat\/([\d.]+)/i)
    if (!m) return { check: "version", hit: false, severity: "info", detail: "Tomcat not disclosed" }
    if (!ver) return { check: "version", hit: true, severity: "info", detail: "Tomcat detected (version not disclosed)", evidence: m[0] }
    return { check: "version", hit: true, severity: "low", detail: `Apache Tomcat ${ver[1]} disclosed`, evidence: ver[0] }
  }

  export async function managerExposure(sender: HttpSender, origin: string): Promise<Check> {
    const paths = ["/manager/html", "/manager/status", "/manager/text/list", "/host-manager/html"]
    for (const p of paths) {
      const res = await get(sender, `${origin}${p}`)
      if (failed(res)) continue
      if (res.status === 200 && /(Tomcat Web Application Manager|OK - Listed|Server Status)/i.test(res.body))
        return { check: "manager_exposure", hit: true, severity: "high", detail: `Tomcat Manager open (no auth) at ${p}`, evidence: res.body.slice(0, 200) }
      if (res.status !== 401) continue
      for (const [u, pw] of CREDS) {
        const auth = await get(sender, `${origin}${p}`, { Authorization: `Basic ${btoa(`${u}:${pw}`)}` })
        if (ok(auth) && auth.status === 200)
          return { check: "manager_exposure", hit: true, severity: "critical", detail: `Tomcat Manager default creds ${u}:${pw || "<blank>"} at ${p}`, evidence: `401→200 with ${u}:${pw || "<blank>"}` }
      }
    }
    return { check: "manager_exposure", hit: false, severity: "info", detail: "Tomcat Manager not exposed / default creds rejected" }
  }

  export async function ghostcat(sender: HttpSender, origin: string): Promise<Check> {
    // Heuristic only: infers AJP port reachability over HTTP + a Tomcat Server banner.
    // Not a real AJP (CVE-2020-1938) packet exchange — flagged as such.
    const ajp = await get(sender, `http://${host(origin)}:8009`)
    const root = await get(sender, origin)
    const tomcat = ok(root) && /tomcat|coyote/i.test(header(root, "server") + root.body.slice(0, 1000))
    const reachable = ok(ajp) || (failed(ajp) && !/refused|not found|enotfound/i.test(ajp.error))
    if (tomcat && reachable)
      return { check: "ghostcat", hit: true, severity: "medium", detail: "AJP :8009 appears reachable on a Tomcat host — possible Ghostcat (CVE-2020-1938). HEURISTIC: not confirmed via AJP packet.", evidence: "Tomcat banner + :8009 reachable" }
    return { check: "ghostcat", hit: false, severity: "info", detail: "no Ghostcat indicator (AJP :8009 not reachable or not Tomcat)" }
  }

  export async function examples(sender: HttpSender, origin: string): Promise<Check> {
    const paths = ["/examples/servlets/servlet/RequestInfoExample", "/examples/jsp/snp/snoop.jsp", "/examples/", "/examples/jsp/"]
    for (const p of paths) {
      const res = await get(sender, `${origin}${p}`)
      if (failed(res)) continue
      if (res.status === 200 && /(Example|servlet|JSP|Request Information)/i.test(res.body))
        return { check: "examples", hit: true, severity: "low", detail: `Tomcat example apps deployed at ${p}`, evidence: res.body.slice(0, 200) }
    }
    return { check: "examples", hit: false, severity: "info", detail: "no example servlets/JSPs" }
  }

  export async function warDeploy(sender: HttpSender, origin: string): Promise<Check> {
    for (const [u, pw] of CREDS) {
      const list = await get(sender, `${origin}/manager/text/list`, { Authorization: `Basic ${btoa(`${u}:${pw}`)}` })
      if (ok(list) && list.status === 200 && list.body.includes("OK - Listed"))
        return { check: "war_deploy", hit: true, severity: "critical", detail: `Tomcat text Manager writable with ${u}:${pw || "<blank>"} — WAR-deploy RCE path`, evidence: "text/list returned OK with default creds" }
    }
    return { check: "war_deploy", hit: false, severity: "info", detail: "text Manager not reachable with default creds" }
  }

  const RUNNERS: Record<string, (s: HttpSender, o: string) => Promise<Check>> = {
    version,
    manager_exposure: managerExposure,
    ghostcat,
    examples,
    war_deploy: warDeploy,
  }

  export async function run(sender: HttpSender, origin: string, which: string): Promise<Check[]> {
    const names = which === "all" ? Object.keys(RUNNERS) : [which]
    const out: Check[] = []
    for (const n of names) out.push(await RUNNERS[n](sender, origin))
    return out
  }
}

const DESCRIPTION = `Apache Tomcat deterministic checks (version disclosure, Manager/host-manager exposure + default creds, Ghostcat AJP heuristic, example apps, text-Manager WAR-deploy RCE path).

Run after Vortex fingerprints Tomcat/Coyote. Ghostcat is a reachability HEURISTIC, not an AJP exploit. Probes go through the scope-guarded replay engine. check="all" (default) runs every check.`

export const TomcatTestTool = defineWebhookTool({
  name: "tomcat_test",
  description: DESCRIPTION,
  parameters: z.object({
    target: z.string().describe("Target origin or URL (e.g. https://target.com)."),
    check: z
      .enum(["all", "version", "manager_exposure", "ghostcat", "examples", "war_deploy"])
      .default("all")
      .describe("Which check to run; 'all' runs every Tomcat check."),
  }),
  async run(params, ctx) {
    const origin = base(params.target)
    const results = await Tomcat.run(ctx.sender, origin, params.check)
    return { target: origin, results }
  },
  format(r) {
    return summarize("tomcat_test", r.target, r.results)
  },
})
