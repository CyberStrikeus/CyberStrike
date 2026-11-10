// Caddy stack checks — ported 1:1 from infra-security-mcp `providers/caddy`.
// Every path/payload/condition matches the source exactly; only the transport
// (scope-guarded webhook sender) and the Check/severity adapter are CyberStrike's.
import z from "zod"
import { defineWebhookTool } from "../define"
import type { HttpSender } from "../transport"
import { get, header, failed, ok, base, host, summarize, type Check } from "./shared"

export namespace Caddy {
  export async function versionDetect(sender: HttpSender, origin: string): Promise<Check> {
    const [main, notFound] = await Promise.all([get(sender, origin), get(sender, `${origin}/__nonexistent_${Date.now()}__`)])
    const serverHeader = (ok(main) ? header(main, "server") : "") || (ok(notFound) ? header(notFound, "server") : "")
    const notFoundBody = ok(notFound) ? notFound.body : ""
    const notFoundStatus = ok(notFound) ? notFound.status : 0
    const caddyMatch = serverHeader.match(/Caddy\/?(\S*)/i)
    const isCaddy = serverHeader.toLowerCase().includes("caddy")
    const defaultErrorPage = notFoundBody.includes("Caddy") || (notFoundStatus === 404 && notFoundBody.trim() === "")
    // Caddy enforces HTTPS by default — check redirect behavior
    const httpBase = origin.replace("https://", "http://")
    const httpRes = await get(sender, httpBase)
    const autoHttpsRedirect = ok(httpRes) && (httpRes.status === 301 || httpRes.status === 308)
    if (!isCaddy) return { check: "version_detect", hit: false, severity: "info", detail: "Caddy not detected" }
    const version = caddyMatch?.[1] || null
    return {
      check: "version_detect",
      hit: true,
      severity: version ? "low" : "info",
      detail: `Caddy${version ? ` ${version}` : ""} detected${autoHttpsRedirect ? " (auto-HTTPS redirect active)" : ""}${defaultErrorPage ? " (default error page)" : ""}`,
      evidence: serverHeader || "Caddy",
    }
  }

  export async function adminApi(sender: HttpSender, origin: string): Promise<Check> {
    const port = 2019
    const h = host(origin)
    const adminEndpoints = [
      { path: "/config/", desc: "Full server configuration" },
      { path: "/config/apps/http/servers", desc: "HTTP server config" },
      { path: "/load", desc: "Config load endpoint (POST)" },
      { path: "/stop", desc: "Server stop endpoint" },
      { path: "/reverse_proxy/upstreams", desc: "Reverse proxy upstreams" },
      { path: "/id/", desc: "Object ID lookup" },
      { path: "/pki/ca/local", desc: "PKI certificate authority" },
    ]
    for (const ep of adminEndpoints) {
      for (const scheme of ["http", "https"]) {
        const url = `${scheme}://${h}:${port}${ep.path}`
        const res = await get(sender, url)
        if (failed(res)) continue
        if (res.status === 200 || (res.status === 400 && res.body.includes("caddy"))) {
          const hasConfig =
            res.body.includes('"apps"') || res.body.includes('"http"') || res.body.includes('"routes"') || res.body.includes('"listen"')
          return { check: "admin_api", hit: true, severity: "critical", detail: `Caddy admin API externally accessible at ${url} (${ep.desc})${hasConfig ? " — leaks config" : ""}`, evidence: res.body.substring(0, 1000) }
        }
      }
    }
    return { check: "admin_api", hit: false, severity: "info", detail: `admin API not exposed on :${port}` }
  }

