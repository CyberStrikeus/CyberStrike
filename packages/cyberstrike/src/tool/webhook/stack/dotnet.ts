// dotnet stack checks — ported from infra-security-mcp `providers/dotnet`.
import z from "zod"
import { defineWebhookTool } from "../define"
import type { HttpSender } from "../transport"
import { get, header, failed, ok, base, summarize, type Check } from "./shared"

export namespace Dotnet {
  export async function detect(sender: HttpSender, origin: string): Promise<Check> {
    const res = await get(sender, origin)
    if (failed(res)) return { check: "detect", hit: false, severity: "info", detail: "no response" }
    const dotnet =
      /ASP\.NET/i.test(header(res, "x-powered-by")) ||
      header(res, "x-aspnet-version") !== "" ||
      /__VIEWSTATE|__EVENTVALIDATION/.test(res.body) ||
      /ASP\.NET_SessionId|\.AspNetCore/.test(header(res, "set-cookie"))
    if (!dotnet) return { check: "detect", hit: false, severity: "info", detail: "ASP.NET not detected" }
    return { check: "detect", hit: true, severity: "info", detail: "ASP.NET / ASP.NET Core detected", evidence: header(res, "x-aspnet-version") || header(res, "x-powered-by") || "__VIEWSTATE" }
  }

  export async function viewstateCheck(sender: HttpSender, origin: string): Promise<Check> {
    const res = await get(sender, origin)
    if (failed(res)) return { check: "viewstate_check", hit: false, severity: "info", detail: "no response" }
    const m = res.body.match(/name="__VIEWSTATE"\s+value="([^"]+)"/)
    if (!m) return { check: "viewstate_check", hit: false, severity: "info", detail: "no __VIEWSTATE on page" }
    const raw = atob(m[1].replace(/ /g, "+")).length
    if (raw < 20)
      return { check: "viewstate_check", hit: true, severity: "critical", detail: "__VIEWSTATE without MAC (CVE-2020-0688 class — deserialization RCE if machineKey known)", evidence: `decoded ${raw} bytes (no MAC)` }
    return { check: "viewstate_check", hit: true, severity: "info", detail: "__VIEWSTATE present (MAC-protected size)", evidence: `decoded ${raw} bytes` }
  }

  export async function elmahExposure(sender: HttpSender, origin: string): Promise<Check> {
    for (const p of ["/elmah.axd", "/elmah.axd/", "/errorlog.axd"]) {
      const res = await get(sender, `${origin}${p}`)
      if (ok(res) && res.status === 200 && /(Error Log for|ELMAH)/i.test(res.body))
        return { check: "elmah_exposure", hit: true, severity: "high", detail: `ELMAH error log exposed at ${p} (RSS/CSV download likely)`, evidence: res.body.slice(0, 150) }
    }
    return { check: "elmah_exposure", hit: false, severity: "info", detail: "ELMAH not exposed" }
  }

  export async function traceEnabled(sender: HttpSender, origin: string): Promise<Check> {
    const trace = await get(sender, `${origin}/trace.axd`)
    if (ok(trace) && trace.status === 200 && /Application Trace|Request Details/i.test(trace.body))
      return { check: "trace_enabled", hit: true, severity: "high", detail: "ASP.NET Application Trace (trace.axd) enabled", evidence: trace.body.slice(0, 150) }
    const err = await get(sender, `${origin}/%00.aspx`)
    if (ok(err) && /Source Error|Stack Trace|Server Error in/i.test(err.body))
      return { check: "trace_enabled", hit: true, severity: "medium", detail: "detailed ASP.NET error pages (customErrors off)", evidence: err.body.slice(0, 150) }
    return { check: "trace_enabled", hit: false, severity: "info", detail: "no trace.axd / detailed errors" }
  }

  export async function blazorDebug(sender: HttpSender, origin: string): Promise<Check> {
    const boot = await get(sender, `${origin}/_framework/blazor.boot.json`)
    if (ok(boot) && boot.status === 200 && boot.body.includes("resources")) {
      const unsafe = /"cacheBootResources"\s*:\s*false|"linkerEnabled"\s*:\s*false/.test(boot.body)
      return { check: "blazor_debug", hit: true, severity: unsafe ? "medium" : "low", detail: `Blazor boot manifest exposed${unsafe ? " (linker disabled / cache off)" : ""}`, evidence: boot.body.slice(0, 150) }
    }
    return { check: "blazor_debug", hit: false, severity: "info", detail: "no Blazor debug manifest" }
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

const DESCRIPTION = `ASP.NET / ASP.NET Core checks (detection, __VIEWSTATE MAC check (CVE-2020-0688 class), ELMAH exposure, trace.axd/detailed errors, Blazor boot manifest).

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
