// dotnet (ASP.NET) stack checks — ported 1:1 from infra-security-mcp `providers/dotnet`.
// Every path/payload/condition matches the source exactly; only the transport
// (scope-guarded webhook sender) and the Check/severity adapter are CyberStrike's.
import z from "zod"
import { defineWebhookTool } from "../define"
import type { HttpSender } from "../transport"
import { get, header, failed, ok, base, summarize, type Check, type Severity } from "./shared"

const SEV: Severity[] = ["info", "low", "medium", "high", "critical"]
const top = (list: Severity[]): Severity => list.reduce((a, b) => (SEV.indexOf(b) > SEV.indexOf(a) ? b : a), "info" as Severity)

// base64 byte length via atob (source used Buffer.from(v, "base64").length); spaces → +.
function b64len(v: string): number {
  try {
    return atob(v.replace(/ /g, "+")).length
  } catch {
    return 0
  }
}

export namespace Dotnet {
  export async function detect(sender: HttpSender, origin: string): Promise<Check> {
    const findings: string[] = []

    const main = await get(sender, origin)
    const mainBody = ok(main) ? main.body : ""

    const poweredBy = ok(main) ? header(main, "x-powered-by") : ""
    if (poweredBy.toLowerCase().includes("asp.net")) findings.push(`X-Powered-By: ${poweredBy}`)

    const aspnetVer = ok(main) ? header(main, "x-aspnet-version") : ""
    if (aspnetVer) findings.push(`X-AspNet-Version: ${aspnetVer} (version disclosure)`)

    const mvcVer = ok(main) ? header(main, "x-aspnetmvc-version") : ""
    if (mvcVer) findings.push(`X-AspNetMvc-Version: ${mvcVer} (version disclosure)`)

    if (mainBody.includes("__VIEWSTATE")) findings.push("__VIEWSTATE hidden field present — ASP.NET WebForms")
    if (mainBody.includes("__EVENTVALIDATION")) findings.push("__EVENTVALIDATION field present")
    if (mainBody.includes(".aspx")) findings.push(".aspx file extension in page links")

    const cookie = ok(main) ? header(main, "set-cookie") : ""
    if (cookie.includes("ASP.NET_SessionId")) findings.push("ASP.NET_SessionId cookie set")
    if (cookie.includes(".AspNetCore")) findings.push("ASP.NET Core session cookie detected")

    const bogus = await get(sender, `${origin}/${crypto.randomUUID().slice(0, 8)}.aspx`)
    const bogusBody = ok(bogus) ? bogus.body : ""
    if (bogusBody.includes("Runtime Error") || bogusBody.includes("Server Error in"))
      findings.push("ASP.NET detailed error page on invalid .aspx path")
    if (bogusBody.includes("Microsoft .NET Framework"))
      findings.push(".NET Framework version disclosed in error page")

    if (findings.length === 0) return { check: "detect", hit: false, severity: "info", detail: "ASP.NET not detected" }
    return { check: "detect", hit: true, severity: "info", detail: findings.join("; "), evidence: findings.join(" | ") }
  }

  export async function viewstateCheck(sender: HttpSender, origin: string): Promise<Check> {
    const res = await get(sender, origin)
    const body = ok(res) ? res.body : ""
    const findings: { check: string; severity: Severity; details: string }[] = []

    const vsMatch = body.match(/name="__VIEWSTATE"[^>]*value="([^"]*)"/)
    if (!vsMatch) return { check: "viewstate_check", hit: false, severity: "info", detail: "no __VIEWSTATE on page" }

    const vsValue = vsMatch[1]
    const decodedLen = b64len(vsValue)

    if (decodedLen < 20) {
      findings.push({ check: "viewstate_no_mac", severity: "critical", details: "ViewState appears unprotected — no MAC signature (< 20 bytes). High risk of deserialization attack." })
    }

    if (vsValue.length > 0 && !body.includes("__VIEWSTATEGENERATOR")) {
      findings.push({ check: "no_viewstate_generator", severity: "low", details: "__VIEWSTATEGENERATOR field missing" })
    }

