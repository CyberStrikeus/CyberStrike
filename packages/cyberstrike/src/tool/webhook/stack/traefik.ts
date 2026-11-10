// traefik stack checks — ported 1:1 from infra-security-mcp `providers/traefik`.
// Every path/payload/condition matches the source exactly; only the transport
// (scope-guarded webhook sender) and the Check/severity adapter are CyberStrike's.
import z from "zod"
import { defineWebhookTool } from "../define"
import type { HttpSender } from "../transport"
import { get, header, failed, ok, base, withPort, host, summarize, type Check } from "./shared"

export namespace Traefik {
  export async function detect(sender: HttpSender, origin: string): Promise<Check> {
    const findings: string[] = []
    let confidence = 0

    const res = await get(sender, origin)
    if (failed(res)) return { check: "detect", hit: false, severity: "info", detail: res.error }

    const server = header(res, "server")
    if (/traefik/i.test(server)) {
      findings.push(`Server header: ${server}`)
      confidence += 50
    }

    for (const k in res.headers)
      if (/^x-traefik/i.test(k)) {
        findings.push(`Header ${k}: ${res.headers[k]}`)
        confidence += 20
      }

    // Traefik default 404 page has a specific style
    const notFoundRes = await get(sender, `${origin}/___traefik_detect_${Date.now()}`)
    if (ok(notFoundRes) && notFoundRes.body.includes("404 page not found")) {
      // Traefik returns bare "404 page not found" without HTML wrapper by default
      if (!notFoundRes.body.includes("<html") && !notFoundRes.body.includes("<HTML")) {
        findings.push("Bare '404 page not found' response (Traefik default)")
        confidence += 35
      }
    }

    // Check for Traefik-specific Via header
    const via = header(res, "via")
    if (/traefik/i.test(via)) {
      findings.push(`Via header: ${via}`)
      confidence += 20
    }

    // Traefik sets specific error codes for backend connection issues
    const badBackend = await sender.send({ method: "GET", url: `${origin}/`, headers: { Host: `nonexistent-backend-${Date.now()}.local` } })
    if (ok(badBackend) && badBackend.status === 404 && badBackend.body === "404 page not found\n") {
      findings.push("Traefik-style bare 404 for unknown Host")
      confidence += 25
    }

    confidence = Math.min(confidence, 100)
    const hit = confidence >= 30
    return {
      check: "detect",
      hit,
      severity: "info",
      detail: `${hit ? "Traefik detected" : "Traefik not detected"} (confidence ${confidence})`,
      evidence: findings.join("; ") || undefined,
    }
  }

  export async function dashboard(sender: HttpSender, origin: string): Promise<Check> {
    const bases = [origin, withPort(origin, 8080)]

    const paths = [
      "/dashboard/",
      "/dashboard/#/",
      "/api/rawdata",
      "/api/overview",
      "/api/http/routers",
      "/api/http/services",
      "/api/http/middlewares",
      "/api/tcp/routers",
      "/api/entrypoints",
      "/api/version",
    ]

    const exposed: { url: string; status: number; type: string; sample?: string }[] = []

    for (const b of bases)
      for (const path of paths) {
        const res = await get(sender, `${b}${path}`)
        if (failed(res)) continue

        if (res.status === 200) {
          const isDashboard =
            res.body.includes("traefik") ||
            res.body.includes("Traefik") ||
            res.body.includes('"routers"') ||
            res.body.includes('"services"') ||
            res.body.includes('"entryPoints"') ||
            res.body.includes('"version"')

          if (isDashboard) {
            const type = path.includes("dashboard")
              ? "dashboard_ui"
              : path.includes("rawdata")
                ? "full_config"
                : path.includes("routers")
                  ? "router_config"
                  : path.includes("services")
                    ? "service_config"
                    : path.includes("middlewares")
                      ? "middleware_config"
                      : path.includes("version")
                        ? "version_info"
                        : path.includes("entrypoints")
                          ? "entrypoint_config"
                          : path.includes("overview")
                            ? "overview"
                            : "unknown"

            exposed.push({ url: `${b}${path}`, status: res.status, type, sample: res.body.slice(0, 500) })
          }
        }
      }

    const hasFullConfig = exposed.some((e) => e.type === "full_config")
    const hasDashboard = exposed.some((e) => e.type === "dashboard_ui")
    const hit = exposed.length > 0

    return {
      check: "dashboard",
      hit,
      severity: hasFullConfig ? "critical" : hasDashboard ? "high" : hit ? "medium" : "info",
      detail: hasFullConfig
        ? `Traefik full routing config exposed — reveals all backend services, middleware chain, TLS config (${exposed.map((e) => e.url).join(", ")})`
        : hasDashboard
          ? `Traefik dashboard UI accessible — allows viewing and potentially modifying routing (${exposed.map((e) => e.url).join(", ")})`
          : hit
            ? `Traefik partial API exposure — reveals some configuration (${exposed.map((e) => `${e.url} [${e.type}]`).join(", ")})`
            : "no Traefik API endpoints found",
      evidence: exposed.map((e) => `${e.url} [${e.type}]`).join("; ") || undefined,
    }
  }

