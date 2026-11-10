// litespeed stack checks — ported from infra-security-mcp `providers/litespeed`.
import z from "zod"
import { defineWebhookTool } from "../define"
import type { HttpSender } from "../transport"
import { get, header, failed, ok, base, host, summarize, type Check } from "./shared"

export namespace Litespeed {
  export async function version(sender: HttpSender, origin: string): Promise<Check> {
    const res = await get(sender, origin)
    if (failed(res)) return { check: "version", hit: false, severity: "info", detail: "no response" }
    const server = header(res, "server")
    const m = server.match(/(Open)?LiteSpeed\/?([\d.]+)?/i)
    if (!m) return { check: "version", hit: false, severity: "info", detail: "LiteSpeed not disclosed" }
    const cache = header(res, "x-litespeed-cache") || header(res, "x-lsadc-cache")
    return {
      check: "version",
      hit: true,
      severity: m[2] ? "low" : "info",
      detail: `${m[1] ? "OpenLiteSpeed" : "LiteSpeed"}${m[2] ? ` ${m[2]}` : ""} detected${cache ? ` (cache: ${cache})` : ""}`,
      evidence: server,
    }
  }

  export async function adminExposure(sender: HttpSender, origin: string): Promise<Check> {
    const h = host(origin)
    const bases = [`https://${h}:7080`, `http://${h}:7080`]
    for (const b of bases)
      for (const p of ["/", "/login.php", "/view/serviceMgr.php"]) {
        const res = await get(sender, `${b}${p}`)
        if (failed(res)) continue
        if (res.status === 200 && /(litespeed|WebAdmin|lsws)/i.test(res.body))
          return { check: "admin_exposure", hit: true, severity: "high", detail: `LiteSpeed WebAdmin console exposed at ${b}${p}`, evidence: res.body.slice(0, 200) }
      }
    return { check: "admin_exposure", hit: false, severity: "info", detail: "WebAdmin console (:7080) not exposed" }
  }

  export async function cachePoison(sender: HttpSender, origin: string): Promise<Check> {
    const evil = "evil.attacker.example"
    const injections: Record<string, string>[] = [
      { "X-Forwarded-Host": evil },
      { "X-Original-URL": `http://${evil}/` },
      { "X-Rewrite-URL": `http://${evil}/` },
      { "X-Forwarded-Scheme": "http" },
      { "X-Forwarded-Host": evil, "X-Forwarded-Scheme": "http" },
    ]
    for (const inj of injections) {
      const res = await get(sender, origin, inj)
      if (failed(res)) continue
      if (res.body.includes(evil))
        return { check: "cache_poison", hit: true, severity: "high", detail: `forwarding header reflected (cache-poison vector): ${Object.keys(inj).join("+")}`, evidence: `cache: ${header(res, "x-litespeed-cache") || "n/a"}` }
    }
    return { check: "cache_poison", hit: false, severity: "info", detail: "no reflected forwarding-header cache-poison" }
  }

  export async function htaccessCompat(sender: HttpSender, origin: string): Promise<Check> {
    for (const f of ["/.htaccess", "/.htpasswd"]) {
      const res = await get(sender, `${origin}${f}`)
      if (ok(res) && res.status === 200 && /(AuthType|Require |RewriteRule|:\$)/.test(res.body))
        return { check: "htaccess_compat", hit: true, severity: "high", detail: `.htaccess/.htpasswd readable at ${f}`, evidence: res.body.slice(0, 200) }
    }
    const g = await get(sender, `${origin}/admin`)
    if (ok(g) && (g.status === 401 || g.status === 403)) {
      const put = await sender.send({ method: "PUT", url: `${origin}/admin`, headers: {} })
      if (ok(put) && (put.status === 200 || put.status === 201))
        return { check: "htaccess_compat", hit: true, severity: "high", detail: "method-based ACL bypass on /admin (GET blocked, PUT allowed)", evidence: `GET=${g.status} PUT=${put.status}` }
    }
    return { check: "htaccess_compat", hit: false, severity: "info", detail: "no .htaccess leak or method bypass" }
  }

  const RUNNERS: Record<string, (s: HttpSender, o: string) => Promise<Check>> = {
    version,
    admin_exposure: adminExposure,
    cache_poison: cachePoison,
    htaccess_compat: htaccessCompat,
  }

  export async function run(sender: HttpSender, origin: string, which: string): Promise<Check[]> {
    const names = which === "all" ? Object.keys(RUNNERS) : [which]
    const out: Check[] = []
    for (const n of names) out.push(await RUNNERS[n](sender, origin))
    return out
  }
}

const DESCRIPTION = `LiteSpeed / OpenLiteSpeed deterministic checks (version + cache-header disclosure, WebAdmin console :7080 exposure, forwarding-header cache poisoning, .htaccess leak + method ACL bypass).

Run after Vortex fingerprints LiteSpeed. Probes go through the scope-guarded replay engine. check="all" (default) runs every check.`

export const LitespeedTestTool = defineWebhookTool({
  name: "litespeed_test",
  description: DESCRIPTION,
  parameters: z.object({
    target: z.string().describe("Target origin or URL (e.g. https://target.com)."),
    check: z
      .enum(["all", "version", "admin_exposure", "cache_poison", "htaccess_compat"])
      .default("all")
      .describe("Which check to run; 'all' runs every LiteSpeed check."),
  }),
  async run(params, ctx) {
    const origin = base(params.target)
    const results = await Litespeed.run(ctx.sender, origin, params.check)
    return { target: origin, results }
  },
  format(r) {
    return summarize("litespeed_test", r.target, r.results)
  },
})
