// haproxy stack checks — ported 1:1 from infra-security-mcp `providers/haproxy`.
// Every path/payload/condition matches the source exactly; only the transport
// (scope-guarded webhook sender) and the Check/severity adapter are CyberStrike's.
import z from "zod"
import { defineWebhookTool } from "../define"
import type { HttpSender } from "../transport"
import { get, header, failed, ok, base, summarize, type Check } from "./shared"

export namespace Haproxy {
  export async function detect(sender: HttpSender, origin: string): Promise<Check> {
    const findings: string[] = []
    let confidence = 0

    const res = await get(sender, origin)
    if (failed(res)) return { check: "detect", hit: false, severity: "info", detail: res.error }

    const server = header(res, "server")
    if (/haproxy/i.test(server)) {
      findings.push(`Server header: ${server}`)
      confidence += 40
    }

    for (const k in res.headers)
      if (/^x-haproxy/i.test(k)) {
        findings.push(`Header ${k}: ${res.headers[k]}`)
        confidence += 20
      }

    const setCookie = header(res, "set-cookie")
    for (const pattern of ["SERVERID", "SRV", "SRVNAME", "ROUTEID"])
      if (setCookie.includes(pattern)) {
        findings.push(`HAProxy persistence cookie: ${pattern}`)
        confidence += 25
      }

    if (
      res.body.includes("<html><body><h1>503 Service Unavailable</h1>") ||
      res.body.includes("No server is available to handle this request")
    ) {
      findings.push("Default HAProxy 503 error page detected")
      confidence += 30
    }

    if (res.body.includes("<html><body><h1>408 Request Time-out</h1>")) {
      findings.push("Default HAProxy 408 timeout page detected")
      confidence += 25
    }

    const via = header(res, "via")
    if (/haproxy/i.test(via)) {
      findings.push(`Via header: ${via}`)
      confidence += 20
    }

    const badRes = await get(sender, `${origin}/___haproxy_nonexistent_path_test___`)
    if (ok(badRes) && badRes.body.includes("503 Service Unavailable") && badRes.body.includes("<html><body><h1>")) {
      findings.push("HAProxy-style error page on invalid path")
      confidence += 15
    }

    confidence = Math.min(confidence, 100)
    const hit = confidence >= 30
    return {
      check: "detect",
      hit,
      severity: "info",
      detail: `${hit ? "HAProxy detected" : "HAProxy not detected"} (confidence ${confidence})`,
      evidence: findings.join("; ") || undefined,
    }
  }

  export async function statsExposure(sender: HttpSender, origin: string): Promise<Check> {
    const paths = [
      "/haproxy?stats",
      "/haproxy-status",
      "/stats",
      "/admin/stats",
      "/haproxy?stats;csv",
      "/haproxy?stats;json",
      "/_haproxy_stats",
      "/haproxy_stats",
    ]

    const results: { path: string; status: number; authenticated: boolean; exposed: boolean; info?: string }[] = []

    for (const path of paths) {
      const res = await get(sender, `${origin}${path}`)
      if (failed(res)) continue

      const isStats =
        res.body.includes("HAProxy") ||
        res.body.includes("haproxy") ||
        res.body.includes("Statistics Report") ||
        res.body.includes("pxname,svname") ||
        res.body.includes('"stats"')

      const needsAuth = res.status === 401
      const exposed = isStats && res.status === 200

      if (exposed || needsAuth) {
        const match = exposed ? res.body.match(/HAProxy\s+version\s+([\d.]+)/i) : null
        results.push({ path, status: res.status, authenticated: !needsAuth, exposed, info: match ? `HAProxy version: ${match[1]}` : undefined })
      }
    }

    const exposed = results.filter((r) => r.exposed)
    const hit = exposed.length > 0
    return {
      check: "stats_exposure",
      hit,
      severity: hit ? "high" : "info",
      detail: hit
        ? `HAProxy stats page exposed at ${exposed.map((r) => r.path).join(", ")}`
        : `stats not exposed (${results.filter((r) => r.status === 401).length} auth-protected)`,
      evidence: exposed.map((r) => `${r.path} [${r.status}]${r.info ? ` ${r.info}` : ""}`).join("; ") || undefined,
    }
  }

  export async function aclBypass(sender: HttpSender, origin: string): Promise<Check> {
    const path = "/admin"
    const bypasses: { technique: string; status: number; note: string }[] = []

    const baseline = await get(sender, `${origin}${path}`)
    const blockedStatus = ok(baseline) ? baseline.status : 0

    const techniques: { name: string; url: string; method?: string; headers?: Record<string, string> }[] = [
      { name: "URL-encoded slash", url: `${origin}${path.replace(/\//g, "%2f")}` },
      { name: "Double URL encoding", url: `${origin}${path.replace(/\//g, "%252f")}` },
      { name: "Path with trailing dot", url: `${origin}${path}.` },
      { name: "Path with trailing /.", url: `${origin}${path}/.` },
      { name: "Path with ;", url: `${origin}${path};` },
      { name: "Path with ..;/", url: `${origin}/..;${path}` },
      { name: "Case variation", url: `${origin}${path.toUpperCase()}` },
      { name: "Double slash prefix", url: `${origin}//${path.slice(1)}` },
      { name: "Tab in path", url: `${origin}${path}%09` },
      { name: "Null byte", url: `${origin}${path}%00` },
      { name: "X-Original-URL header", url: `${origin}/`, headers: { "X-Original-URL": path } },
      { name: "X-Rewrite-URL header", url: `${origin}/`, headers: { "X-Rewrite-URL": path } },
      { name: "X-HTTP-Method-Override", url: `${origin}${path}`, method: "POST", headers: { "X-HTTP-Method-Override": "GET" } },
    ]

    for (const t of techniques) {
      const res = await sender.send({ method: t.method ?? "GET", url: t.url, headers: t.headers ?? {} })
      if (failed(res)) continue

      const bypassed = res.status !== blockedStatus && res.status >= 200 && res.status < 400
      if (bypassed) bypasses.push({ technique: t.name, status: res.status, note: `Baseline returned ${blockedStatus}, bypass returned ${res.status}` })
    }

    const hit = bypasses.length > 0
    return {
      check: "acl_bypass",
      hit,
      severity: hit ? "high" : "info",
      detail: hit
        ? `HAProxy ACL bypass on ${path} (baseline ${blockedStatus}): ${bypasses.map((b) => `${b.technique}→${b.status}`).join(", ")}`
        : `no ACL bypass on ${path} (baseline ${blockedStatus}, ${techniques.length} techniques)`,
      evidence: bypasses.map((b) => b.note).join("; ") || undefined,
    }
  }