  export async function middlewareBypass(sender: HttpSender, origin: string): Promise<Check> {
    const path = "/admin"
    const bypasses: { technique: string; status: number; note: string }[] = []

    const baseline = await get(sender, `${origin}${path}`)
    const blockedStatus = ok(baseline) ? baseline.status : 0

    const techniques: { name: string; url: string; method?: string; headers?: Record<string, string> }[] = [
      // stripPrefix bypass: extra path segments that get stripped
      { name: "stripPrefix double-path", url: `${origin}${path}${path}` },
      { name: "stripPrefix trailing slash", url: `${origin}${path}/` },
      { name: "stripPrefix with dot segment", url: `${origin}${path}/./` },
      { name: "Path traversal via ..", url: `${origin}/public/../${path.slice(1)}` },

      // URL encoding bypass
      { name: "URL-encoded path", url: `${origin}${path.replace(/\//g, "%2f")}` },
      { name: "Unicode encoding", url: `${origin}${path.replace(/\//g, "%ef%bc%8f")}` },

      // Host header manipulation
      { name: "X-Forwarded-Host injection", url: `${origin}${path}`, headers: { "X-Forwarded-Host": "localhost" } },
      { name: "X-Forwarded-For 127.0.0.1", url: `${origin}${path}`, headers: { "X-Forwarded-For": "127.0.0.1" } },
      { name: "X-Real-IP 127.0.0.1", url: `${origin}${path}`, headers: { "X-Real-IP": "127.0.0.1" } },
      { name: "X-Forwarded-Proto http", url: `${origin}${path}`, headers: { "X-Forwarded-Proto": "http" } },

      // Method-based
      { name: "OPTIONS method", url: `${origin}${path}`, method: "OPTIONS" },
      { name: "HEAD method", url: `${origin}${path}`, method: "HEAD" },

      // Case and encoding
      { name: "Mixed case", url: `${origin}${path.split("").map((c, i) => (i % 2 ? c.toUpperCase() : c)).join("")}` },
      { name: "Path with semicolon", url: `${origin}${path};` },
      { name: "Path with fragment", url: `${origin}${path}#` },
    ]

    for (const t of techniques) {
      const res = await sender.send({ method: t.method ?? "GET", url: t.url, headers: t.headers ?? {} })
      if (failed(res)) continue

      const bypassed = res.status !== blockedStatus && res.status >= 200 && res.status < 400
      if (bypassed) bypasses.push({ technique: t.name, status: res.status, note: `Baseline ${blockedStatus} → bypass ${res.status}` })
    }

    const hit = bypasses.length > 0
    return {
      check: "middleware_bypass",
      hit,
      severity: hit ? "high" : "info",
      detail: hit
        ? `Traefik middleware bypass on ${path} (baseline ${blockedStatus}): ${bypasses.map((b) => `${b.technique}→${b.status}`).join(", ")}`
        : `no middleware bypass on ${path} (baseline ${blockedStatus}, ${techniques.length} techniques)`,
      evidence: bypasses.map((b) => b.note).join("; ") || undefined,
    }
  }

