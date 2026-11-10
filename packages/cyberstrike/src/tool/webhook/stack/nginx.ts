// nginx stack checks — ported 1:1 from infra-security-mcp `providers/nginx`.
// Every path/payload/condition matches the source exactly; only the transport
// (scope-guarded webhook sender) and the Check/severity adapter are CyberStrike's.
import z from "zod"
import { defineWebhookTool } from "../define"
import type { HttpSender } from "../transport"
import { get, header, failed, ok, base, summarize, type Check } from "./shared"

export namespace Nginx {
  export async function version(sender: HttpSender, origin: string): Promise<Check> {
    const [main, notFound] = await Promise.all([get(sender, origin), get(sender, `${origin}/__nonexistent_path_${Date.now()}__`)])
    const serverHeader = (ok(main) ? header(main, "server") : "") || (ok(notFound) ? header(notFound, "server") : "")
    const body = ok(notFound) ? notFound.body : ""
    const versionMatch = serverHeader.match(/nginx\/([\d.]+)/i)
    const openResty = serverHeader.match(/openresty\/([\d.]+)/i)
    const tengine = serverHeader.match(/tengine\/([\d.]+)/i)
    const nginxPlus = serverHeader.match(/nginx-plus/i)
    const bodyVersion = body.match(/nginx\/([\d.]+)/i)
    const variant = openResty ? "OpenResty" : tengine ? "Tengine" : nginxPlus ? "nginx-plus" : "nginx"
    const ver = versionMatch?.[1] ?? openResty?.[1] ?? tengine?.[1] ?? bodyVersion?.[1] ?? null
    const isNginx =
      /nginx|openresty|tengine/i.test(serverHeader) || body.toLowerCase().includes("nginx")
    if (!isNginx) return { check: "version", hit: false, severity: "info", detail: "nginx not detected" }
    return {
      check: "version",
      hit: true,
      severity: ver ? "low" : "info",
      detail: `${variant}${ver ? ` ${ver}` : ""} detected${bodyVersion ? " (error page leaks version)" : ""}`,
      evidence: serverHeader || (bodyVersion ? bodyVersion[0] : variant),
    }
  }

  export async function aliasTraversal(sender: HttpSender, origin: string): Promise<Check> {
    const locs = ["/assets", "/static", "/images", "/media", "/files", "/uploads", "/css", "/js"]
    const traversals = ["../etc/passwd", "../etc/hostname", "../proc/self/environ"]
    for (const loc of locs)
      for (const trav of traversals) {
        const res = await get(sender, `${origin}${loc}${trav}`)
        if (failed(res)) continue
        const bodyLower = res.body.toLowerCase()
        const hasPasswd = bodyLower.includes("root:") && bodyLower.includes("/bin/")
        const hasHostname = res.status === 200 && res.body.trim().length > 0 && res.body.trim().length < 256 && trav.includes("hostname")
        const hasEnviron = bodyLower.includes("path=") && bodyLower.includes("home=")
        if (hasPasswd || hasHostname || hasEnviron)
          return { check: "alias_traversal", hit: true, severity: "high", detail: `nginx alias path traversal at ${loc}${trav}`, evidence: res.body.substring(0, 500) }
      }
    return { check: "alias_traversal", hit: false, severity: "info", detail: "no alias-misconfig traversal" }
  }

  export async function offBySlash(sender: HttpSender, origin: string): Promise<Check> {
    const paths = ["/app", "/api", "/admin", "/internal", "/backend", "/service"]
    for (const p of paths) {
      const [noSlash, withSlash, withTraversal] = await Promise.all([
        get(sender, `${origin}${p}`),
        get(sender, `${origin}${p}/`),
        get(sender, `${origin}${p}../`),
      ])
      if (failed(noSlash) || failed(withSlash) || failed(withTraversal)) continue
      const reasons: string[] = []
      if (noSlash.status === 404 && withSlash.status === 200) reasons.push("trailing slash changes 404→200 (proxy_pass routing difference)")
      if (withTraversal.status === 200 && noSlash.status !== 200) reasons.push("../ traversal returns 200 while base path does not")
      if (withTraversal.status === 200 && withTraversal.body.length > 0 && Math.abs(withTraversal.body.length - withSlash.body.length) > 100)
        reasons.push("../ traversal body differs significantly from normal path")
      if (reasons.length > 0)
        return { check: "off_by_slash", hit: true, severity: "medium", detail: `nginx off-by-slash at ${p}: ${reasons.join("; ")}`, evidence: `base=${noSlash.status} slash=${withSlash.status} dotdot=${withTraversal.status}` }
    }
    return { check: "off_by_slash", hit: false, severity: "info", detail: "no off-by-slash behavior" }
  }

