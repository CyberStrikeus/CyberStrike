// spring stack checks — ported 1:1 from infra-security-mcp `providers/spring`.
// Every path/payload/condition matches the source exactly; only the transport
// (scope-guarded webhook sender) and the Check/severity adapter are CyberStrike's.
import z from "zod"
import { defineWebhookTool } from "../define"
import type { HttpSender } from "../transport"
import { get, header, failed, ok, base, summarize, type Check, type Severity } from "./shared"

const SEV: Severity[] = ["info", "low", "medium", "high", "critical"]
const top = (list: Severity[]): Severity => list.reduce((a, b) => (SEV.indexOf(b) > SEV.indexOf(a) ? b : a), "info" as Severity)

export namespace Spring {
  export async function detect(sender: HttpSender, origin: string): Promise<Check> {
    const findings: string[] = []

    const main = await get(sender, origin)
    const xAppCtx = ok(main) ? header(main, "x-application-context") : ""
    if (xAppCtx) findings.push(`X-Application-Context: ${xAppCtx}`)

    const server = ok(main) ? header(main, "server") : ""
    if (server.toLowerCase().includes("spring")) findings.push(`Server header: ${server}`)

    const bogus = await get(sender, `${origin}/${crypto.randomUUID().slice(0, 8)}`)
    const bogusBody = ok(bogus) ? bogus.body : ""
    if (bogusBody.includes("Whitelabel Error Page")) findings.push("Whitelabel Error Page detected on 404")
    if (bogusBody.includes("org.springframework")) findings.push("Spring stack trace in error page")
    if (bogusBody.includes("timestamp") && bogusBody.includes("status") && bogusBody.includes("error") && bogusBody.includes("path"))
      findings.push("Spring Boot default JSON error body detected")

    const errorPage = await get(sender, origin, { Accept: "application/json" })
    const errorBody = ok(errorPage) ? errorPage.body : ""
    if (errorBody.includes('"timestamp"') && errorBody.includes('"status"'))
      findings.push("Spring Boot JSON error response on Accept: application/json")

    if (findings.length === 0) return { check: "detect", hit: false, severity: "info", detail: "Spring not detected" }
    return { check: "detect", hit: true, severity: "info", detail: findings.join("; "), evidence: findings.join(" | ") }
  }

  export async function actuatorScan(sender: HttpSender, origin: string): Promise<Check> {
    const endpoints = [
      "/actuator",
      "/actuator/env",
      "/actuator/health",
      "/actuator/beans",
      "/actuator/configprops",
      "/actuator/mappings",
      "/actuator/trace",
      "/actuator/httptrace",
      "/actuator/heapdump",
      "/actuator/threaddump",
      "/actuator/loggers",
      "/actuator/metrics",
      "/actuator/info",
      "/actuator/scheduledtasks",
      "/actuator/conditions",
      "/actuator/caches",
      "/env",
      "/health",
      "/dump",
      "/trace",
      "/beans",
      "/mappings",
      "/autoconfig",
      "/configprops",
      "/info",
    ]

    const results: { path: string; status: number; snippet: string }[] = []
    for (const ep of endpoints) {
      const res = await get(sender, `${origin}${ep}`)
      if (failed(res)) continue
      const accessible = res.status >= 200 && res.status < 400 && !res.body.includes("Whitelabel Error Page") && res.body.length > 2
      if (accessible) results.push({ path: ep, status: res.status, snippet: res.body.slice(0, 500) })
    }

    const critical = results.filter((r) => ["/actuator/env", "/actuator/heapdump", "/actuator/configprops", "/env", "/configprops"].includes(r.path))
    if (results.length === 0) return { check: "actuator_scan", hit: false, severity: "info", detail: "no exposed actuator endpoints" }
    return {
      check: "actuator_scan",
      hit: true,
      severity: critical.length > 0 ? "critical" : "high",
      detail: `${results.length} actuator endpoint(s) exposed${critical.length ? `; critical: ${critical.map((c) => c.path).join(", ")}` : ""}`,
      evidence: results.map((r) => `${r.path}[${r.status}]`).join(", "),
    }
  }

