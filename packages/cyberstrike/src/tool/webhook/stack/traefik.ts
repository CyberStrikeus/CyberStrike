// traefik stack checks — ported from infra-security-mcp `providers/traefik`.
import z from "zod"
import { defineWebhookTool } from "../define"
import type { HttpSender } from "../transport"
import { get, header, failed, ok, base, host, withPort, summarize, type Check } from "./shared"

export namespace Traefik {
  export async function detect(sender: HttpSender, origin: string): Promise<Check> {
    const res = await get(sender, `${origin}/__404_${Date.now()}`)
    if (failed(res)) return { check: "detect", hit: false, severity: "info", detail: "no response" }
    let score = 0
    if (/traefik/i.test(header(res, "server"))) score += 50
    if (header(res, "x-traefik-reqid") !== "") score += 30
    if (res.body.trim() === "404 page not found") score += 30
    if (score < 30) return { check: "detect", hit: false, severity: "info", detail: "Traefik not detected" }
    return { check: "detect", hit: true, severity: "info", detail: `Traefik detected (score ${score})`, evidence: header(res, "server") || "404 page not found" }
  }

  export async function dashboard(sender: HttpSender, origin: string): Promise<Check> {
    const bases = [origin, withPort(origin, 8080)]
    const paths = ["/dashboard/", "/api/rawdata", "/api/http/routers", "/api/overview", "/api/version"]
    for (const b of bases)
      for (const p of paths) {
        const res = await get(sender, `${b}${p}`)
        if (failed(res)) continue
        if (res.status === 200 && /("routers"|"middlewares"|"entryPoints"|dashboard|Version)/i.test(res.body)) {
          const crit = p === "/api/rawdata"
          return { check: "dashboard", hit: true, severity: crit ? "critical" : "high", detail: `Traefik ${crit ? "full config (rawdata)" : "dashboard/API"} exposed at ${b}${p}`, evidence: res.body.slice(0, 200) }
        }
      }
    return { check: "dashboard", hit: false, severity: "info", detail: "Traefik dashboard/API not exposed" }
  }

  export async function middlewareBypass(sender: HttpSender, origin: string): Promise<Check> {
    const guard = await get(sender, `${origin}/admin`)
    if (failed(guard) || (guard.status !== 401 && guard.status !== 403))
      return { check: "middleware_bypass", hit: false, severity: "info", detail: "/admin not access-controlled" }
    const tricks = ["/admin/admin", "/admin/", "/admin/./", "/public/../admin", "/admin%2f", "/admin%ef%bc%8f", "/ADMIN", "/admin;", "/admin#"]
    for (const t of tricks) {
      const res = await get(sender, `${origin}${t}`)
      if (ok(res) && res.status === 200)
        return { check: "middleware_bypass", hit: true, severity: "high", detail: `Traefik middleware bypass on /admin via ${t}`, evidence: `guard=${guard.status} bypass=${res.status}` }
    }
    for (const h of [{ "X-Forwarded-Host": "internal" }, { "X-Forwarded-For": "127.0.0.1" }, { "X-Real-IP": "127.0.0.1" }, { "X-Forwarded-Proto": "https" }] as Record<string, string>[]) {
      const res = await get(sender, `${origin}/admin`, h)
      if (ok(res) && res.status === 200)
        return { check: "middleware_bypass", hit: true, severity: "high", detail: `Traefik middleware bypass via ${Object.keys(h)[0]}`, evidence: `header → ${res.status}` }
    }
    return { check: "middleware_bypass", hit: false, severity: "info", detail: "no middleware bypass on /admin" }
  }

  export async function apiExposure(sender: HttpSender, origin: string): Promise<Check> {
    const endpoints = ["/api/http/routers", "/api/http/services", "/api/tcp/routers", "/api/entrypoints", "/debug/vars", "/debug/pprof/"]
    const backends = new Set<string>()
    let hitPath = ""
    for (const b of [origin, withPort(origin, 8080)])
      for (const p of endpoints) {
        const res = await get(sender, `${b}${p}`)
        if (failed(res) || res.status !== 200) continue
        for (const m of res.body.matchAll(/https?:\/\/[\d.]+(?::\d+)?/g)) backends.add(m[0])
        if (/("rule"|"service"|goroutine|"address")/i.test(res.body)) hitPath = `${b}${p}`
      }
    if (hitPath)
      return { check: "api_exposure", hit: true, severity: "high", detail: `Traefik API/debug exposed at ${hitPath}${backends.size ? ` — ${backends.size} backend(s) leaked` : ""}`, evidence: [...backends].slice(0, 5).join(", ") }
    return { check: "api_exposure", hit: false, severity: "info", detail: "Traefik API/debug endpoints not exposed" }
  }

  export async function entrypointDetect(sender: HttpSender, origin: string): Promise<Check> {
    const h = host(origin)
    const open: string[] = []
    for (const port of [8080, 8443, 8888]) {
      for (const scheme of ["https", "http"]) {
        const res = await get(sender, `${scheme}://${h}:${port}`)
        if (ok(res) && res.status > 0) {
          open.push(`${scheme}:${port}`)
          break
        }
      }
    }
    if (open.length === 0) return { check: "entrypoint_detect", hit: false, severity: "info", detail: "no extra Traefik entrypoints reachable (in-scope)" }
    return { check: "entrypoint_detect", hit: true, severity: "low", detail: `extra Traefik entrypoints reachable: ${open.join(", ")}`, evidence: open.join(", ") }
  }

  const RUNNERS: Record<string, (s: HttpSender, o: string) => Promise<Check>> = {
    detect,
    dashboard,
    middleware_bypass: middlewareBypass,
    api_exposure: apiExposure,
    entrypoint_detect: entrypointDetect,
  }

  export async function run(sender: HttpSender, origin: string, which: string): Promise<Check[]> {
    const names = which === "all" ? Object.keys(RUNNERS) : [which]
    const out: Check[] = []
    for (const n of names) out.push(await RUNNERS[n](sender, origin))
    return out
  }
}

const DESCRIPTION = `Traefik checks (detection, dashboard/API + rawdata config exposure, /admin middleware bypass, API/debug + backend-URL leak, extra entrypoint ports).

Run after Vortex fingerprints Traefik. Alt-port probes respect the scope guard. check="all" (default) runs every check.`

export const TraefikTestTool = defineWebhookTool({
  name: "traefik_test",
  description: DESCRIPTION,
  parameters: z.object({
    target: z.string().describe("Target origin or URL (e.g. https://target.com)."),
    check: z
      .enum(["all", "detect", "dashboard", "middleware_bypass", "api_exposure", "entrypoint_detect"])
      .default("all")
      .describe("Which check to run; 'all' runs every Traefik check."),
  }),
  async run(params, ctx) {
    const origin = base(params.target)
    const results = await Traefik.run(ctx.sender, origin, params.check)
    return { target: origin, results }
  },
  format(r) {
    return summarize("traefik_test", r.target, r.results)
  },
})
