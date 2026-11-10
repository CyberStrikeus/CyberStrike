// akamai stack checks — ported 1:1 from infra-security-mcp `providers/akamai`.
// Every Pragma directive, cache-poison header, edge-hostname pattern and WAF
// technique matches the source exactly; only the transport (scope-guarded webhook
// sender) and the Check/severity adapter are CyberStrike's.
import z from "zod"
import { defineWebhookTool } from "../define"
import type { HttpSender } from "../transport"
import { get, header, failed, ok, base, summarize, type Check } from "./shared"

export namespace Akamai {
  export async function detect(sender: HttpSender, origin: string): Promise<Check> {
    const res = await get(sender, origin)
    if (failed(res)) return { check: "detect", hit: false, severity: "info", detail: "no response" }

    const hv = (n: string): string | boolean => header(res, n) || false
    const signals: Record<string, boolean | string> = {}
    signals["x-akamai-transformed"] = hv("x-akamai-transformed")
    signals["akamai-origin-hop"] = hv("akamai-origin-hop")
    signals["x-akamai-session-info"] = hv("x-akamai-session-info")
    signals["x-akamai-request-id"] = hv("x-akamai-request-id")
    const server = header(res, "server")
    signals["server_akamai_ghost"] = server.toLowerCase().includes("akamaighost")
    const xCache = header(res, "x-cache")
    signals["x_cache_akamai"] = xCache.toLowerCase().includes("akamai")
    const via = header(res, "via")
    signals["via_akamai"] = via.toLowerCase().includes("akamai")
    signals["x-true-cache-key"] = hv("x-true-cache-key")

    const positives = Object.values(signals).filter((v) => v !== false).length
    const confidence = positives >= 3 ? "high" : positives >= 1 ? "medium" : "none"
    if (positives < 1) return { check: "detect", hit: false, severity: "info", detail: "Akamai not detected" }
    return {
      check: "detect",
      hit: true,
      severity: "info",
      detail: `served by Akamai (confidence ${confidence})`,
      evidence: server || via,
    }
  }

  export async function debugHeaders(sender: HttpSender, origin: string): Promise<Check> {
    const pragmaValues = [
      "akamai-x-cache-on",
      "akamai-x-cache-remote-on",
      "akamai-x-check-cacheable",
      "akamai-x-get-cache-key",
      "akamai-x-get-extracted-values",
      "akamai-x-get-request-id",
      "akamai-x-get-true-cache-key",
      "akamai-x-serial-no",
      "akamai-x-get-client-ip",
    ]
    const pragmaHeader = pragmaValues.join(", ")

    const normalRes = await get(sender, origin)
    const debugRes = await get(sender, origin, { Pragma: pragmaHeader })
    if (failed(debugRes)) return { check: "debug_headers", hit: false, severity: "info", detail: "no response" }

    const normalHeaders = ok(normalRes) ? normalRes.headers : {}
    const debugInfo: Record<string, string> = {}
    const leakedHeaders: string[] = []
    for (const key of Object.keys(debugRes.headers)) {
      const lower = key.toLowerCase()
      if (
        lower.startsWith("x-cache") ||
        lower.startsWith("x-akamai") ||
        lower.startsWith("x-true") ||
        lower.startsWith("x-check") ||
        lower.includes("serial") ||
        lower.includes("request-id")
      ) {
        debugInfo[key] = debugRes.headers[key]
        if (!normalHeaders[key]) leakedHeaders.push(key)
      }
    }

    if (leakedHeaders.length === 0)
      return { check: "debug_headers", hit: false, severity: "info", detail: "Debug headers not enabled or not leaking additional information" }
    return {
      check: "debug_headers",
      hit: true,
      severity: "low",
      detail: `Akamai debug headers enabled — exposes cache keys, internal IPs, and request routing info: ${leakedHeaders.join(", ")}`,
      evidence: leakedHeaders.map((h) => `${h}=${debugInfo[h]}`).join(" "),
    }
  }