  export async function autoHttps(sender: HttpSender, origin: string): Promise<Check> {
    const h = host(origin)
    const httpRes = await get(sender, `http://${h}/`)
    const httpsRes = await get(sender, `https://${h}/`)
    const hasRedirect =
      ok(httpRes) && (httpRes.status === 301 || httpRes.status === 308 || httpRes.status === 302 || httpRes.status === 307)
    const redirectLocation = ok(httpRes) ? header(httpRes, "location") : ""
    const redirectsToHttps = redirectLocation.startsWith("https://")
    const hsts = ok(httpsRes) ? header(httpsRes, "strict-transport-security") : ""
    const hstsMaxAge = hsts.match(/max-age=(\d+)/)?.[1]
    const wwwRes = await get(sender, `https://www.${h}/`)
    const httpFollowed = await get(sender, `http://${h}/`)
    const redirectLoop = (failed(httpFollowed) ? httpFollowed.error : "")?.includes("redirect") ?? false
    const issues: string[] = []
    if (!hasRedirect) issues.push("No HTTP→HTTPS redirect detected")
    if (hasRedirect && !redirectsToHttps) issues.push(`Redirect goes to ${redirectLocation} (not HTTPS)`)
    if (!hsts) issues.push("No HSTS header — users can be MitM'd on first visit")
    if (hstsMaxAge && parseInt(hstsMaxAge) < 31536000) issues.push("HSTS max-age below 1 year")
    if (redirectLoop) issues.push("Redirect loop detected")
    void wwwRes
    if (issues.length > 0)
      return { check: "auto_https", hit: true, severity: "low", detail: `Caddy auto-HTTPS/HSTS hardening gaps: ${issues.join("; ")}`, evidence: hsts || redirectLocation || `http=${ok(httpRes) ? httpRes.status : "?"}` }
    return { check: "auto_https", hit: false, severity: "info", detail: "auto-HTTPS and HSTS configured correctly" }
  }

  export async function configLeak(sender: HttpSender, origin: string): Promise<Check> {
    const configPaths = [
      { path: "/debug/pprof/", desc: "Go pprof profiling" },
      { path: "/debug/pprof/goroutine?debug=1", desc: "Goroutine dump" },
      { path: "/debug/pprof/heap?debug=1", desc: "Heap profile" },
      { path: "/debug/vars", desc: "Go expvar" },
      { path: "/metrics", desc: "Prometheus metrics" },
      { path: "/Caddyfile", desc: "Caddyfile" },
      { path: "/Caddyfile.bak", desc: "Caddyfile backup" },
      { path: "/caddy.json", desc: "Caddy JSON config" },
    ]
    for (const cp of configPaths) {
      const res = await get(sender, `${origin}${cp.path}`)
      if (failed(res)) continue
      if (res.status === 200 && res.body.length > 50) {
        const isLegit =
          res.body.includes("goroutine") ||
          res.body.includes("pprof") ||
          res.body.includes("allocs") ||
          res.body.includes("caddy") ||
          res.body.includes("{") ||
          res.body.includes("# Caddyfile") ||
          res.body.includes("go_") ||
          res.body.includes("process_")
        if (isLegit)
          return { check: "config_leak", hit: true, severity: "high", detail: `Caddy config/debug endpoint exposed at ${cp.path} (${cp.desc})`, evidence: res.body.substring(0, 1000) }
      }
    }
    return { check: "config_leak", hit: false, severity: "info", detail: "no exposed config/debug endpoint" }
  }

  const RUNNERS: Record<string, (s: HttpSender, o: string) => Promise<Check>> = {
    version_detect: versionDetect,
    admin_api: adminApi,
    auto_https: autoHttps,
    config_leak: configLeak,
  }

  export async function run(sender: HttpSender, origin: string, which: string): Promise<Check[]> {
    const names = which === "all" ? Object.keys(RUNNERS) : [which]
    const out: Check[] = []
    for (const n of names) out.push(await RUNNERS[n](sender, origin))
    return out
  }
}

const DESCRIPTION = `Caddy deterministic checks (version/auto-HTTPS detection, admin API exposure on :2019, auto-HTTPS/HSTS hardening analysis, config/debug leak via pprof/expvar/metrics/Caddyfile). 1:1 port of the infra-security caddy provider.

Run after Vortex fingerprints Caddy. Probes go through the scope-guarded replay engine. check="all" (default) runs every check.`

export const CaddyTestTool = defineWebhookTool({
  name: "caddy_test",
  description: DESCRIPTION,
  parameters: z.object({
    target: z.string().describe("Target origin or URL (e.g. https://target.com)."),
    check: z
      .enum(["all", "version_detect", "admin_api", "auto_https", "config_leak"])
      .default("all")
      .describe("Which check to run; 'all' runs every caddy check."),
  }),
  async run(params, ctx) {
    const origin = base(params.target)
    const results = await Caddy.run(ctx.sender, origin, params.check)
    return { target: origin, results }
  },
  format(r) {
    return summarize("caddy_test", r.target, r.results)
  },
})
