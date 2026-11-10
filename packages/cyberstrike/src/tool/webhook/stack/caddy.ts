// caddy stack checks — ported from infra-security-mcp `providers/caddy`.
import z from "zod"
import { defineWebhookTool } from "../define"
import type { HttpSender } from "../transport"
import { get, header, failed, ok, base, host, summarize, type Check } from "./shared"

export namespace Caddy {
  export async function version(sender: HttpSender, origin: string): Promise<Check> {
    const res = await get(sender, origin)
    if (failed(res)) return { check: "version", hit: false, severity: "info", detail: "no response" }
    const server = header(res, "server")
    if (!/caddy/i.test(server)) return { check: "version", hit: false, severity: "info", detail: "Caddy not disclosed" }
    const m = server.match(/Caddy\/?([\d.]+)?/i)
    return { check: "version", hit: true, severity: m?.[1] ? "low" : "info", detail: `Caddy${m?.[1] ? ` ${m[1]}` : ""} detected`, evidence: server }
  }

  export async function adminApi(sender: HttpSender, origin: string): Promise<Check> {
    const h = host(origin)
    const endpoints = ["/config/", "/load", "/reverse_proxy/upstreams", "/pki/ca/local"]
    for (const b of [`http://${h}:2019`, `https://${h}:2019`])
      for (const p of endpoints) {
        const res = await get(sender, `${b}${p}`)
        if (failed(res)) continue
        if (res.status === 200 && /("apps"|"routes"|"handler"|certificate)/i.test(res.body))
          return { check: "admin_api", hit: true, severity: "critical", detail: `Caddy admin API exposed at ${b}${p}`, evidence: res.body.slice(0, 200) }
      }
    return { check: "admin_api", hit: false, severity: "info", detail: "admin API (:2019) not exposed" }
  }

  export async function autoHttps(sender: HttpSender, origin: string): Promise<Check> {
    const h = host(origin)
    const res = await get(sender, `http://${h}`)
    if (failed(res)) return { check: "auto_https", hit: false, severity: "info", detail: "HTTP not reachable" }
    const loc = header(res, "location")
    const redirects = (res.status === 301 || res.status === 308) && loc.startsWith("https://")
    const https = await get(sender, `https://${h}`)
    const hsts = ok(https) ? header(https, "strict-transport-security") : ""
    const weakHsts = hsts && !/max-age=\d{7,}/.test(hsts)
    if (!redirects)
      return { check: "auto_https", hit: true, severity: "low", detail: "HTTP does not redirect to HTTPS", evidence: `http status=${res.status}` }
    if (weakHsts)
      return { check: "auto_https", hit: true, severity: "low", detail: `weak/short HSTS max-age`, evidence: hsts }
    return { check: "auto_https", hit: false, severity: "info", detail: "HTTP→HTTPS redirect + adequate HSTS" }
  }

  export async function configLeak(sender: HttpSender, origin: string): Promise<Check> {
    const paths = ["/debug/pprof/", "/debug/vars", "/metrics", "/Caddyfile", "/Caddyfile.bak", "/caddy.json"]
    for (const p of paths) {
      const res = await get(sender, `${origin}${p}`)
      if (failed(res)) continue
      if (res.status === 200 && /(goroutine|pprof|"apps"|reverse_proxy|caddy)/i.test(res.body))
        return { check: "config_leak", hit: true, severity: "high", detail: `Caddy debug/config endpoint exposed at ${p}`, evidence: res.body.slice(0, 200) }
    }
    return { check: "config_leak", hit: false, severity: "info", detail: "no exposed pprof/config endpoint" }
  }

  const RUNNERS: Record<string, (s: HttpSender, o: string) => Promise<Check>> = {
    version,
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

const DESCRIPTION = `Caddy deterministic checks (version disclosure, admin API :2019 exposure, auto-HTTPS/HSTS posture, pprof/Caddyfile/config leak).

Run after Vortex fingerprints Caddy. Probes go through the scope-guarded replay engine. check="all" (default) runs every check.`

export const CaddyTestTool = defineWebhookTool({
  name: "caddy_test",
  description: DESCRIPTION,
  parameters: z.object({
    target: z.string().describe("Target origin or URL (e.g. https://target.com)."),
    check: z
      .enum(["all", "version", "admin_api", "auto_https", "config_leak"])
      .default("all")
      .describe("Which check to run; 'all' runs every Caddy check."),
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
