// Tomcat stack checks — ported 1:1 from infra-security-mcp `providers/tomcat`.
// Every path/payload/condition matches the source exactly; only the transport
// (scope-guarded webhook sender) and the Check/severity adapter are CyberStrike's.
import z from "zod"
import { defineWebhookTool } from "../define"
import type { HttpSender } from "../transport"
import { get, header, failed, ok, base, host, summarize, type Check } from "./shared"

export namespace Tomcat {
  export async function versionDetect(sender: HttpSender, origin: string): Promise<Check> {
    const [main, notFound, root] = await Promise.all([get(sender, origin), get(sender, `${origin}/__nonexistent_${Date.now()}__`), get(sender, `${origin}/`)])
    const serverHeader = (ok(main) ? header(main, "server") : "") || (ok(notFound) ? header(notFound, "server") : "")
    const notFoundBody = ok(notFound) ? notFound.body : ""
    const rootBody = ok(root) ? root.body : ""
    const headerMatch = serverHeader.match(/Apache-Coyote\/([\d.]+)/i) ?? serverHeader.match(/Apache Tomcat\/([\d.]+)/i)
    const bodyMatch = notFoundBody.match(/Apache Tomcat\/([\d.]+)/i) ?? rootBody.match(/Apache Tomcat\/([\d.]+)/i)
    const version = headerMatch?.[1] ?? bodyMatch?.[1] ?? null
    const isTomcat =
      serverHeader.toLowerCase().includes("tomcat") ||
      serverHeader.toLowerCase().includes("coyote") ||
      notFoundBody.toLowerCase().includes("tomcat") ||
      rootBody.toLowerCase().includes("tomcat")
    const defaultPage = rootBody.includes("If you're seeing this") && rootBody.includes("Tomcat")
    if (!isTomcat) return { check: "version_detect", hit: false, severity: "info", detail: "Tomcat not detected" }
    return {
      check: "version_detect",
      hit: true,
      severity: version ? "low" : "info",
      detail: `Apache Tomcat${version ? ` ${version}` : ""} detected${defaultPage ? " (default page exposed)" : ""}${bodyMatch ? " (error page leaks version)" : ""}`,
      evidence: serverHeader || (bodyMatch ? bodyMatch[0] : "Tomcat"),
    }
  }

  export async function managerExposure(sender: HttpSender, origin: string): Promise<Check> {
    const managerPaths = ["/manager/html", "/manager/status", "/manager/text/list", "/host-manager/html"]
    const defaultCreds = [
      { user: "tomcat", pass: "tomcat" },
      { user: "admin", pass: "admin" },
      { user: "admin", pass: "" },
      { user: "tomcat", pass: "s3cret" },
      { user: "admin", pass: "tomcat" },
      { user: "manager", pass: "manager" },
      { user: "role1", pass: "role1" },
    ]
    for (const mp of managerPaths) {
      const res = await get(sender, `${origin}${mp}`)
      if (failed(res)) continue
      if (res.status === 200)
        return { check: "manager_exposure", hit: true, severity: "high", detail: `Tomcat Manager accessible (no auth) at ${mp} — WAR deploy → RCE`, evidence: `${mp} status=${res.status}` }
      if (res.status === 401) {
        for (const cred of defaultCreds) {
          const authHeader = "Basic " + btoa(`${cred.user}:${cred.pass}`)
          const authRes = await get(sender, `${origin}${mp}`, { Authorization: authHeader })
          if (ok(authRes) && authRes.status === 200)
            return { check: "manager_exposure", hit: true, severity: "critical", detail: `Tomcat Manager default creds ${cred.user}:${cred.pass} at ${mp} — WAR deploy → RCE`, evidence: `${cred.user}:${cred.pass} → 200` }
        }
      }
    }
    return { check: "manager_exposure", hit: false, severity: "info", detail: "Tomcat Manager not accessible" }
  }

  export async function ghostcat(sender: HttpSender, origin: string): Promise<Check> {
    const port = 8009
    const httpRes = await get(sender, origin)
    const serverHeader = ok(httpRes) ? header(httpRes, "server") : ""
    const isTomcat = serverHeader.toLowerCase().includes("tomcat") || serverHeader.toLowerCase().includes("coyote")
    // HEURISTIC: no AJP packet is sent — we only probe HTTP on the AJP port to
    // guess whether 8009 is open. A non-ECONNREFUSED result is treated as "open".
    let ajpPortOpen = false
    const ajpRes = await get(sender, `http://${host(origin)}:${port}/`)
    if (ok(ajpRes)) ajpPortOpen = ajpRes.status > 0 || ajpRes.body.length > 0
    const ajpCheck = await get(sender, `http://${host(origin)}:${port}/`)
    if (failed(ajpCheck)) ajpPortOpen = ajpPortOpen || !ajpCheck.error.includes("ECONNREFUSED")
    const vulnerable = ajpPortOpen && isTomcat
    if (vulnerable)
      return {
        check: "ghostcat",
        hit: true,
        severity: "high",
        detail: `Ghostcat (CVE-2020-1938) HEURISTIC: AJP port ${port} appears open on a Tomcat host — verify with a dedicated AJP client (no AJP packet was sent)`,
        evidence: `server=${serverHeader || "?"} ajp:${port} open(heuristic)`,
      }
    return { check: "ghostcat", hit: false, severity: "info", detail: `Ghostcat HEURISTIC: AJP port ${port} appears closed/filtered or host is not Tomcat (no AJP packet was sent)` }
  }

