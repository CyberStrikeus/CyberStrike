// envoy stack checks — ported from infra-security-mcp `providers/envoy`.
import z from "zod"
import { defineWebhookTool } from "../define"
import type { HttpSender } from "../transport"
import { get, header, failed, ok, base, withPort, summarize, type Check } from "./shared"

export namespace Envoy {
  export async function detect(sender: HttpSender, origin: string): Promise<Check> {
    const res = await get(sender, origin)
    if (failed(res)) return { check: "detect", hit: false, severity: "info", detail: "no response" }
    let score = 0
    if (/envoy/i.test(header(res, "server"))) score += 50
    for (const h of ["x-envoy-upstream-service-time", "x-envoy-decorator-operation", "x-envoy-attempt-count"])
      if (header(res, h) !== "") score += 15
    if (/(upstream connect error|no healthy upstream)/i.test(res.body)) score += 25
    if (score < 25) return { check: "detect", hit: false, severity: "info", detail: "Envoy not detected" }
    return { check: "detect", hit: true, severity: "info", detail: `Envoy detected (score ${score})`, evidence: header(res, "server") || "x-envoy-* headers" }
  }

  export async function adminExposure(sender: HttpSender, origin: string): Promise<Check> {
    const endpoints = ["/server_info", "/config_dump", "/clusters", "/listeners", "/certs", "/stats/prometheus", "/runtime"]
    for (const b of [withPort(origin, 9901), origin])
      for (const p of endpoints) {
        const res = await get(sender, `${b}${p}`)
        if (failed(res)) continue
        if (res.status === 200 && /("version_info"|"cluster_statuses"|"listener_statuses"|envoy|BEGIN CERTIFICATE|# TYPE)/i.test(res.body))
          return { check: "admin_exposure", hit: true, severity: "critical", detail: `Envoy admin interface exposed at ${b}${p}`, evidence: res.body.slice(0, 200) }
      }
    return { check: "admin_exposure", hit: false, severity: "info", detail: "Envoy admin (:9901) not exposed" }
  }

  export async function filterBypass(sender: HttpSender, origin: string): Promise<Check> {
    const guard = await get(sender, `${origin}/admin`)
    if (failed(guard) || (guard.status !== 401 && guard.status !== 403))
      return { check: "filter_bypass", hit: false, severity: "info", detail: "/admin not access-controlled" }
    const tricks = ["/admin%2f", "/admin%252f", "/admin/./", "/x/../admin", "/admin%00", "/admin%09", "/admin;foo=bar"]
    for (const t of tricks) {
      const res = await get(sender, `${origin}${t}`)
      if (ok(res) && res.status === 200)
        return { check: "filter_bypass", hit: true, severity: "high", detail: `Envoy filter bypass on /admin via ${t}`, evidence: `guard=${guard.status} bypass=${res.status}` }
    }
    for (const h of [{ "x-envoy-original-path": "/admin" }, { "X-Original-URL": "/admin" }, { "x-envoy-internal": "true" }] as Record<string, string>[]) {
      const res = await get(sender, `${origin}/`, h)
      if (ok(res) && res.status === 200)
        return { check: "filter_bypass", hit: true, severity: "high", detail: `Envoy filter bypass via ${Object.keys(h)[0]}`, evidence: `header → ${res.status}` }
    }
    return { check: "filter_bypass", hit: false, severity: "info", detail: "no filter bypass on /admin" }
  }

  export async function extAuthzBypass(sender: HttpSender, origin: string): Promise<Check> {
    const guard = await get(sender, `${origin}/admin`)
    if (failed(guard) || (guard.status !== 401 && guard.status !== 403))
      return { check: "ext_authz_bypass", hit: false, severity: "info", detail: "/admin not ext_authz-gated" }
    const frag = await get(sender, `${origin}/admin#/..`)
    if (ok(frag) && frag.status === 200)
      return { check: "ext_authz_bypass", hit: true, severity: "critical", detail: "ext_authz bypass via path fragment (CVE-2019-18801 class)", evidence: `#-fragment → ${frag.status}` }
    const grpc = await sender.send({ method: "POST", url: `${origin}/admin`, headers: { "Content-Type": "application/grpc" }, body: "" })
    if (ok(grpc) && grpc.status === 200)
      return { check: "ext_authz_bypass", hit: true, severity: "critical", detail: "ext_authz bypass via application/grpc content-type", evidence: `grpc POST → ${grpc.status}` }
    return { check: "ext_authz_bypass", hit: false, severity: "info", detail: "no ext_authz bypass confirmed" }
  }

  export async function infoLeak(sender: HttpSender, origin: string): Promise<Check> {
    const res = await get(sender, origin)
    if (failed(res)) return { check: "info_leak", hit: false, severity: "info", detail: "no response" }
    const leaked = ["x-envoy-decorator-operation", "x-envoy-upstream-service-time", "x-envoy-attempt-count", "x-envoy-upstream-healthchecked-cluster"].filter((h) => header(res, h) !== "")
    if (leaked.length === 0) return { check: "info_leak", hit: false, severity: "info", detail: "no x-envoy-* internal headers leaked" }
    return { check: "info_leak", hit: true, severity: "low", detail: `Envoy internal headers leaked (routes/latency): ${leaked.join(", ")}`, evidence: leaked.map((h) => `${h}=${header(res, h)}`).join(" ") }
  }

  const RUNNERS: Record<string, (s: HttpSender, o: string) => Promise<Check>> = {
    detect,
    admin_exposure: adminExposure,
    filter_bypass: filterBypass,
    ext_authz_bypass: extAuthzBypass,
    info_leak: infoLeak,
  }

  export async function run(sender: HttpSender, origin: string, which: string): Promise<Check[]> {
    const names = which === "all" ? Object.keys(RUNNERS) : [which]
    const out: Check[] = []
    for (const n of names) out.push(await RUNNERS[n](sender, origin))
    return out
  }
}

const DESCRIPTION = `Envoy checks (detection, admin interface :9901 exposure, /admin filter bypass, ext_authz bypass (CVE-2019-18801 class), x-envoy-* internal header leak).

Run after Vortex fingerprints Envoy. Alt-port probes respect the scope guard. check="all" (default) runs every check.`

export const EnvoyTestTool = defineWebhookTool({
  name: "envoy_test",
  description: DESCRIPTION,
  parameters: z.object({
    target: z.string().describe("Target origin or URL (e.g. https://target.com)."),
    check: z
      .enum(["all", "detect", "admin_exposure", "filter_bypass", "ext_authz_bypass", "info_leak"])
      .default("all")
      .describe("Which check to run; 'all' runs every Envoy check."),
  }),
  async run(params, ctx) {
    const origin = base(params.target)
    const results = await Envoy.run(ctx.sender, origin, params.check)
    return { target: origin, results }
  },
  format(r) {
    return summarize("envoy_test", r.target, r.results)
  },
})
