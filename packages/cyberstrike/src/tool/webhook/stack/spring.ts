// spring stack checks — ported from infra-security-mcp `providers/spring`.
import z from "zod"
import { defineWebhookTool } from "../define"
import type { HttpSender } from "../transport"
import { get, header, failed, ok, base, summarize, type Check } from "./shared"

export namespace Spring {
  export async function detect(sender: HttpSender, origin: string): Promise<Check> {
    const res = await get(sender, `${origin}/__404_${Date.now()}`)
    if (failed(res)) return { check: "detect", hit: false, severity: "info", detail: "no response" }
    const spring =
      header(res, "x-application-context") !== "" ||
      /Whitelabel Error Page|org\.springframework/i.test(res.body) ||
      /"timestamp".*"status".*"error".*"path"/s.test(res.body)
    if (!spring) return { check: "detect", hit: false, severity: "info", detail: "Spring not detected" }
    return { check: "detect", hit: true, severity: "info", detail: "Spring / Spring Boot detected", evidence: header(res, "x-application-context") || "Whitelabel/JSON error shape" }
  }

  export async function actuatorScan(sender: HttpSender, origin: string): Promise<Check> {
    const critical = ["/actuator/env", "/actuator/heapdump", "/actuator/threaddump", "/actuator/configprops", "/env", "/heapdump", "/trace", "/jolokia"]
    const normal = ["/actuator", "/actuator/health", "/actuator/beans", "/actuator/mappings", "/actuator/metrics", "/actuator/loggers"]
    for (const p of [...critical, ...normal]) {
      const res = await get(sender, `${origin}${p}`)
      if (failed(res)) continue
      if (res.status >= 200 && res.status < 400 && !/Whitelabel/i.test(res.body) && /[{[]/.test(res.body.slice(0, 50))) {
        const crit = critical.includes(p)
        return { check: "actuator_scan", hit: true, severity: crit ? "critical" : "high", detail: `Spring actuator exposed at ${p}`, evidence: res.body.slice(0, 200) }
      }
    }
    return { check: "actuator_scan", hit: false, severity: "info", detail: "no exposed actuator endpoints" }
  }

  export async function spelInjection(sender: HttpSender, origin: string): Promise<Check> {
    const params = ["input", "search", "query", "name", "q", "id"]
    for (const param of params) {
      const res = await get(sender, `${origin}/?${param}=${encodeURIComponent("${7*7}")}`)
      if (failed(res)) continue
      if (res.body.includes("49") && !res.body.includes("${7*7}"))
        return { check: "spel_injection", hit: true, severity: "critical", detail: `SpEL expression evaluated in '${param}' (49 reflected)`, evidence: "${7*7} → 49" }
      if (/java\.lang\.Runtime|EvaluationException/i.test(res.body))
        return { check: "spel_injection", hit: true, severity: "high", detail: `SpEL evaluation error leaked via '${param}'`, evidence: res.body.slice(0, 150) }
    }
    return { check: "spel_injection", hit: false, severity: "info", detail: "no SpEL injection observed" }
  }

  export async function bootMisconfig(sender: HttpSender, origin: string): Promise<Check> {
    const probes: [string, string, "high" | "critical"][] = [
      ["/h2-console", "H2 Console", "critical"],
      ["/swagger-ui.html", "Swagger UI", "high"],
      ["/v3/api-docs", '"openapi"', "high"],
      ["/jolokia", '"agent"', "critical"],
      ["/.~~spring-boot!~", "spring-boot", "high"],
    ]
    for (const [p, sig, sev] of probes) {
      const res = await get(sender, `${origin}${p}`)
      if (ok(res) && res.status === 200 && res.body.includes(sig))
        return { check: "boot_misconfig", hit: true, severity: sev, detail: `Spring Boot exposure at ${p}`, evidence: res.body.slice(0, 150) }
    }
    return { check: "boot_misconfig", hit: false, severity: "info", detail: "no H2/Swagger/Jolokia/DevTools exposure" }
  }

  export async function cloudGateway(sender: HttpSender, origin: string): Promise<Check> {
    const routes = await get(sender, `${origin}/actuator/gateway/routes`)
    if (ok(routes) && routes.status === 200 && /("route_id"|"predicate"|"filters")/i.test(routes.body))
      return { check: "cloud_gateway", hit: true, severity: "critical", detail: "Spring Cloud Gateway actuator exposed — CVE-2022-22947 route-injection RCE surface", evidence: routes.body.slice(0, 200) }
    return { check: "cloud_gateway", hit: false, severity: "info", detail: "Spring Cloud Gateway actuator not exposed" }
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

const DESCRIPTION = `Spring / Spring Boot checks (detection, actuator exposure incl. env/heapdump, SpEL injection, H2/Swagger/Jolokia/DevTools misconfig, Spring Cloud Gateway CVE-2022-22947).

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
