// envoy stack checks — ported 1:1 from infra-security-mcp `providers/envoy`.
// Every path/payload/condition matches the source exactly; only the transport
// (scope-guarded webhook sender) and the Check/severity adapter are CyberStrike's.
import z from "zod"
import { defineWebhookTool } from "../define"
import type { HttpSender, ProbeResponse } from "../transport"
import { get, failed, ok, base, withPort, summarize, type Check } from "./shared"

// The source's extractHeader returns undefined when absent (distinct from an empty
// value). shared's `header()` collapses both to "", so these checks use `val()` to
// preserve the source's `!== undefined` presence tests verbatim.
function val(res: ProbeResponse, name: string): string | undefined {
  const want = name.toLowerCase()
  for (const k in res.headers) if (k.toLowerCase() === want) return res.headers[k]
  return undefined
}

export namespace Envoy {
  export async function detect(sender: HttpSender, origin: string): Promise<Check> {
    const findings: string[] = []
    let confidence = 0

    const res = await get(sender, origin)
    if (failed(res)) return { check: "detect", hit: false, severity: "info", detail: res.error }

    const server = val(res, "server") ?? ""
    if (/envoy/i.test(server)) {
      findings.push(`Server header: ${server}`)
      confidence += 50
    }

    const envoyHeaders = [
      "x-envoy-upstream-service-time",
      "x-envoy-decorator-operation",
      "x-envoy-overloaded",
      "x-envoy-attempt-count",
      "x-envoy-expected-rq-timeout-ms",
      "x-envoy-max-retries",
      "x-envoy-retry-on",
      "x-envoy-retry-grpc-on",
      "x-envoy-rate-limited",
    ]

    for (const h of envoyHeaders) {
      const v = val(res, h)
      if (v !== undefined) {
        findings.push(`${h}: ${v}`)
        confidence += 20
      }
    }

    // Envoy-specific error responses
    const badRes = await get(sender, `${origin}/___envoy_detect_${Date.now()}`)
    if (
      ok(badRes) &&
      (badRes.body.includes("upstream connect error") || badRes.body.includes("no healthy upstream") || badRes.body.includes("envoy"))
    ) {
      findings.push("Envoy-style error response detected")
      confidence += 25
    }

    // Check for Envoy-style 503 with specific body
    if (ok(badRes) && badRes.status === 503 && badRes.body.trim() === "no healthy upstream") {
      findings.push("Envoy default 503: 'no healthy upstream'")
      confidence += 30
    }

    confidence = Math.min(confidence, 100)
    const hit = confidence >= 25
    return {
      check: "detect",
      hit,
      severity: "info",
      detail: `${hit ? "Envoy detected" : "Envoy not detected"} (confidence ${confidence})`,
      evidence: findings.join("; ") || undefined,
    }
  }

  export async function adminExposure(sender: HttpSender, origin: string): Promise<Check> {
    const adminBase = withPort(origin, 9901)

    const endpoints = [
      { path: "/", desc: "Admin index page" },
      { path: "/server_info", desc: "Envoy version, uptime, build info" },
      { path: "/stats", desc: "Runtime statistics (request counts, latency)" },
      { path: "/stats/prometheus", desc: "Prometheus-format metrics" },
      { path: "/clusters", desc: "Backend cluster membership and health" },
      { path: "/config_dump", desc: "Full Envoy configuration dump" },
      { path: "/listeners", desc: "Configured listener addresses" },
      { path: "/certs", desc: "TLS certificate details" },
      { path: "/runtime", desc: "Runtime feature flag overrides" },
      { path: "/memory", desc: "Memory allocation statistics" },
      { path: "/logging", desc: "Log levels (may allow modification)" },
      { path: "/drain_listeners", desc: "Drain endpoint (write access)" },
      { path: "/healthcheck/fail", desc: "Force healthcheck fail (write access)" },
      { path: "/ready", desc: "Readiness status" },
    ]

    const exposed: { url: string; description: string; status: number; writable: boolean; sample?: string; version?: string }[] = []

    for (const b of [adminBase, origin]) {
      for (const ep of endpoints) {
        const res = await get(sender, `${b}${ep.path}`)
        if (failed(res)) continue

        if (res.status === 200 && res.body.length > 0) {
          const isEnvoyAdmin =
            res.body.includes("envoy") ||
            res.body.includes("server.version") ||
            res.body.includes("cluster_name") ||
            res.body.includes("listener_manager") ||
            res.body.includes("hot_restart_version") ||
            (ep.path === "/" && res.body.includes("/stats") && res.body.includes("/clusters"))

          if (isEnvoyAdmin) {
            const entry: (typeof exposed)[number] = {
              url: `${b}${ep.path}`,
              description: ep.desc,
              status: res.status,
              writable: ["/logging", "/drain_listeners", "/healthcheck/fail"].some((p) => ep.path.startsWith(p)),
            }

            if (ep.path === "/server_info") {
              try {
                const info = JSON.parse(res.body) as { version?: string }
                entry.version = info.version
              } catch {
                const vMatch = res.body.match(/"version":\s*"([^"]+)"/)
                if (vMatch) entry.version = vMatch[1]
              }
            }

            if (ep.path === "/config_dump") entry.sample = res.body.slice(0, 1000)
            else entry.sample = res.body.slice(0, 300)

            exposed.push(entry)
          }
        }
      }

      if (exposed.length > 0) break
    }