    const evMatch = body.match(/name="__EVENTVALIDATION"[^>]*value="([^"]*)"/)
    if (!evMatch) {
      findings.push({ check: "no_event_validation", severity: "medium", details: "__EVENTVALIDATION missing — event validation may be disabled" })
    }

    const tamperRes = await sender.send({
      method: "POST",
      url: origin,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `__VIEWSTATE=${encodeURIComponent(btoa("AAAA"))}`,
    })
    const tamperBody = ok(tamperRes) ? tamperRes.body : ""
    const tamperStatus = ok(tamperRes) ? tamperRes.status : 0

    if (tamperBody.includes("MAC")) {
      findings.push({ check: "mac_validation_on", severity: "info", details: "ViewState MAC validation is enabled (tampered ViewState rejected with MAC error)" })
    } else if (tamperStatus === 500 && !tamperBody.includes("validation")) {
      findings.push({ check: "viewstate_tamper_processed", severity: "high", details: "Tampered ViewState processed without MAC validation error — possible deserialization vector" })
    }

    if (findings.length === 0) return { check: "viewstate_check", hit: false, severity: "info", detail: `__VIEWSTATE present (${vsValue.length} bytes), no issue` }
    const sev = top(findings.map((f) => f.severity))
    return {
      check: "viewstate_check",
      hit: sev !== "info",
      severity: sev,
      detail: findings.map((f) => `${f.check}[${f.severity}]: ${f.details}`).join("; "),
      evidence: `viewStateSize=${vsValue.length}`,
    }
  }

  export async function elmahExposure(sender: HttpSender, origin: string): Promise<Check> {
    const paths = ["/elmah.axd", "/elmah.axd/", "/elmah", "/errorlog.axd"]
    const findings: { path: string; status: number; details: string }[] = []

    for (const p of paths) {
      const res = await get(sender, `${origin}${p}`)
      if (ok(res) && res.status === 200 && (res.body.includes("Error Log") || res.body.includes("ELMAH") || res.body.includes("errorDetail"))) {
        findings.push({ path: p, status: res.status, details: "ELMAH error log accessible — contains stack traces, server variables, request details" })
      }
    }

    if (findings.length > 0) {
      const rss = await get(sender, `${origin}/elmah.axd/rss`)
      if (ok(rss) && rss.status === 200 && rss.body.includes("<rss")) {
        findings.push({ path: "/elmah.axd/rss", status: rss.status, details: "ELMAH RSS feed accessible — error logs retrievable as XML feed" })
      }

      const download = await get(sender, `${origin}/elmah.axd/download`)
      if (ok(download) && download.status === 200) {
        findings.push({ path: "/elmah.axd/download", status: download.status, details: "ELMAH CSV download accessible — full error log export" })
      }
    }

    if (findings.length === 0) return { check: "elmah_exposure", hit: false, severity: "info", detail: "ELMAH not exposed" }
    return {
      check: "elmah_exposure",
      hit: true,
      severity: "high",
      detail: findings.map((f) => `${f.path}[${f.status}]: ${f.details}`).join("; "),
      evidence: findings.map((f) => f.path).join(", "),
    }
  }

  export async function traceEnabled(sender: HttpSender, origin: string): Promise<Check> {
    const findings: { check: string; severity: Severity; details: string }[] = []

    const trace = await get(sender, `${origin}/trace.axd`)
    if (ok(trace) && trace.status === 200 && (trace.body.includes("Application Trace") || trace.body.includes("Request Details"))) {
      findings.push({ check: "trace_axd_exposed", severity: "high", details: "trace.axd accessible — reveals request/response details, session state, headers, form data for every request" })
    }

    const bogus = await get(sender, `${origin}/${crypto.randomUUID().slice(0, 8)}.aspx`)
    const bogusBody = ok(bogus) ? bogus.body : ""
    if (bogusBody.includes("Source Error") || bogusBody.includes("Source File") || bogusBody.includes("Stack Trace:")) {
      findings.push({ check: "detailed_errors_on", severity: "medium", details: "Detailed ASP.NET error pages enabled in production — leaks source code snippets and stack traces" })
    }
    if (bogusBody.includes("Version Information:")) {
      const versionMatch = bogusBody.match(/Version Information:.*?(\d+\.\d+\.\d+\.\d+)/)
      findings.push({ check: "version_in_error", severity: "low", details: `Framework version disclosed in error page: ${versionMatch?.[1] ?? "unknown"}` })
    }

    const customErrors = await get(sender, `${origin}/web.config`)
    if (ok(customErrors) && customErrors.status === 200 && customErrors.body.includes("customErrors")) {
      findings.push({ check: "web_config_exposed", severity: "critical", details: "web.config file accessible — may contain connection strings, API keys, and security configuration" })
    }

    if (findings.length === 0) return { check: "trace_enabled", hit: false, severity: "info", detail: "no tracing / detailed-error exposure" }
    return {
      check: "trace_enabled",
      hit: true,
      severity: top(findings.map((f) => f.severity)),
      detail: findings.map((f) => `${f.check}[${f.severity}]: ${f.details}`).join("; "),
      evidence: findings.map((f) => f.check).join(", "),
    }
  }

  export async function blazorDebug(sender: HttpSender, origin: string): Promise<Check> {
    const findings: { check: string; severity: Severity; details: string }[] = []

    const main = await get(sender, origin)
    const mainBody = ok(main) ? main.body : ""
    const isBlazor = mainBody.includes("blazor.webassembly.js") || mainBody.includes("_framework/blazor") || mainBody.includes("blazor.server.js")

    if (!isBlazor) return { check: "blazor_debug", hit: false, severity: "info", detail: "not a Blazor app" }

    findings.push({ check: "blazor_detected", severity: "info", details: mainBody.includes("blazor.server.js") ? "Blazor Server detected" : "Blazor WebAssembly detected" })

    const framework = await get(sender, `${origin}/_framework/blazor.boot.json`)
    if (ok(framework) && framework.status === 200) {
      findings.push({ check: "boot_json_exposed", severity: "medium", details: `_framework/blazor.boot.json accessible — lists all assemblies loaded by the app` })

      try {
        const boot = JSON.parse(framework.body)
        const resources = boot.resources?.assembly ?? boot.resources?.runtime ?? {}
        const dllNames = Object.keys(resources).filter((n: string) => n.endsWith(".dll"))
        if (dllNames.length > 0) {
          findings.push({ check: "dll_enumeration", severity: "medium", details: `${dllNames.length} assemblies listed: ${dllNames.slice(0, 10).join(", ")}${dllNames.length > 10 ? "..." : ""}` })
        }

        if (boot.cacheBootResources === false || boot.linkerEnabled === false) {
          findings.push({ check: "debug_config", severity: "high", details: "Debug configuration detected in boot.json (caching/linking disabled)" })
        }
      } catch {
        /* non-JSON body */
      }
    }

    const pdb = await get(sender, `${origin}/_framework/blazor.webassembly.js.map`)
    if (ok(pdb) && pdb.status === 200) {
      findings.push({ check: "source_maps", severity: "medium", details: "Source maps accessible — aids reverse engineering of the application" })
    }

    return {
      check: "blazor_debug",
      hit: true,
      severity: top(findings.map((f) => f.severity)),
      detail: findings.map((f) => `${f.check}[${f.severity}]: ${f.details}`).join("; "),
      evidence: findings.map((f) => f.check).join(", "),
    }
  }

  const RUNNERS: Record<string, (s: HttpSender, o: string) => Promise<Check>> = {
    detect,
    viewstate_check: viewstateCheck,
    elmah_exposure: elmahExposure,
    trace_enabled: traceEnabled,
    blazor_debug: blazorDebug,
  }

  export async function run(sender: HttpSender, origin: string, which: string): Promise<Check[]> {
    const names = which === "all" ? Object.keys(RUNNERS) : [which]
    const out: Check[] = []
    for (const n of names) out.push(await RUNNERS[n](sender, origin))
    return out
  }
}

const DESCRIPTION = `ASP.NET deterministic checks (detection via X-Powered-By/X-AspNet-Version/__VIEWSTATE, ViewState MAC/encryption analysis — CVE-2020-0688, ELMAH error-log exposure, trace.axd + detailed errors + web.config leak, Blazor debug/_framework DLL enumeration). 1:1 port of the infra-security dotnet provider.

Run after Vortex fingerprints ASP.NET. Probes go through the scope-guarded replay engine. check="all" (default) runs every check.`

export const DotnetTestTool = defineWebhookTool({
  name: "dotnet_test",
  description: DESCRIPTION,
  parameters: z.object({
    target: z.string().describe("Target origin or URL (e.g. https://target.com)."),
    check: z
      .enum(["all", "detect", "viewstate_check", "elmah_exposure", "trace_enabled", "blazor_debug"])
      .default("all")
      .describe("Which check to run; 'all' runs every ASP.NET check."),
  }),
  async run(params, ctx) {
    const origin = base(params.target)
    const results = await Dotnet.run(ctx.sender, origin, params.check)
    return { target: origin, results }
  },
  format(r) {
    return summarize("dotnet_test", r.target, r.results)
  },
})