  export async function spelInjection(sender: HttpSender, origin: string): Promise<Check> {
    const a = Math.floor(Math.random() * 900) + 100
    const b = Math.floor(Math.random() * 900) + 100
    const expected = String(a * b)

    const payloads = [
      `\${${a}*${b}}`,
      `#{${a}*${b}}`,
      `\${T(java.lang.Runtime).getRuntime()}`,
    ]

    const params = ["input", "search", "query", "name", "value", "data", "id", "redirect", "url", "path"]

    const findings: { parameter: string; payload: string; evidence: string }[] = []
    let evaled = false
    for (const p of params) {
      for (const payload of payloads) {
        const url = new URL(origin)
        url.searchParams.set(p, payload)
        const res = await get(sender, url.toString())
        if (failed(res)) continue
        if (res.body.includes(expected)) {
          findings.push({ parameter: p, payload, evidence: `Arithmetic ${a}*${b}=${expected} resolved in response` })
          evaled = true
        }
        if (res.body.includes("java.lang.Runtime")) {
          findings.push({ parameter: p, payload, evidence: "java.lang.Runtime class reference reflected — possible RCE vector" })
        }
      }
    }

    if (findings.length === 0) return { check: "spel_injection", hit: false, severity: "info", detail: "no SpEL injection signal" }
    return {
      check: "spel_injection",
      hit: true,
      severity: evaled ? "critical" : "high",
      detail: findings.map((f) => `${f.parameter} ${f.payload}: ${f.evidence}`).join("; "),
      evidence: findings[0].evidence,
    }
  }

  export async function bootMisconfig(sender: HttpSender, origin: string): Promise<Check> {
    const checks: { check: string; severity: Severity; details: string }[] = []

    const bogus = await get(sender, `${origin}/${crypto.randomUUID().slice(0, 8)}`)
    const bogusBody = ok(bogus) ? bogus.body : ""
    if (bogusBody.includes("org.springframework") || bogusBody.includes("at java.") || bogusBody.includes("Caused by:"))
      checks.push({ check: "stacktrace_exposure", severity: "medium", details: "Java stack traces visible in error responses" })

    const h2Paths = ["/h2-console", "/h2-console/", "/console", "/h2"]
    for (const p of h2Paths) {
      const res = await get(sender, `${origin}${p}`)
      if (ok(res) && res.status === 200 && (res.body.includes("H2 Console") || res.body.includes("login.jsp"))) {
        checks.push({ check: "h2_console", severity: "critical", details: `H2 Database Console exposed at ${p}` })
        break
      }
    }

    const swaggerPaths = ["/swagger-ui.html", "/swagger-ui/index.html", "/swagger-ui/", "/v3/api-docs", "/v2/api-docs", "/swagger-resources"]
    for (const p of swaggerPaths) {
      const res = await get(sender, `${origin}${p}`)
      if (ok(res) && res.status === 200 && (res.body.includes("swagger") || res.body.includes("openapi"))) {
        checks.push({ check: "swagger_exposed", severity: "low", details: `Swagger/OpenAPI docs at ${p}` })
        break
      }
    }

    const jolokia = await get(sender, `${origin}/jolokia`)
    if (ok(jolokia) && jolokia.status === 200 && jolokia.body.includes("jolokia"))
      checks.push({ check: "jolokia_exposed", severity: "high", details: "Jolokia JMX endpoint exposed — potential RCE" })

    const devtools = await get(sender, `${origin}/.~~spring-boot!~`)
    if (ok(devtools) && devtools.status === 200)
      checks.push({ check: "devtools_restart", severity: "high", details: "Spring Boot DevTools restart trigger endpoint accessible" })

    if (checks.length === 0) return { check: "boot_misconfig", hit: false, severity: "info", detail: "no Spring Boot misconfiguration" }
    return {
      check: "boot_misconfig",
      hit: true,
      severity: top(checks.map((c) => c.severity)),
      detail: checks.map((c) => `${c.check}[${c.severity}]: ${c.details}`).join("; "),
      evidence: checks.map((c) => c.check).join(", "),
    }
  }