  // SPECIAL CASE: the source sends CL.TE/TE.CL/TE.TE via duplicate/odd Transfer-Encoding
  // + Content-Length headers and flags on responseTime > 80% of the request timeout.
  // Our `sender.send` NORMALIZES headers (no duplicate Transfer-Encoding, no odd CL) and
  // ProbeResponse has no responseTime, so this is a best-effort TIMING HEURISTIC only;
  // byte-exact smuggling belongs to the existing http_smuggling tool.
  export async function requestSmuggling(sender: HttpSender, origin: string): Promise<Check> {
    const t0 = Date.now()
    const res = await sender.send({ method: "POST", url: origin, headers: { "Content-Length": "6", "Transfer-Encoding": "chunked" }, body: "0\r\n\r\nX" })
    const ms = Date.now() - t0
    const slow = ok(res) && ms > 8000

    return {
      check: "request_smuggling",
      hit: slow,
      severity: slow ? "high" : "info",
      detail: slow
        ? `HEURISTIC: POST with Content-Length/Transfer-Encoding stalled ${ms}ms — possible CL.TE/TE.CL desync near the proxy read timeout. sender.send normalizes headers; byte-exact smuggling belongs to the http_smuggling tool.`
        : `HEURISTIC: no desync timing signal (${ms}ms). sender.send normalizes headers (no duplicate Transfer-Encoding / odd Content-Length); byte-exact smuggling belongs to the http_smuggling tool.`,
      evidence: `responseTime=${ms}ms`,
    }
  }

  export async function version(sender: HttpSender, origin: string): Promise<Check> {
    const sources: string[] = []

    const res = await get(sender, origin)
    const server = ok(res) ? header(res, "server") : ""
    const serverMatch = server.match(/HAProxy[/ ]([\d.]+)/i)
    let version: string | null = serverMatch ? serverMatch[1] : null
    if (serverMatch) sources.push(`Server header: ${server}`)

    for (const path of ["/haproxy?stats", "/stats", "/haproxy-status"]) {
      const statsRes = await get(sender, `${origin}${path}`)
      if (ok(statsRes) && statsRes.status === 200) {
        const vMatch = statsRes.body.match(/HAProxy\s+version\s+([\d.]+[-\w]*)/i)
        if (vMatch) {
          version = vMatch[1]
          sources.push(`Stats page (${path}): ${vMatch[0]}`)
          break
        }
      }
    }

    const errRes = await get(sender, `${origin}/___force_haproxy_error_` + Date.now())
    const errMatch = ok(errRes) ? errRes.body.match(/HAProxy[/ ]([\d.]+[-\w]*)/i) : null
    if (errMatch) {
      version = version ?? errMatch[1]
      sources.push(`Error page: ${errMatch[0]}`)
    }

    const knownCves: Record<string, string[]> = {
      "2.0": ["CVE-2023-25725 — HTTP/1 header parsing (empty Content-Length)"],
      "2.2": ["CVE-2023-25725 — HTTP/1 header parsing"],
      "2.4": ["CVE-2023-25725 — HTTP/1 header parsing"],
      "2.6": ["CVE-2023-25725 — HTTP/1 header parsing", "CVE-2023-0836 — empty Content-Length h2/h3"],
      "2.7": ["CVE-2023-25725 — HTTP/1 header parsing"],
      "1.8": ["CVE-2021-40346 — integer overflow request smuggling", "CVE-2023-25725 — HTTP/1 header parsing"],
    }

    let matchedCves: string[] = []
    if (version) {
      const major = version.split(".").slice(0, 2).join(".")
      matchedCves = knownCves[major] ?? []
    }

    const hit = version !== null
    return {
      check: "version",
      hit,
      severity: hit ? "low" : "info",
      detail: hit
        ? `HAProxy ${version} (${sources.join("; ")})${matchedCves.length ? ` — CVEs: ${matchedCves.join(", ")}` : ""}`
        : "version not detected from headers, stats, or error pages",
      evidence: matchedCves.join(", ") || sources.join("; ") || undefined,
    }
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

const DESCRIPTION = `HAProxy deterministic checks (header/cookie/error-page detection, stats-page exposure, ACL bypass via path normalization + header override, request-smuggling timing heuristic, version disclosure + CVE map). 1:1 port of the infra-security haproxy provider.

Run after Vortex fingerprints HAProxy. Probes go through the scope-guarded replay engine. request_smuggling is a best-effort timing HEURISTIC — byte-exact desync belongs to http_smuggling. check="all" (default) runs every check.`

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
