// IIS stack checks — ported 1:1 from infra-security-mcp `providers/iis`.
// Every path/payload/condition matches the source exactly; only the transport
// (scope-guarded webhook sender) and the Check/severity adapter are CyberStrike's.
// NOTE: iis_tilde_enum (8.3 short-name enumeration) lives in the separate
// `iis_tilde` tool — it is intentionally NOT ported here.
import z from "zod"
import { defineWebhookTool } from "../define"
import type { HttpSender } from "../transport"
import { get, header, failed, ok, base, summarize, type Check } from "./shared"

export namespace Iis {
  export async function versionDetect(sender: HttpSender, origin: string): Promise<Check> {
    const [main, notFound] = await Promise.all([get(sender, origin), get(sender, `${origin}/__nonexistent_${Date.now()}__`)])
    const serverHeader = (ok(main) ? header(main, "server") : "") || (ok(notFound) ? header(notFound, "server") : "")
    const poweredBy = (ok(main) ? header(main, "x-powered-by") : "") || (ok(notFound) ? header(notFound, "x-powered-by") : "")
    const aspNetVersion = (ok(main) ? header(main, "x-aspnet-version") : "") || (ok(notFound) ? header(notFound, "x-aspnet-version") : "")
    const aspNetMvc = ok(main) ? header(main, "x-aspnetmvc-version") : ""
    const iisMatch = serverHeader.match(/Microsoft-IIS\/([\d.]+)/i)
    const version = iisMatch?.[1] ?? null
    const versionMap: Record<string, string> = {
      "6.0": "Windows Server 2003",
      "7.0": "Windows Server 2008",
      "7.5": "Windows Server 2008 R2",
      "8.0": "Windows Server 2012",
      "8.5": "Windows Server 2012 R2",
      "10.0": "Windows Server 2016/2019/2022",
    }
    const isIIS = serverHeader.toLowerCase().includes("iis") || poweredBy.toLowerCase().includes("asp.net") || !!aspNetVersion
    if (!isIIS) return { check: "version_detect", hit: false, severity: "info", detail: "IIS not detected" }
    const win = version ? versionMap[version] ?? "Unknown" : null
    return {
      check: "version_detect",
      hit: true,
      severity: version || aspNetVersion ? "low" : "info",
      detail: `Microsoft-IIS${version ? ` ${version}` : ""}${win ? ` (${win})` : ""}${poweredBy ? ` X-Powered-By: ${poweredBy}` : ""}${aspNetVersion ? ` ASP.NET ${aspNetVersion}` : ""}${aspNetMvc ? ` MVC ${aspNetMvc}` : ""}`,
      evidence: serverHeader || poweredBy || aspNetVersion || "IIS",
    }
  }

  export async function webconfigLeak(sender: HttpSender, origin: string): Promise<Check> {
    const paths = [
      "/web.config",
      "/web.config.bak",
      "/web.config.old",
      "/web.config.txt",
      "/web.config~",
      "/web.config.swp",
      "/WEB-INF/web.xml",
      "/_web.config",
      "/web.config%00.txt",
      "/web.config::$DATA",
      "/Web.Config",
      "/web.config.zip",
    ]
    for (const p of paths) {
      const res = await get(sender, `${origin}${p}`)
      if (failed(res)) continue
      const isConfig =
        res.status === 200 &&
        (res.body.includes("<configuration>") ||
          res.body.includes("<system.web>") ||
          res.body.includes("connectionString") ||
          res.body.includes("<appSettings>") ||
          res.body.includes("<system.webServer>"))
      if (isConfig) {
        const hasSecrets =
          res.body.includes("connectionString") ||
          res.body.includes("password") ||
          res.body.includes("apiKey") ||
          res.body.includes("machineKey")
        return {
          check: "webconfig_leak",
          hit: true,
          severity: "high",
          detail: `web.config exposed at ${p}${hasSecrets ? " (contains credentials/secrets)" : ""}`,
          evidence: hasSecrets ? "[SENSITIVE] Config contains potential credentials/secrets" : res.body.substring(0, 1000),
        }
      }
    }
    return { check: "webconfig_leak", hit: false, severity: "info", detail: "web.config not exposed" }
  }