  export async function apiExposure(sender: HttpSender, origin: string): Promise<Check> {
    const apiBase = withPort(origin, 8080)

    const endpoints = [
      { path: "/api/rawdata", desc: "Full routing table with all backends" },
      { path: "/api/http/routers", desc: "HTTP router rules" },
      { path: "/api/http/services", desc: "Backend service addresses" },
      { path: "/api/http/middlewares", desc: "Middleware chain configuration" },
      { path: "/api/tcp/routers", desc: "TCP router rules" },
      { path: "/api/tcp/services", desc: "TCP backend services" },
      { path: "/api/udp/routers", desc: "UDP router rules" },
      { path: "/api/udp/services", desc: "UDP backend services" },
      { path: "/api/entrypoints", desc: "Listening entrypoints and ports" },
      { path: "/api/version", desc: "Traefik version information" },
      { path: "/debug/vars", desc: "Go runtime debug variables" },
      { path: "/debug/pprof/", desc: "Go profiling endpoint" },
    ]

    const results: { url: string; description: string; status: number; exposed: boolean; backends?: string[]; version?: string }[] = []

    for (const ep of endpoints)
      for (const b of [origin, apiBase]) {
        const res = await get(sender, `${b}${ep.path}`)
        if (failed(res)) continue

        if (res.status === 200 && res.body.length > 2) {
          const entry: (typeof results)[number] = { url: `${b}${ep.path}`, description: ep.desc, status: res.status, exposed: true }

          // Extract backend service URLs from rawdata or services endpoints
          if (ep.path.includes("services") || ep.path.includes("rawdata")) {
            const urlMatches = res.body.match(/https?:\/\/[\d.:]+/g)
            if (urlMatches) entry.backends = [...new Set(urlMatches)].slice(0, 20)
          }

          if (ep.path.includes("version")) {
            try {
              const ver = JSON.parse(res.body) as { Version?: string; version?: string }
              entry.version = ver.Version ?? ver.version
            } catch {}
          }

          results.push(entry)
          break // Found on this base, skip alternate
        }
      }

    const exposedBackends = results.flatMap((r) => r.backends ?? [])
    const discovered = [...new Set(exposedBackends)]
    const hit = results.length > 0

    return {
      check: "api_exposure",
      hit,
      severity: exposedBackends.length > 0 ? "critical" : hit ? "high" : "info",
      detail: exposedBackends.length > 0
        ? `Traefik API exposed — ${exposedBackends.length} internal backend addresses leaked: ${discovered.join(", ")}`
        : hit
          ? `Traefik API configuration exposed: ${results.map((r) => r.url).join(", ")}`
          : "no exposed API endpoints found",
      evidence: results.map((r) => r.url).join("; ") || undefined,
    }
  }

  export async function entrypointDetect(sender: HttpSender, origin: string): Promise<Check> {
    const h = host(origin)
    const ports = [80, 443, 8080, 8443, 8888]

    const entrypoints: { port: number; protocol: string; tls: boolean; redirectsTo?: string; serverHeader?: string; responseStatus: number }[] = []

    for (const port of ports) {
      // Try HTTPS first
      const httpsRes = await get(sender, `https://${h}:${port}/`)
      if (ok(httpsRes)) {
        entrypoints.push({
          port,
          protocol: "https",
          tls: true,
          redirectsTo: httpsRes.status >= 300 && httpsRes.status < 400 ? header(httpsRes, "location") || undefined : undefined,
          serverHeader: header(httpsRes, "server") || undefined,
          responseStatus: httpsRes.status,
        })
        continue
      }

      // Fallback to HTTP
      const httpRes = await get(sender, `http://${h}:${port}/`)
      if (ok(httpRes)) {
        const location = header(httpRes, "location")
        const redirectsToHttps = location.startsWith("https://")

        entrypoints.push({
          port,
          protocol: "http",
          tls: false,
          redirectsTo: httpRes.status >= 300 && httpRes.status < 400 ? location : undefined,
          serverHeader: header(httpRes, "server") || undefined,
          responseStatus: httpRes.status,
        })

        if (redirectsToHttps) entrypoints[entrypoints.length - 1].tls = false
      }
    }

    const traefikPorts = entrypoints.filter((e) => /traefik/i.test(e.serverHeader ?? ""))
    const hit = traefikPorts.length > 0

    return {
      check: "entrypoint_detect",
      hit,
      severity: "info",
      detail: hit
        ? `Traefik confirmed on ports ${traefikPorts.map((e) => e.port).join(", ")} (${entrypoints.length}/${ports.length} responding)`
        : `no Traefik-identified entrypoints (${entrypoints.length}/${ports.length} ports responding)`,
      evidence: entrypoints.map((e) => `${e.port}/${e.protocol}[${e.responseStatus}]${e.serverHeader ? ` ${e.serverHeader}` : ""}`).join("; ") || undefined,
    }
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

const DESCRIPTION = `Traefik deterministic checks (header/bare-404 detection, dashboard + API exposure on :8080, middleware bypass via path/header manipulation, REST API config/backend leak, entrypoint/port + TLS detection). 1:1 port of the infra-security traefik provider.

Run after Vortex fingerprints Traefik. Probes go through the scope-guarded replay engine; alt port :8080 is probed for dashboard/api. check="all" (default) runs every check.`

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