  export async function cachePoison(sender: HttpSender, origin: string): Promise<Check> {
    const url = origin
    const testVectors: [string, string, string][] = [
      ["X-Forwarded-Host", "evil.example.com", "forwarded_host"],
      ["X-Forwarded-Scheme", "nothttps", "forwarded_scheme"],
      ["X-Original-URL", "/admin", "original_url"],
      ["X-Rewrite-URL", "/admin", "rewrite_url"],
      ["X-Forwarded-Port", "1337", "forwarded_port"],
      ["X-Forwarded-For", "127.0.0.1", "forwarded_for_localhost"],
      ["X-Host", "evil.example.com", "x_host"],
      ["X-Forwarded-Server", "evil.example.com", "forwarded_server"],
    ]

    const baseline = await get(sender, url)
    const baseStatus = ok(baseline) ? baseline.status : 0

    const poisonTests: { technique: string; reflected: boolean; status: number; detail: string }[] = []
    for (const [hdr, value, technique] of testVectors) {
      const res = await get(sender, url, { [hdr]: value })
      if (failed(res)) continue

      const reflected =
        res.body.includes(value) || res.status !== baseStatus || Object.values(res.headers).some((h) => h.includes(value))
      const locationHeader = header(res, "location")
      const reflectedInRedirect = locationHeader.includes(value)

      poisonTests.push({
        technique,
        reflected: reflected || reflectedInRedirect,
        status: res.status,
        detail: reflectedInRedirect
          ? `Value reflected in Location header: ${locationHeader}`
          : reflected
            ? "Value reflected in response body or caused status change"
            : "No reflection detected",
      })
    }

    const cacheKeyTests = await get(sender, `${url}?cachebuster=${Date.now()}`, { Pragma: "akamai-x-get-cache-key" })
    const cacheKey = ok(cacheKeyTests) ? header(cacheKeyTests, "x-cache-key") || header(cacheKeyTests, "x-true-cache-key") : ""

    const vulnerable = poisonTests.filter((t) => t.reflected)
    if (vulnerable.length === 0)
      return { check: "cache_poison", hit: false, severity: "info", detail: "No cache poisoning vectors detected with tested headers" }
    return {
      check: "cache_poison",
      hit: true,
      severity: "high",
      detail: `Cache poisoning vectors detected — injected headers reflected in responses: ${vulnerable.map((t) => t.technique).join(", ")}`,
      evidence: `cache_key=${cacheKey || "not exposed"} ${vulnerable.map((t) => `${t.technique}[${t.status}]`).join(" ")}`,
    }
  }

  export async function edgeConfig(sender: HttpSender, origin: string): Promise<Check> {
    const domain = new URL(origin).hostname

    const findings: { check: string; url: string; status: number; exposed: boolean }[] = []

    const stagingPatterns = [
      `${domain}.edgesuite-staging.net`,
      `${domain}.edgekey-staging.net`,
      `${domain}-staging.edgesuite.net`,
    ]
    for (const staging of stagingPatterns) {
      const stagingUrl = `https://${staging}`
      const res = await get(sender, stagingUrl)
      findings.push({ check: "staging_hostname", url: stagingUrl, status: ok(res) ? res.status : 0, exposed: ok(res) && res.status > 0 })
    }

    const edgeHostnames = [
      `${domain}.edgesuite.net`,
      `${domain}.edgekey.net`,
      `${domain}.akamaiedge.net`,
    ]
    for (const edgeHost of edgeHostnames) {
      const edgeUrl = `https://${edgeHost}`
      const res = await get(sender, edgeUrl)
      findings.push({ check: "edge_hostname", url: edgeUrl, status: ok(res) ? res.status : 0, exposed: ok(res) && res.status > 0 })
    }

    const sureRouteUrl = `${origin}/akamai/sureroute-test-object.html`
    const srRes = await get(sender, sureRouteUrl)
    findings.push({ check: "sureroute_test_object", url: sureRouteUrl, status: ok(srRes) ? srRes.status : 0, exposed: ok(srRes) && srRes.status === 200 })

    const exposed = findings.filter((f) => f.exposed)
    if (exposed.length === 0)
      return { check: "edge_config", hit: false, severity: "info", detail: "No exposed Akamai configuration endpoints found" }
    return {
      check: "edge_config",
      hit: true,
      severity: "low",
      detail: `Exposed Akamai configuration endpoints found — may reveal infrastructure details: ${exposed.map((f) => f.check).join(", ")}`,
      evidence: exposed.map((f) => `${f.url}[${f.status}]`).join(" "),
    }
  }

