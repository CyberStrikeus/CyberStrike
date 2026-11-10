// LiteSpeed stack checks — ported 1:1 from infra-security-mcp `providers/litespeed`.
// Every path/payload/condition matches the source exactly; only the transport
// (scope-guarded webhook sender) and the Check/severity adapter are CyberStrike's.
import z from "zod"
import { defineWebhookTool } from "../define"
import type { HttpSender } from "../transport"
import { get, header, failed, ok, base, host, summarize, type Check } from "./shared"

export namespace Litespeed {
  export async function versionDetect(sender: HttpSender, origin: string): Promise<Check> {
    const [main, notFound] = await Promise.all([get(sender, origin), get(sender, `${origin}/__nonexistent_${Date.now()}__`)])
    const serverHeader = (ok(main) ? header(main, "server") : "") || (ok(notFound) ? header(notFound, "server") : "")
    const notFoundBody = ok(notFound) ? notFound.body : ""
    const lsMatch = serverHeader.match(/LiteSpeed\/([\d.]+)/i)
    const olsMatch = serverHeader.match(/OpenLiteSpeed\/([\d.]+)/i)
    const bodyMatch = notFoundBody.match(/LiteSpeed\/([\d.]+)/i) ?? notFoundBody.match(/OpenLiteSpeed\/([\d.]+)/i)
    const variant = olsMatch ? "OpenLiteSpeed" : lsMatch ? "LiteSpeed" : null
    const version = olsMatch?.[1] ?? lsMatch?.[1] ?? bodyMatch?.[1] ?? null
    const isLiteSpeed = serverHeader.toLowerCase().includes("litespeed") || notFoundBody.toLowerCase().includes("litespeed")
    const xPoweredBy = ok(main) ? header(main, "x-powered-by") : ""
    const lsCache = (ok(main) ? header(main, "x-litespeed-cache") : "") || (ok(main) ? header(main, "x-lsadc-cache") : "")
    if (!isLiteSpeed) return { check: "version_detect", hit: false, severity: "info", detail: "LiteSpeed not detected" }
    return {
      check: "version_detect",
      hit: true,
      severity: version ? "low" : "info",
      detail: `${variant ?? "LiteSpeed"}${version ? ` ${version}` : ""} detected${lsCache ? ` [cache: ${lsCache}]` : ""}${xPoweredBy ? ` X-Powered-By: ${xPoweredBy}` : ""}${bodyMatch ? " (error page leaks version)" : ""}`,
      evidence: serverHeader || (bodyMatch ? bodyMatch[0] : "LiteSpeed"),
    }
  }

  export async function adminExposure(sender: HttpSender, origin: string): Promise<Check> {
    const port = 7080
    const h = host(origin)
    const adminPaths = [
      { url: `https://${h}:${port}/`, desc: "Admin root (HTTPS)" },
      { url: `http://${h}:${port}/`, desc: "Admin root (HTTP)" },
      { url: `https://${h}:${port}/login.php`, desc: "Login page" },
      { url: `https://${h}:${port}/view/serviceMgr.php`, desc: "Service manager" },
    ]
    for (const ap of adminPaths) {
      const res = await get(sender, ap.url)
      if (failed(res)) continue
      if (
        res.status === 200 &&
        (res.body.toLowerCase().includes("litespeed") ||
          res.body.includes("WebAdmin") ||
          res.body.includes("lsws") ||
          res.body.includes("login"))
      )
        return { check: "admin_exposure", hit: true, severity: "high", detail: `LiteSpeed admin console exposed at ${ap.url} (${ap.desc})`, evidence: res.body.substring(0, 500) }
    }
    return { check: "admin_exposure", hit: false, severity: "info", detail: `admin console not exposed on :${port}` }
  }

