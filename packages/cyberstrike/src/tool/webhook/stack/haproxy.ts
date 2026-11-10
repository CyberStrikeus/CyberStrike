// haproxy stack checks — ported from infra-security-mcp `providers/haproxy`.
import z from "zod"
import { defineWebhookTool } from "../define"
import type { HttpSender } from "../transport"
import { get, header, failed, ok, base, summarize, type Check } from "./shared"

const CVES: Record<string, string> = {
  "2.0": "CVE-2023-25725 (header smuggling)",
  "2.2": "CVE-2023-0836",
  "2.6": "CVE-2023-40225",
}

export namespace Haproxy {
  export async function detect(sender: HttpSender, origin: string): Promise<Check> {
    const res = await get(sender, origin)
    if (failed(res)) return { check: "detect", hit: false, severity: "info", detail: "no response" }
    let score = 0
    if (/haproxy/i.test(header(res, "server"))) score += 40
    if (header(res, "x-haproxy-server-state") !== "") score += 30
    if (/SERVERID|SRV/.test(header(res, "set-cookie"))) score += 15
    if (/haproxy/i.test(header(res, "via"))) score += 20
    if ((res.status === 503 || res.status === 408) && /haproxy/i.test(res.body)) score += 20
    if (score < 30) return { check: "detect", hit: false, severity: "info", detail: "HAProxy not detected" }
    return { check: "detect", hit: true, severity: "info", detail: `HAProxy detected (score ${score})`, evidence: header(res, "server") || header(res, "via") }
  }

  export async function statsExposure(sender: HttpSender, origin: string): Promise<Check> {
    const paths = ["/haproxy?stats", "/haproxy?stats;csv", "/stats", "/admin/stats", "/haproxy-stats", "/;csv"]
    for (const p of paths) {
      const res = await get(sender, `${origin}${p}`)
      if (failed(res)) continue
      if (res.status === 200 && /(Statistics Report|pxname,svname)/i.test(res.body))
        return { check: "stats_exposure", hit: true, severity: "high", detail: `HAProxy stats page exposed at ${p}`, evidence: res.body.slice(0, 200) }
    }
    return { check: "stats_exposure", hit: false, severity: "info", detail: "HAProxy stats not exposed" }
  }

  export async function aclBypass(sender: HttpSender, origin: string): Promise<Check> {
    const guard = await get(sender, `${origin}/admin`)
    if (failed(guard) || (guard.status !== 401 && guard.status !== 403))
      return { check: "acl_bypass", hit: false, severity: "info", detail: "/admin not access-controlled" }
    const tricks = ["/admin%2f", "/admin%252f", "/admin.", "/admin/.", "/admin;", "/..;/admin", "//admin", "/admin%09", "/admin%00"]
    for (const t of tricks) {
      const res = await get(sender, `${origin}${t}`)
      if (ok(res) && res.status === 200)
        return { check: "acl_bypass", hit: true, severity: "high", detail: `HAProxy ACL bypass on /admin via ${t}`, evidence: `guard=${guard.status} bypass=${res.status}` }
    }
    for (const h of [{ "X-Original-URL": "/admin" }, { "X-Rewrite-URL": "/admin" }, { "X-HTTP-Method-Override": "GET" }] as Record<string, string>[]) {
      const res = await get(sender, `${origin}/`, h)
      if (ok(res) && res.status === 200 && !/login|forbidden/i.test(res.body.slice(0, 500)))
        return { check: "acl_bypass", hit: true, severity: "high", detail: `HAProxy ACL bypass via ${Object.keys(h)[0]}`, evidence: `header override → ${res.status}` }
    }
    return { check: "acl_bypass", hit: false, severity: "info", detail: "no ACL bypass on /admin" }
  }

  export async function requestSmuggling(sender: HttpSender, origin: string): Promise<Check> {
    // HEURISTIC (timing only): ReplaySender normalizes headers, so byte-exact CL.TE/TE.CL
    // is NOT expressible here — use the dedicated http_smuggling tool for a real test.
    // This flags a suspiciously slow response to a chunked+CL body (possible desync hang).
    const t0 = Date.now()
    const res = await sender.send({
      method: "POST",
      url: origin,
      headers: { "Content-Length": "6", "Transfer-Encoding": "chunked" },
      body: "0\r\n\r\nX",
    })
    const ms = Date.now() - t0
    if (!failed(res) && ms > 8000)
      return { check: "request_smuggling", hit: true, severity: "medium", detail: `slow response (${ms}ms) to CL+TE body — possible desync. HEURISTIC: confirm with http_smuggling.`, evidence: `status=${res.status} ${ms}ms` }
    return { check: "request_smuggling", hit: false, severity: "info", detail: "no timing-based smuggling signal (use http_smuggling for a byte-exact test)" }
  }

  export async function version(sender: HttpSender, origin: string): Promise<Check> {
    const res = await get(sender, origin)
    if (failed(res)) return { check: "version", hit: false, severity: "info", detail: "no response" }
    const m = (header(res, "server") + res.body.slice(0, 2000)).match(/HAProxy[\/ ]([\d.]+)/i)
    if (!m) return { check: "version", hit: false, severity: "info", detail: "HAProxy version not disclosed" }
    const cve = CVES[m[1].split(".").slice(0, 2).join(".")]
    return { check: "version", hit: true, severity: cve ? "medium" : "low", detail: `HAProxy ${m[1]} disclosed${cve ? ` — ${cve}` : ""}`, evidence: m[0] }
  }

  const RUNNERS: Record<string, (s: HttpSender, o: string) => Promise<Check>> = {
    detect,
    stats_exposure: statsExposure,
    acl_bypass: aclBypass,
    request_smuggling: requestSmuggling,
    version,
  }

  export async function run(sender: HttpSender, origin: string, which: string): Promise<Check[]> {
    const names = which === "all" ? Object.keys(RUNNERS) : [which]
    const out: Check[] = []
    for (const n of names) out.push(await RUNNERS[n](sender, origin))
    return out
  }
}

const DESCRIPTION = `HAProxy checks (detection, stats-page exposure, /admin ACL bypass, request-smuggling timing heuristic, version→CVE disclosure).

Run after Vortex fingerprints HAProxy. Smuggling here is a timing heuristic — use http_smuggling for a byte-exact test. Probes go through the scope-guarded replay engine. check="all" (default) runs every check.`

export const HaproxyTestTool = defineWebhookTool({
  name: "haproxy_test",
  description: DESCRIPTION,
  parameters: z.object({
    target: z.string().describe("Target origin or URL (e.g. https://target.com)."),
    check: z
      .enum(["all", "detect", "stats_exposure", "acl_bypass", "request_smuggling", "version"])
      .default("all")
      .describe("Which check to run; 'all' runs every HAProxy check."),
  }),
  async run(params, ctx) {
    const origin = base(params.target)
    const results = await Haproxy.run(ctx.sender, origin, params.check)
    return { target: origin, results }
  },
  format(r) {
    return summarize("haproxy_test", r.target, r.results)
  },
})