  export async function wafBypass(sender: HttpSender, origin: string): Promise<Check> {
    const url = origin
    const testPayload = "<script>alert(1)</script>"

    const results: { technique: string; blocked: boolean; status: number; reference: string }[] = []

    // Baseline
    const baseline = await get(sender, `${url}?q=${encodeURIComponent(testPayload)}`)
    const baseRef = ok(baseline) ? header(baseline, "reference") : ""
    const isKonaBlock =
      ok(baseline) && (baseline.status === 403 || baseline.body.includes("Access Denied") || baseline.body.includes("akamai"))
    results.push({
      technique: "baseline",
      blocked: isKonaBlock,
      status: ok(baseline) ? baseline.status : 0,
      reference: baseRef,
    })

    // HPP: duplicate parameter
    const hpp = await get(sender, `${url}?q=safe&q=${encodeURIComponent(testPayload)}`)
    results.push({
      technique: "http_parameter_pollution",
      blocked: ok(hpp) && hpp.status === 403,
      status: ok(hpp) ? hpp.status : 0,
      reference: ok(hpp) ? header(hpp, "reference") : "",
    })

    // JSON content type with nested payload
    const jsonNested = await sender.send({
      method: "POST",
      url,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ search: { nested: { value: testPayload } } }),
    })
    results.push({
      technique: "json_nested_object",
      blocked: ok(jsonNested) && jsonNested.status === 403,
      status: ok(jsonNested) ? jsonNested.status : 0,
      reference: ok(jsonNested) ? header(jsonNested, "reference") : "",
    })

    // Path normalization
    const pathTests = [
      { path: `/;${encodeURIComponent(testPayload)}`, name: "semicolon_injection" },
      { path: `/%2e%2e/%2e%2e/?q=${encodeURIComponent(testPayload)}`, name: "encoded_path_traversal" },
      { path: `/?q[]=${encodeURIComponent(testPayload)}`, name: "array_parameter" },
    ]
    for (const t of pathTests) {
      const res = await get(sender, `${url}${t.path}`)
      results.push({
        technique: t.name,
        blocked: ok(res) && res.status === 403,
        status: ok(res) ? res.status : 0,
        reference: ok(res) ? header(res, "reference") : "",
      })
    }

    // Chunked transfer encoding
    const chunked = await sender.send({
      method: "POST",
      url,
      headers: { "Content-Type": "application/x-www-form-urlencoded", "Transfer-Encoding": "chunked" },
      body: `q=${encodeURIComponent(testPayload)}`,
    })
    results.push({
      technique: "chunked_transfer",
      blocked: ok(chunked) && chunked.status === 403,
      status: ok(chunked) ? chunked.status : 0,
      reference: ok(chunked) ? header(chunked, "reference") : "",
    })

    const bypassed = results.filter((r) => r.technique !== "baseline" && isKonaBlock && !r.blocked)
    if (!isKonaBlock)
      return { check: "waf_bypass", hit: false, severity: "info", detail: "Kona WAF did not block the baseline payload" }
    if (bypassed.length === 0)
      return { check: "waf_bypass", hit: false, severity: "info", detail: "Kona WAF active and blocked all tested techniques" }
    return {
      check: "waf_bypass",
      hit: true,
      severity: "high",
      detail: `Akamai Kona WAF bypass — ${bypassed.length} technique(s) succeeded: ${bypassed.map((r) => r.technique).join(", ")}`,
      evidence: bypassed.map((r) => `${r.technique}=${r.status}`).join(" "),
    }
  }

  const RUNNERS: Record<string, (s: HttpSender, o: string) => Promise<Check>> = {
    detect,
    debug_headers: debugHeaders,
    cache_poison: cachePoison,
    edge_config: edgeConfig,
    waf_bypass: wafBypass,
  }

  export async function run(sender: HttpSender, origin: string, which: string): Promise<Check[]> {
    const names = which === "all" ? Object.keys(RUNNERS) : [which]
    const out: Check[] = []
    for (const n of names) out.push(await RUNNERS[n](sender, origin))
    return out
  }
}

const DESCRIPTION = `Akamai edge checks (detection via headers, Pragma debug-header exposure, forwarding-header cache poisoning, EdgeSuite/staging/SureRoute config exposure, Kona Site Defender WAF bypass — HPP/JSON-nested/path-normalization/chunked). 1:1 port of the infra-security akamai provider.

Run after Vortex fingerprints Akamai. Probes go through the scope-guarded replay engine (staging/edge-hostname probes are refused for out-of-scope hosts). check="all" (default) runs every check.`

export const AkamaiTestTool = defineWebhookTool({
  name: "akamai_test",
  description: DESCRIPTION,
  parameters: z.object({
    target: z.string().describe("Target origin or URL (e.g. https://target.com)."),
    check: z
      .enum(["all", "detect", "debug_headers", "cache_poison", "edge_config", "waf_bypass"])
      .default("all")
      .describe("Which check to run; 'all' runs every Akamai check."),
  }),
  async run(params, ctx) {
    const origin = base(params.target)
    const results = await Akamai.run(ctx.sender, origin, params.check)
    return { target: origin, results }
  },
  format(r) {
    return summarize("akamai_test", r.target, r.results)
  },
})