  export async function cachePoison(sender: HttpSender, origin: string): Promise<Check> {
    const path = "/"
    const url = `${origin}${path}`
    const baseline = await get(sender, url)
    const baselineBody = ok(baseline) ? baseline.body : ""
    const poisonTests: { name: string; headers: Record<string, string> }[] = [
      { name: "X-Forwarded-Host", headers: { "X-Forwarded-Host": "evil.attacker.com" } },
      { name: "X-Original-URL", headers: { "X-Original-URL": "/admin" } },
      { name: "X-Rewrite-URL", headers: { "X-Rewrite-URL": "/admin" } },
      { name: "X-Forwarded-Scheme", headers: { "X-Forwarded-Scheme": "http" } },
      { name: "X-Forwarded-Proto + Host", headers: { "X-Forwarded-Proto": "http", "X-Forwarded-Host": "evil.attacker.com" } },
    ]
    for (const pt of poisonTests) {
      const res = await get(sender, url, pt.headers)
      if (failed(res)) continue
      const reflected =
        res.body.includes("evil.attacker.com") ||
        (pt.headers["X-Original-URL"] === "/admin" && res.body !== baselineBody && res.status === 200)
      if (reflected)
        return { check: "cache_poison", hit: true, severity: "medium", detail: `LiteSpeed cache poisoning via ${pt.name}`, evidence: res.body.substring(0, 500) }
    }
    return { check: "cache_poison", hit: false, severity: "info", detail: "no reflected cache-poisoning vector" }
  }

  export async function htaccessCompat(sender: HttpSender, origin: string): Promise<Check> {
    const htaccessPaths = ["/.htaccess", "/.htpasswd"]
    for (const hp of htaccessPaths) {
      const res = await get(sender, `${origin}${hp}`)
      if (failed(res)) continue
      if (
        res.status === 200 &&
        (res.body.includes("RewriteRule") || res.body.includes("AuthType") || res.body.includes("Require") || res.body.includes("$"))
      )
        return { check: "htaccess_compat", hit: true, severity: "medium", detail: `.htaccess/.htpasswd directly accessible at ${hp}`, evidence: res.body.substring(0, 500) }
    }
    const adminRes = await get(sender, `${origin}/admin`)
    const adminPut = await sender.send({ method: "PUT", url: `${origin}/admin`, headers: {} })
    const methodBypass =
      ok(adminRes) &&
      ok(adminPut) &&
      (adminRes.status === 403 || adminRes.status === 401) &&
      (adminPut.status === 200 || adminPut.status === 204)
    if (methodBypass)
      return { check: "htaccess_compat", hit: true, severity: "high", detail: "LiteSpeed ignores Limit/LimitExcept — HTTP method restriction bypassed on /admin", evidence: `GET=${ok(adminRes) ? adminRes.status : "?"} PUT=${ok(adminPut) ? adminPut.status : "?"}` }
    return { check: "htaccess_compat", hit: false, severity: "info", detail: "no .htaccess leak or method-restriction bypass" }
  }

  const RUNNERS: Record<string, (s: HttpSender, o: string) => Promise<Check>> = {
    version_detect: versionDetect,
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

const DESCRIPTION = `LiteSpeed / OpenLiteSpeed deterministic checks (variant+version disclosure, admin console exposure on :7080, cache poisoning via X-Forwarded-Host/X-Original-URL/X-Rewrite-URL, .htaccess compatibility leaks + Limit/LimitExcept method-restriction bypass). 1:1 port of the infra-security litespeed provider.

Run after Vortex fingerprints LiteSpeed/OpenLiteSpeed. Probes go through the scope-guarded replay engine. check="all" (default) runs every check.`

export const LitespeedTestTool = defineWebhookTool({
  name: "litespeed_test",
  description: DESCRIPTION,
  parameters: z.object({
    target: z.string().describe("Target origin or URL (e.g. https://target.com)."),
    check: z
      .enum(["all", "version_detect", "admin_exposure", "cache_poison", "htaccess_compat"])
      .default("all")
      .describe("Which check to run; 'all' runs every litespeed check."),
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