  export async function cloudGateway(sender: HttpSender, origin: string): Promise<Check> {
    const findings: { check: string; severity: Severity; details: string }[] = []

    const routePaths = [
      "/actuator/gateway/routes",
      "/actuator/gateway/globalfilters",
      "/actuator/gateway/routefilters",
    ]
    for (const p of routePaths) {
      const res = await get(sender, `${origin}${p}`)
      if (ok(res) && res.status === 200 && res.body.length > 10)
        findings.push({ check: "gateway_routes_exposed", severity: p.includes("routes") ? "high" : "medium", details: `Gateway management at ${p} — ${res.body.slice(0, 300)}` })
    }

    const refresh = await sender.send({ method: "POST", url: `${origin}/actuator/gateway/refresh`, headers: {} })
    if (ok(refresh) && refresh.status === 200)
      findings.push({ check: "gateway_refresh_enabled", severity: "critical", details: "POST /actuator/gateway/refresh succeeds — route injection possible (CVE-2022-22947 pattern)" })

    const globalFilters = await get(sender, `${origin}/actuator/gateway/globalfilters`)
    if (ok(globalFilters) && globalFilters.status === 200 && globalFilters.body.includes("filter"))
      findings.push({ check: "gateway_filters_listed", severity: "medium", details: "Global filters enumerable — reveals internal routing logic" })

    if (findings.length === 0) return { check: "cloud_gateway", hit: false, severity: "info", detail: "no Spring Cloud Gateway route management exposed" }
    return {
      check: "cloud_gateway",
      hit: true,
      severity: top(findings.map((f) => f.severity)),
      detail: findings.map((f) => `${f.check}[${f.severity}]: ${f.details}`).join("; "),
      evidence: findings.map((f) => f.check).join(", "),
    }
  }

  const RUNNERS: Record<string, (s: HttpSender, o: string) => Promise<Check>> = {
    detect,
    actuator_scan: actuatorScan,
    spel_injection: spelInjection,
    boot_misconfig: bootMisconfig,
    cloud_gateway: cloudGateway,
  }

  export async function run(sender: HttpSender, origin: string, which: string): Promise<Check[]> {
    const names = which === "all" ? Object.keys(RUNNERS) : [which]
    const out: Check[] = []
    for (const n of names) out.push(await RUNNERS[n](sender, origin))
    return out
  }
}

const DESCRIPTION = `Spring Framework / Spring Boot deterministic checks (detection via Whitelabel/JSON error signatures, Actuator endpoint exposure incl. env/heapdump/configprops, SpEL injection, Boot misconfig — H2 console/Swagger/Jolokia/DevTools, Cloud Gateway route manipulation CVE-2022-22947). 1:1 port of the infra-security spring provider.

Run after Vortex fingerprints Spring. Probes go through the scope-guarded replay engine. check="all" (default) runs every check.`

export const SpringTestTool = defineWebhookTool({
  name: "spring_test",
  description: DESCRIPTION,
  parameters: z.object({
    target: z.string().describe("Target origin or URL (e.g. https://target.com)."),
    check: z
      .enum(["all", "detect", "actuator_scan", "spel_injection", "boot_misconfig", "cloud_gateway"])
      .default("all")
      .describe("Which check to run; 'all' runs every Spring check."),
  }),
  async run(params, ctx) {
    const origin = base(params.target)
    const results = await Spring.run(ctx.sender, origin, params.check)
    return { target: origin, results }
  },
  format(r) {
    return summarize("spring_test", r.target, r.results)
  },
})
