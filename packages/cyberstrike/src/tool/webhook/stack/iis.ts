// iis stack checks — ported from infra-security-mcp `providers/iis`.
// Short-name (tilde) enumeration stays in the dedicated `iis_tilde` tool; this
// bundles version disclosure, web.config leak, verb/path auth bypass, and the
// ASP.NET debug/trace handlers.
import z from "zod"
import { defineWebhookTool } from "../define"
import type { HttpSender } from "../transport"
import { get, header, failed, ok, base, summarize, type Check } from "./shared"

const WINDOWS: Record<string, string> = {
  "6.0": "Windows Server 2003",
  "7.0": "Windows Server 2008",
  "7.5": "Windows Server 2008 R2",
  "8.0": "Windows Server 2012",
  "8.5": "Windows Server 2012 R2",
  "10.0": "Windows Server 2016/2019/2022",
}

export namespace Iis {
  export async function version(sender: HttpSender, origin: string): Promise<Check> {
    const [root, miss] = await Promise.all([get(sender, origin), get(sender, `${origin}/__404_${Date.now()}__`)])
    const hdr = [root, miss].filter(ok)
    const server = hdr.map((r) => header(r, "server")).join(" ")
    const powered = hdr.map((r) => `${header(r, "x-powered-by")} ${header(r, "x-aspnet-version")} ${header(r, "x-aspnetmvc-version")}`).join(" ")
    const m = server.match(/Microsoft-IIS\/([\d.]+)/i)
    if (!m) return { check: "version", hit: false, severity: "info", detail: "IIS version not disclosed" }
    const win = WINDOWS[m[1]] ? ` → ${WINDOWS[m[1]]}` : ""
    const extra = powered.trim().replace(/\s+/g, " ")
    return { check: "version", hit: true, severity: "low", detail: `Microsoft-IIS/${m[1]}${win} disclosed`, evidence: `${m[0]}${extra ? ` | ${extra}` : ""}` }
  }

  export async function webconfigLeak(sender: HttpSender, origin: string): Promise<Check> {
    const tricks = [
      "/web.config", "/web.config.bak", "/web.config.old", "/web.config.txt", "/web.config~", "/web.config.swp",
      "/WEB-INF/web.xml", "/web.config%00.txt", "/web.config::$DATA", "/web.config.zip", "/web.config.save", "/aspnet_client/web.config",
    ]
    for (const p of tricks) {
      const res = await get(sender, `${origin}${p}`)
      if (failed(res)) continue
      if (res.status === 200 && /<configuration>|<system\.web>|connectionString/i.test(res.body)) {
        const redacted = res.body.replace(/(connectionString|password|pwd)\s*=\s*"[^"]*"/gi, '$1="[SENSITIVE]"')
        return { check: "webconfig_leak", hit: true, severity: "high", detail: `web.config exposed at ${p}`, evidence: redacted.slice(0, 500) }
      }
    }
    return { check: "webconfig_leak", hit: false, severity: "info", detail: "web.config not exposed" }
  }

  export async function authBypass(sender: HttpSender, origin: string): Promise<Check> {
    const guard = await get(sender, `${origin}/admin`)
    if (failed(guard) || (guard.status !== 401 && guard.status !== 403))
      return { check: "auth_bypass", hit: false, severity: "info", detail: "/admin not access-controlled (no bypass to test)" }
    const verbs = ["PROPFIND", "OPTIONS", "TRACE", "DEBUG", "PATCH", "HEAD", "PUT", "DELETE"]
    for (const v of verbs) {
      const res = await sender.send({ method: v, url: `${origin}/admin`, headers: {} })
      if (ok(res) && (res.status === 200 || res.status === 207))
        return { check: "auth_bypass", hit: true, severity: "high", detail: `verb-tampering bypass on /admin via ${v}`, evidence: `GET=${guard.status} ${v}=${res.status}` }
    }
    for (const trick of ["/admin%20", "/admin::$DATA", "/admin/", "/admin\\", "/admin%2e", "/admin;.js"]) {
      const res = await get(sender, `${origin}${trick}`)
      if (ok(res) && res.status === 200)
        return { check: "auth_bypass", hit: true, severity: "high", detail: `path-trick bypass on /admin via ${trick}`, evidence: `GET=${guard.status} trick=${res.status}` }
    }
    return { check: "auth_bypass", hit: false, severity: "info", detail: "no verb/path bypass on /admin" }
  }

  export async function aspnetDebug(sender: HttpSender, origin: string): Promise<Check> {
    const handlers = ["/trace.axd", "/elmah.axd", "/glimpse.axd", "/__browserLink/requestData"]
    for (const p of handlers) {
      const res = await get(sender, `${origin}${p}`)
      if (failed(res)) continue
      if (res.status === 200 && /(Application Trace|Error Log for|Glimpse|Request Details)/i.test(res.body))
        return { check: "aspnet_debug", hit: true, severity: "high", detail: `ASP.NET debug handler exposed at ${p}`, evidence: res.body.slice(0, 200) }
    }
    const dbg = await sender.send({ method: "DEBUG", url: `${origin}/`, headers: { Command: "stop-debug" } })
    if (ok(dbg) && dbg.status === 200 && dbg.body.trim() === "OK")
      return { check: "aspnet_debug", hit: true, severity: "high", detail: "ASP.NET remote debugging enabled (DEBUG verb accepted)", evidence: "DEBUG stop-debug → 200 OK" }
    return { check: "aspnet_debug", hit: false, severity: "info", detail: "no exposed ASP.NET debug/trace handler" }
  }

  const RUNNERS: Record<string, (s: HttpSender, o: string) => Promise<Check>> = {
    version,
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

const DESCRIPTION = `IIS deterministic checks (version→Windows disclosure, web.config leak via extension/stream tricks, /admin verb+path auth bypass, ASP.NET trace.axd/elmah/glimpse debug handlers + DEBUG verb).

Run after Vortex fingerprints IIS (technology:iis) or a Microsoft-IIS Server header. For 8.3 short-name enumeration use the separate iis_tilde tool. Probes go through the scope-guarded replay engine. check="all" (default) runs every check.`

export const IisTestTool = defineWebhookTool({
  name: "iis_test",
  description: DESCRIPTION,
  parameters: z.object({
    target: z.string().describe("Target origin or URL (e.g. https://target.com)."),
    check: z
      .enum(["all", "version", "webconfig_leak", "auth_bypass", "aspnet_debug"])
      .default("all")
      .describe("Which check to run; 'all' runs every IIS check."),
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