  export async function authBypass(sender: HttpSender, origin: string): Promise<Check> {
    const protectedPath = "/admin"
    const url = `${origin}${protectedPath}`
    const baseline = await get(sender, url)
    if (failed(baseline)) return { check: "auth_bypass", hit: false, severity: "info", detail: "baseline request failed" }
    const methods = ["PROPFIND", "OPTIONS", "TRACE", "DEBUG", "PATCH", "HEAD", "PUT", "DELETE", "CONNECT"]
    for (const method of methods) {
      const res = await sender.send({ method, url, headers: {} })
      if (failed(res)) continue
      const bypassLikely = (baseline.status === 401 || baseline.status === 403) && (res.status === 200 || res.status === 207)
      if (bypassLikely)
        return { check: "auth_bypass", hit: true, severity: "high", detail: `IIS auth bypass via ${method} verb on ${protectedPath}`, evidence: `baseline=${baseline.status} ${method}=${res.status}` }
    }
    const pathVariants = [
      `${protectedPath}.`,
      `${protectedPath}%20`,
      `${protectedPath}::$DATA`,
      `${protectedPath}/`,
      `${protectedPath}\\`,
      `${protectedPath}%2e`,
      `${protectedPath};.js`,
    ]
    for (const pv of pathVariants) {
      const res = await get(sender, `${origin}${pv}`)
      if (failed(res)) continue
      const bypassLikely = (baseline.status === 401 || baseline.status === 403) && res.status === 200
      if (bypassLikely)
        return { check: "auth_bypass", hit: true, severity: "high", detail: `IIS auth bypass via path trick ${pv}`, evidence: `baseline=${baseline.status} ${pv}=${res.status}` }
    }
    return { check: "auth_bypass", hit: false, severity: "info", detail: "no verb/path auth bypass" }
  }

  export async function aspnetDebug(sender: HttpSender, origin: string): Promise<Check> {
    const debugPaths = [
      { path: "/trace.axd", type: "ASP.NET Trace" },
      { path: "/elmah.axd", type: "ELMAH Error Log" },
      { path: "/glimpse.axd", type: "Glimpse Debugger" },
      { path: "/WebResource.axd", type: "WebResource Handler" },
      { path: "/ScriptResource.axd", type: "ScriptResource Handler" },
      { path: "/__browserLink/requestData", type: "Browser Link" },
    ]
    for (const dp of debugPaths) {
      const res = await get(sender, `${origin}${dp.path}`)
      if (failed(res)) continue
      if (
        res.status === 200 &&
        (res.body.includes("Trace") ||
          res.body.includes("Error Log") ||
          res.body.includes("Application Trace") ||
          res.body.includes("Request Details") ||
          res.body.includes("ELMAH"))
      )
        return { check: "aspnet_debug", hit: true, severity: "high", detail: `${dp.type} exposed at ${dp.path}`, evidence: res.body.substring(0, 1000) }
    }
    const errorRes = await get(sender, `${origin}/__trigger_error_${Date.now()}.aspx`)
    const errorBody = ok(errorRes) ? errorRes.body : ""
    const customErrorsOff =
      errorBody.includes("Stack Trace:") ||
      errorBody.includes("System.Web") ||
      errorBody.includes("NullReferenceException") ||
      errorBody.includes("Source Error:")
    if (customErrorsOff)
      return { check: "aspnet_debug", hit: true, severity: "medium", detail: "customErrors off — detailed ASP.NET stack traces exposed", evidence: errorBody.substring(0, 1000) }
    const debugMethod = await sender.send({ method: "DEBUG", url: origin, headers: { Command: "stop-debug" } })
    if (ok(debugMethod) && debugMethod.status === 200 && debugMethod.body.includes("OK"))
      return { check: "aspnet_debug", hit: true, severity: "medium", detail: "DEBUG HTTP method enabled (remote debugging)", evidence: debugMethod.body.substring(0, 500) }
    return { check: "aspnet_debug", hit: false, severity: "info", detail: "no debug/trace exposure" }
  }

  const RUNNERS: Record<string, (s: HttpSender, o: string) => Promise<Check>> = {
    version_detect: versionDetect,
    webconfig_leak: webconfigLeak,
    auth_bypass: authBypass,
    aspnet_debug: aspnetDebug,
  }

  export async function run(sender: HttpSender, origin: string, which: string): Promise<Check[]> {
    const names = which === "all" ? Object.keys(RUNNERS) : [which]
    const out: Check[] = []
    for (const n of names) out.push(await RUNNERS[n](sender, origin))
    return out
  }
}

const DESCRIPTION = `Microsoft IIS deterministic checks (version→Windows Server mapping + header leaks, web.config leak via backup/source-disclosure tricks, auth bypass via HTTP verb tampering + path tricks, ASP.NET trace/ELMAH/debug exposure). 1:1 port of the infra-security iis provider. The 8.3 tilde short-name enumeration is handled by the separate iis_tilde tool.

Run after Vortex fingerprints IIS/ASP.NET. Probes go through the scope-guarded replay engine. check="all" (default) runs every check.`

export const IisTestTool = defineWebhookTool({
  name: "iis_test",
  description: DESCRIPTION,
  parameters: z.object({
    target: z.string().describe("Target origin or URL (e.g. https://target.com)."),
    check: z
      .enum(["all", "version_detect", "webconfig_leak", "auth_bypass", "aspnet_debug"])
      .default("all")
      .describe("Which check to run; 'all' runs every iis check."),
  }),
  async run(params, ctx) {
    const origin = base(params.target)
    const results = await Iis.run(ctx.sender, origin, params.check)
    return { target: origin, results }
  },
  format(r) {
    return summarize("iis_test", r.target, r.results)
  },
})