  export async function examples(sender: HttpSender, origin: string): Promise<Check> {
    const examplePaths = [
      { path: "/examples/", desc: "Examples root" },
      { path: "/examples/servlets/", desc: "Servlet examples" },
      { path: "/examples/jsp/", desc: "JSP examples" },
      { path: "/examples/jsp/snp/snoop.jsp", desc: "Snoop JSP (server info)" },
      { path: "/examples/servlets/servlet/RequestInfoExample", desc: "Request info" },
      { path: "/examples/servlets/servlet/SessionExample", desc: "Session manipulation" },
      { path: "/examples/servlets/servlet/CookieExample", desc: "Cookie example" },
      { path: "/examples/websocket/", desc: "WebSocket examples" },
    ]
    for (const ep of examplePaths) {
      const res = await get(sender, `${origin}${ep.path}`)
      if (failed(res)) continue
      if (
        res.status === 200 &&
        (res.body.includes("Example") ||
          res.body.includes("servlet") ||
          res.body.includes("JSP") ||
          res.body.toLowerCase().includes("tomcat"))
      )
        return { check: "examples", hit: true, severity: "medium", detail: `Tomcat example servlet/JSP exposed at ${ep.path} (${ep.desc})`, evidence: res.body.substring(0, 500) }
    }
    return { check: "examples", hit: false, severity: "info", detail: "no exposed example servlets/JSPs" }
  }

  export async function warDeploy(sender: HttpSender, origin: string): Promise<Check> {
    const textList = await get(sender, `${origin}/manager/text/list`)
    const textAccessible = ok(textList) && textList.status === 200 && textList.body.includes("/")
    const deployCheck = await sender.send({ method: "PUT", url: `${origin}/manager/text/deploy?path=/test_probe`, headers: {} })
    const htmlManager = await get(sender, `${origin}/manager/html`)
    const htmlStatus = ok(htmlManager) ? htmlManager.status : 0
    let defaultCredsWork = false
    if (ok(deployCheck) && deployCheck.status === 401) {
      const creds = [
        { user: "tomcat", pass: "tomcat" },
        { user: "admin", pass: "admin" },
      ]
      for (const c of creds) {
        const auth = "Basic " + btoa(`${c.user}:${c.pass}`)
        const res = await get(sender, `${origin}/manager/text/list`, { Authorization: auth })
        if (ok(res) && res.status === 200) {
          defaultCredsWork = true
          break
        }
      }
    }
    const deployStatus = ok(deployCheck) ? deployCheck.status : 0
    if (textAccessible)
      return { check: "war_deploy", hit: true, severity: "critical", detail: "Tomcat Manager text API accessible — attacker can upload a malicious WAR for RCE", evidence: `text/list=200 deploy=${deployStatus} html=${htmlStatus}` }
    if (defaultCredsWork)
      return { check: "war_deploy", hit: true, severity: "critical", detail: "Tomcat Manager text API reachable with default creds — WAR upload → RCE", evidence: `deploy=${deployStatus} html=${htmlStatus} default-creds→200` }
    return { check: "war_deploy", hit: false, severity: "info", detail: "WAR deployment not accessible" }
  }

  const RUNNERS: Record<string, (s: HttpSender, o: string) => Promise<Check>> = {
    version_detect: versionDetect,
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

const DESCRIPTION = `Apache Tomcat deterministic checks (version/default-page disclosure, Manager/Host-Manager exposure + default-credential spray, Ghostcat CVE-2020-1938 AJP HEURISTIC, example servlet/JSP exposure, Manager text-API WAR deploy → RCE). 1:1 port of the infra-security tomcat provider. ghostcat is an HTTP reachability heuristic — it sends no AJP packet.

Run after Vortex fingerprints Tomcat/Coyote. Probes go through the scope-guarded replay engine. check="all" (default) runs every check.`

export const TomcatTestTool = defineWebhookTool({
  name: "tomcat_test",
  description: DESCRIPTION,
  parameters: z.object({
    target: z.string().describe("Target origin or URL (e.g. https://target.com)."),
    check: z
      .enum(["all", "version_detect", "manager_exposure", "ghostcat", "examples", "war_deploy"])
      .default("all")
      .describe("Which check to run; 'all' runs every tomcat check."),
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