  export async function mergeSlashes(sender: HttpSender, origin: string): Promise<Check> {
    const paths = ["/admin", "/api", "/internal", "/private", "/management"]
    for (const p of paths) {
      const doubleP = p.replace("/", "//")
      const tripleP = p.replace("/", "///")
      const [single, double, triple] = await Promise.all([
        get(sender, `${origin}${p}`),
        get(sender, `${origin}${doubleP}`),
        get(sender, `${origin}${tripleP}`),
      ])
      if (failed(single) || failed(double) || failed(triple)) continue
      const bypass = (single.status === 403 || single.status === 401) && (double.status === 200 || triple.status === 200)
      if (bypass)
        return { check: "merge_slashes", hit: true, severity: "high", detail: `nginx merge_slashes ACL bypass at ${p}`, evidence: `single=${single.status} double=${double.status} triple=${triple.status}` }
    }
    return { check: "merge_slashes", hit: false, severity: "info", detail: "no merge_slashes ACL bypass" }
  }

  export async function status(sender: HttpSender, origin: string): Promise<Check> {
    const statusPaths = ["/nginx_status", "/stub_status", "/status", "/server-status", "/nginx-status", "/basic_status", "/_status"]
    for (const sp of statusPaths) {
      const res = await get(sender, `${origin}${sp}`)
      if (failed(res)) continue
      if (res.status === 200 && res.body.includes("Active connections"))
        return { check: "status", hit: true, severity: "medium", detail: `nginx stub_status exposed at ${sp}`, evidence: res.body.substring(0, 1000) }
    }
    return { check: "status", hit: false, severity: "info", detail: "stub_status not exposed" }
  }

  export async function configLeak(sender: HttpSender, origin: string): Promise<Check> {
    const configPaths = ["/nginx.conf", "/.nginx.conf", "/nginx.conf.bak", "/nginx.conf.old", "/nginx.conf~", "/conf/nginx.conf", "/etc/nginx/nginx.conf", "/server/nginx.conf", "/.config/nginx.conf", "/conf.d/default.conf"]
    for (const cp of configPaths) {
      const res = await get(sender, `${origin}${cp}`)
      if (failed(res)) continue
      if (res.status === 200 && (res.body.includes("server {") || res.body.includes("location ") || res.body.includes("proxy_pass") || res.body.includes("upstream ") || res.body.includes("worker_processes")))
        return { check: "config_leak", hit: true, severity: "high", detail: `nginx config exposed at ${cp}`, evidence: res.body.substring(0, 2000) }
    }
    return { check: "config_leak", hit: false, severity: "info", detail: "no exposed nginx config file" }
  }

  const RUNNERS: Record<string, (s: HttpSender, o: string) => Promise<Check>> = {
    version,
    alias_traversal: aliasTraversal,
    off_by_slash: offBySlash,
    merge_slashes: mergeSlashes,
    status,
    config_leak: configLeak,
  }

  export async function run(sender: HttpSender, origin: string, which: string): Promise<Check[]> {
    const names = which === "all" ? Object.keys(RUNNERS) : [which]
    const out: Check[] = []
    for (const n of names) out.push(await RUNNERS[n](sender, origin))
    return out
  }
}

const DESCRIPTION = `nginx deterministic checks (version/variant disclosure, alias path traversal, off-by-slash proxy_pass leak, merge_slashes ACL bypass, stub_status exposure, exposed nginx.conf). 1:1 port of the infra-security nginx provider.

Run after Vortex fingerprints nginx/OpenResty/Tengine. Probes go through the scope-guarded replay engine. check="all" (default) runs every check.`

export const NginxTestTool = defineWebhookTool({
  name: "nginx_test",
  description: DESCRIPTION,
  parameters: z.object({
    target: z.string().describe("Target origin or URL (e.g. https://target.com)."),
    check: z
      .enum(["all", "version", "alias_traversal", "off_by_slash", "merge_slashes", "status", "config_leak"])
      .default("all")
      .describe("Which check to run; 'all' runs every nginx check."),
  }),
  async run(params, ctx) {
    const origin = base(params.target)
    const results = await Nginx.run(ctx.sender, origin, params.check)
    return { target: origin, results }
  },
  format(r) {
    return summarize("nginx_test", r.target, r.results)
  },
})
