// nginx stack checks — ported from infra-security-mcp `providers/nginx`.
// Six checks bundled under one tool, selected by `check` (default "all"), each
// sending through the scope-guarded webhook sender.
import z from "zod"
import { defineWebhookTool } from "../define"
import type { HttpSender } from "../transport"
import { get, header, failed, ok, base, summarize, type Check } from "./shared"

export namespace Nginx {
  export async function version(sender: HttpSender, origin: string): Promise<Check> {
    const [root, miss] = await Promise.all([get(sender, origin), get(sender, `${origin}/__nonexistent_${Date.now()}__`)])
    const hay = [root, miss]
      .filter(ok)
      .map((r) => `${header(r, "server")} ${r.body.slice(0, 4000)}`)
      .join(" ")
    const m = hay.match(/(nginx|openresty|tengine)\/([\d.]+)/i)
    if (!m) return { check: "version", hit: false, severity: "info", detail: "nginx version not disclosed" }
    return { check: "version", hit: true, severity: "low", detail: `${m[1]} ${m[2]} disclosed in Server/error page`, evidence: m[0] }
  }

  export async function configLeak(sender: HttpSender, origin: string): Promise<Check> {
    const paths = [
      "/nginx.conf", "/.nginx.conf", "/nginx.conf.bak", "/nginx.conf.old", "/nginx.conf~",
      "/conf/nginx.conf", "/etc/nginx/nginx.conf", "/server/nginx.conf", "/.config/nginx.conf", "/conf.d/default.conf",
    ]
    const sigs = ["server {", "location ", "proxy_pass", "upstream ", "worker_processes"]
    for (const p of paths) {
      const res = await get(sender, `${origin}${p}`)
      if (failed(res)) continue
      if (res.status === 200 && sigs.some((s) => res.body.includes(s)))
        return { check: "config_leak", hit: true, severity: "high", detail: `nginx config exposed at ${p}`, evidence: res.body.slice(0, 500) }
    }
    return { check: "config_leak", hit: false, severity: "info", detail: "no exposed nginx config file" }
  }

  export async function status(sender: HttpSender, origin: string): Promise<Check> {
    const paths = ["/nginx_status", "/stub_status", "/status", "/server-status", "/nginx-status", "/basic_status", "/_status"]
    for (const p of paths) {
      const res = await get(sender, `${origin}${p}`)
      if (failed(res)) continue
      if (res.status === 200 && res.body.includes("Active connections"))
        return { check: "status", hit: true, severity: "medium", detail: `nginx stub_status exposed at ${p}`, evidence: res.body.slice(0, 300) }
    }
    return { check: "status", hit: false, severity: "info", detail: "stub_status not exposed" }
  }

  export async function aliasTraversal(sender: HttpSender, origin: string): Promise<Check> {
    const locs = ["/assets", "/static", "/images", "/media", "/files", "/uploads", "/css", "/js"]
    const travs = ["../etc/passwd", "../etc/hostname", "../proc/self/environ"]
    for (const loc of locs)
      for (const t of travs) {
        const res = await get(sender, `${origin}${loc}${t}`)
        if (failed(res)) continue
        const b = res.body
        const leak = (b.includes("root:") && b.includes("/bin/")) || (b.includes("path=") && b.includes("home="))
        if (res.status === 200 && leak)
          return { check: "alias_traversal", hit: true, severity: "high", detail: `nginx alias path traversal at ${loc}${t}`, evidence: b.slice(0, 300) }
      }
    return { check: "alias_traversal", hit: false, severity: "info", detail: "no alias-misconfig traversal" }
  }

  export async function offBySlash(sender: HttpSender, origin: string): Promise<Check> {
    const prefixes = ["/app", "/api", "/admin", "/internal", "/backend", "/service"]
    for (const p of prefixes) {
      const [a, b, c] = await Promise.all([
        get(sender, `${origin}${p}`),
        get(sender, `${origin}${p}/`),
        get(sender, `${origin}${p}../`),
      ])
      if (failed(a) || failed(b) || failed(c)) continue
      const slashLeak = a.status === 404 && b.status === 200
      const dotLeak = c.status === 200 && a.status !== 200
      if (slashLeak || dotLeak)
        return { check: "off_by_slash", hit: true, severity: "medium", detail: `nginx off-by-slash proxy_pass leak at ${p}`, evidence: `base=${a.status} slash=${b.status} dotdot=${c.status}` }
    }
    return { check: "off_by_slash", hit: false, severity: "info", detail: "no off-by-slash behavior" }
  }

  export async function mergeSlashes(sender: HttpSender, origin: string): Promise<Check> {
    const paths = ["/admin", "/api", "/internal", "/private", "/management"]
    for (const p of paths) {
      const [one, two, three] = await Promise.all([
        get(sender, `${origin}${p}`),
        get(sender, `${origin}/${p}`),
        get(sender, `${origin}//${p}`),
      ])
      if (failed(one) || failed(two) || failed(three)) continue
      const blocked = one.status === 401 || one.status === 403
      if (blocked && (two.status === 200 || three.status === 200))
        return { check: "merge_slashes", hit: true, severity: "high", detail: `nginx merge_slashes ACL bypass at ${p}`, evidence: `base=${one.status} //=${two.status} ///=${three.status}` }
    }
    return { check: "merge_slashes", hit: false, severity: "info", detail: "no merge_slashes ACL bypass" }
  }

  const RUNNERS: Record<string, (s: HttpSender, o: string) => Promise<Check>> = {
    version,
    config_leak: configLeak,
    status,
    alias_traversal: aliasTraversal,
    off_by_slash: offBySlash,
    merge_slashes: mergeSlashes,
  }

  export async function run(sender: HttpSender, origin: string, which: string): Promise<Check[]> {
    const names = which === "all" ? Object.keys(RUNNERS) : [which]
    const out: Check[] = []
    for (const n of names) out.push(await RUNNERS[n](sender, origin))
    return out
  }
}

const DESCRIPTION = `nginx deterministic checks (version disclosure, exposed nginx.conf, stub_status, alias path traversal, off-by-slash proxy_pass leak, merge_slashes ACL bypass).

Run after Vortex fingerprints nginx/OpenResty/Tengine (technology:nginx) or a Server header reveals it. Probes go through the scope-guarded replay engine. Use check="all" (default) for the full sweep, or a single check by name.`

export const NginxTestTool = defineWebhookTool({
  name: "nginx_test",
  description: DESCRIPTION,
  parameters: z.object({
    target: z.string().describe("Target origin or URL (e.g. https://target.com)."),
    check: z
      .enum(["all", "version", "config_leak", "status", "alias_traversal", "off_by_slash", "merge_slashes"])
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