    const hasConfigDump = exposed.some((e) => e.url.includes("/config_dump"))
    const hasWritable = exposed.some((e) => e.writable)
    const hit = exposed.length > 0

    return {
      check: "admin_exposure",
      hit,
      severity: hasWritable ? "critical" : hasConfigDump ? "critical" : hit ? "high" : "info",
      detail: hasWritable
        ? `Envoy admin interface with WRITE access — can drain listeners, change log levels, force healthcheck failures (${exposed.map((e) => e.url).join(", ")})`
        : hasConfigDump
          ? `Envoy full config dump exposed — reveals all secrets, backend addresses, TLS keys (${exposed.map((e) => e.url).join(", ")})`
          : hit
            ? `Envoy partial admin exposure — reveals internal service topology (${exposed.map((e) => e.url).join(", ")})`
            : "no admin endpoints found",
      evidence: `${exposed.map((e) => `${e.url}${e.writable ? " [write]" : ""}`).join("; ")}${exposed.find((e) => e.version)?.version ? ` version=${exposed.find((e) => e.version)?.version}` : ""}` || undefined,
    }
  }

  export async function filterBypass(sender: HttpSender, origin: string): Promise<Check> {
    const path = "/admin"
    const bypasses: { technique: string; status: number; note: string }[] = []

    const baseline = await get(sender, `${origin}${path}`)
    const blockedStatus = ok(baseline) ? baseline.status : 0

    const techniques: { name: string; url: string; method?: string; headers?: Record<string, string> }[] = [
      // Path normalization bypasses
      { name: "URL-encoded slash", url: `${origin}${path.replace(/\//g, "%2f")}` },
      { name: "Double encoding", url: `${origin}${path.replace(/\//g, "%252f")}` },
      { name: "Backslash path", url: `${origin}${path.replace(/\//g, "\\")}` },
      { name: "Path with /./", url: `${origin}${path}/./` },
      { name: "Path with /../ normalization", url: `${origin}/x/../${path.slice(1)}` },
      { name: "Trailing null byte", url: `${origin}${path}%00` },
      { name: "Trailing newline", url: `${origin}${path}%0a` },
      { name: "Tab in path", url: `${origin}${path}%09` },
      { name: "Fragment (#) in path", url: `${origin}${path}%23` },
      { name: "Semicolon path param", url: `${origin}${path};foo=bar` },

      // Header-based bypasses
      { name: "x-envoy-original-path override", url: `${origin}/`, headers: { "x-envoy-original-path": path } },
      { name: ":path pseudo-header via X-Original-URL", url: `${origin}/`, headers: { "X-Original-URL": path } },
      { name: "Internal request header", url: `${origin}${path}`, headers: { "x-envoy-internal": "true" } },

      // HTTP method tricks
      { name: "CONNECT method", url: `${origin}${path}`, method: "CONNECT" },
      { name: "TRACE method", url: `${origin}${path}`, method: "TRACE" },
    ]

    for (const t of techniques) {
      const res = await sender.send({ method: t.method ?? "GET", url: t.url, headers: t.headers ?? {} })
      if (failed(res)) continue

      const bypassed = res.status !== blockedStatus && res.status >= 200 && res.status < 400
      if (bypassed) bypasses.push({ technique: t.name, status: res.status, note: `Baseline ${blockedStatus} → bypass ${res.status}` })
    }

    const hit = bypasses.length > 0
    return {
      check: "filter_bypass",
      hit,
      severity: hit ? "high" : "info",
      detail: hit
        ? `Envoy filter bypass on ${path} (baseline ${blockedStatus}): ${bypasses.map((b) => `${b.technique}→${b.status}`).join(", ")}`
        : `no filter bypass on ${path} (baseline ${blockedStatus}, ${techniques.length} techniques)`,
      evidence: bypasses.map((b) => b.note).join("; ") || undefined,
    }
  }

  export async function extAuthzBypass(sender: HttpSender, origin: string): Promise<Check> {
    const path = "/admin"
    const bypasses: { technique: string; status: number; cve?: string; note: string }[] = []

    const baseline = await get(sender, `${origin}${path}`)
    const blockedStatus = ok(baseline) ? baseline.status : 0

    // CVE-2019-18801: path with fragment sent to ext_authz but stripped by upstream
    const fragRes = await get(sender, `${origin}${path}#fragment`)
    if (ok(fragRes) && fragRes.status !== blockedStatus && fragRes.status >= 200 && fragRes.status < 400) {
      bypasses.push({
        technique: "Fragment bypass (CVE-2019-18801 pattern)",
        status: fragRes.status,
        cve: "CVE-2019-18801",
        note: "ext_authz sees path#fragment, upstream sees path — auth check on wrong path",
      })
    }

    // ext_authz may not check the path for certain Content-Types (gRPC ext_authz)
    const grpcRes = await sender.send({ method: "POST", url: `${origin}${path}`, headers: { "Content-Type": "application/grpc" } })
    if (ok(grpcRes) && grpcRes.status !== blockedStatus && grpcRes.status >= 200 && grpcRes.status < 400) {
      bypasses.push({ technique: "gRPC content-type bypass", status: grpcRes.status, note: "ext_authz may skip check for gRPC content type" })
    }

    // Header case sensitivity: ext_authz may check "Authorization" but not "authorization"
    const headerCases = [
      { name: "lowercase authorization", header: "authorization" },
      { name: "mixed case Authorization", header: "AuThOrIzAtIoN" },
      { name: "X-Forwarded-User injection", header: "X-Forwarded-User" },
    ]

    for (const hc of headerCases) {
      const res = await sender.send({ method: "GET", url: `${origin}${path}`, headers: { [hc.header]: "admin" } })
      if (ok(res) && res.status !== blockedStatus && res.status >= 200 && res.status < 400) {
        bypasses.push({ technique: `Header case bypass: ${hc.name}`, status: res.status, note: `${hc.header} header accepted — ext_authz may check different case` })
      }
    }

    // Large body that ext_authz may truncate or skip
    const largeBody = "x".repeat(65536)
    const largeRes = await sender.send({ method: "POST", url: `${origin}${path}`, headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: largeBody })
    if (ok(largeRes) && largeRes.status !== blockedStatus && largeRes.status >= 200 && largeRes.status < 400) {
      bypasses.push({ technique: "Large body bypass", status: largeRes.status, note: "ext_authz may skip or truncate body check for large requests (max_request_bytes)" })
    }

    // Query parameter bypass: ext_authz checks path but not path+query
    const queryRes = await get(sender, `${origin}${path}?__bypass=1`)
    if (
      ok(queryRes) &&
      queryRes.status !== blockedStatus &&
      queryRes.status >= 200 &&
      queryRes.status < 400 &&
      queryRes.status !== (ok(fragRes) ? fragRes.status : -1)
    ) {
      bypasses.push({ technique: "Query parameter path difference", status: queryRes.status, note: "ext_authz may match path without query but upstream routes with query" })
    }

    const hit = bypasses.length > 0
    return {
      check: "ext_authz_bypass",
      hit,
      severity: bypasses.some((b) => b.cve) ? "critical" : hit ? "high" : "info",
      detail: hit
        ? `Envoy ext_authz bypass on ${path} (baseline ${blockedStatus}): ${bypasses.map((b) => `${b.technique}→${b.status}`).join(", ")}. related CVEs: CVE-2019-18801, CVE-2021-21378, CVE-2021-29492`
        : `no ext_authz bypass on ${path} (baseline ${blockedStatus}). related CVEs: CVE-2019-18801, CVE-2021-21378, CVE-2021-29492`,
      evidence: bypasses.map((b) => `${b.note}${b.cve ? ` [${b.cve}]` : ""}`).join("; ") || undefined,
    }
  }

  export async function infoLeak(sender: HttpSender, origin: string): Promise<Check> {
    const paths = ["/", "/api", "/api/v1", "/health", "/status", "/login", "/admin"]

    const leaks: { path: string; decorator?: string; upstreamTime?: string; attemptCount?: string; otherHeaders: Record<string, string> }[] = []

    const envoyHeaderNames = [
      "x-envoy-decorator-operation",
      "x-envoy-upstream-service-time",
      "x-envoy-attempt-count",
      "x-envoy-overloaded",
      "x-envoy-expected-rq-timeout-ms",
      "x-envoy-rate-limited",
      "x-envoy-upstream-healthchecked-cluster",
      "x-envoy-upstream-canary",
      "x-envoy-immediate-health-check-fail",
    ]

    for (const path of paths) {
      const res = await get(sender, `${origin}${path}`)
      if (failed(res)) continue
      const otherHeaders: Record<string, string> = {}
      let hasEnvoyHeaders = false

      const decorator = val(res, "x-envoy-decorator-operation")
      const upstreamTime = val(res, "x-envoy-upstream-service-time")
      const attemptCount = val(res, "x-envoy-attempt-count")

      for (const h of envoyHeaderNames) {
        const v = val(res, h)
        if (v !== undefined && h !== "x-envoy-decorator-operation" && h !== "x-envoy-upstream-service-time" && h !== "x-envoy-attempt-count") {
          otherHeaders[h] = v
          hasEnvoyHeaders = true
        }
      }

      if (decorator || upstreamTime || attemptCount || hasEnvoyHeaders) {
        leaks.push({ path, decorator: decorator ?? undefined, upstreamTime: upstreamTime ?? undefined, attemptCount: attemptCount ?? undefined, otherHeaders })
      }
    }

    // Extract unique decorator operations (route/service names)
    const routeNames = [...new Set(leaks.filter((l) => l.decorator).map((l) => l.decorator!))]

    // Analyze timing to map backend performance
    const timings = leaks
      .filter((l) => l.upstreamTime)
      .map((l) => ({ path: l.path, latencyMs: parseInt(l.upstreamTime!, 10) }))
      .sort((a, b) => b.latencyMs - a.latencyMs)

    const hit = leaks.length > 0
    return {
      check: "info_leak",
      hit,
      severity: routeNames.length > 0 ? "medium" : hit ? "low" : "info",
      detail: routeNames.length > 0
        ? `Envoy leaked ${routeNames.length} internal route/service names via x-envoy-decorator-operation: ${routeNames.join(", ")}`
        : hit
          ? "Envoy headers present — confirms proxy type and reveals backend timing"
          : "no Envoy-specific headers found",
      evidence: `${leaks.map((l) => `${l.path}${l.decorator ? ` op=${l.decorator}` : ""}${l.upstreamTime ? ` t=${l.upstreamTime}ms` : ""}`).join("; ")}` || undefined,
    }
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

const DESCRIPTION = `Envoy deterministic checks (header/error-page detection, admin interface exposure on :9901, filter-chain bypass via path/header/method, ext_authz bypass incl. CVE-2019-18801 fragment pattern, x-envoy-* backend info leak). 1:1 port of the infra-security envoy provider.

Run after Vortex fingerprints Envoy. Probes go through the scope-guarded replay engine; admin interface is probed on :9901. check="all" (default) runs every check.`

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
