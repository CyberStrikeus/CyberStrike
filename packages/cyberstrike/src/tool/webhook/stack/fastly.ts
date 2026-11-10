// fastly stack checks — ported 1:1 from infra-security-mcp `providers/fastly`.
// Every cache-poison vector, origin-bypass header, VCL-error trigger and shield
// probe matches the source exactly; only the transport (scope-guarded webhook
// sender) and the Check/severity adapter are CyberStrike's.
import z from "zod"
import { defineWebhookTool } from "../define"
import type { HttpSender } from "../transport"
import { get, header, failed, ok, base, summarize, type Check } from "./shared"

export namespace Fastly {
  export async function detect(sender: HttpSender, origin: string): Promise<Check> {
    const res = await get(sender, origin)
    if (failed(res)) return { check: "detect", hit: false, severity: "info", detail: "no response" }

    const hv = (n: string): string | boolean => header(res, n) || false
    const signals: Record<string, string | boolean> = {}
    const xServedBy = header(res, "x-served-by")
    signals["x_served_by"] = xServedBy || false
    signals["x_served_by_cache_prefix"] = xServedBy.startsWith("cache-")
    const xCache = header(res, "x-cache")
    signals["x_cache"] = xCache || false
    signals["x_cache_hits"] = hv("x-cache-hits")
    signals["x_timer"] = hv("x-timer")
    signals["fastly_debug_path"] = hv("fastly-debug-path")
    signals["fastly_debug_ttl"] = hv("fastly-debug-ttl")
    signals["fastly_debug_digest"] = hv("fastly-debug-digest")
    const via = header(res, "via")
    signals["via_varnish"] = via.toLowerCase().includes("varnish")
    signals["x_varnish"] = hv("x-varnish")

    const positives = Object.values(signals).filter((v) => v !== false).length
    const isFastly = signals["x_served_by_cache_prefix"] === true || (positives >= 2 && signals["via_varnish"] === true)
    const confidence = positives >= 3 ? "high" : positives >= 1 ? "medium" : "none"
    const popLocation = xServedBy.startsWith("cache-") ? xServedBy.split("-")[1] ?? "unknown" : null
    if (!isFastly) return { check: "detect", hit: false, severity: "info", detail: "Fastly not detected" }
    return {
      check: "detect",
      hit: true,
      severity: "info",
      detail: `Fastly edge in front of origin (confidence ${confidence}${popLocation ? `, POP ${popLocation}` : ""})`,
      evidence: xServedBy || via,
    }
  }

  export async function cachePoison(sender: HttpSender, origin: string): Promise<Check> {
    const url = origin
    const vectors: [string, string, string][] = [
      ["X-Forwarded-Host", "evil-cache-test.example.com", "forwarded_host"],
      ["X-Host", "evil-cache-test.example.com", "x_host"],
      ["X-Forwarded-Scheme", "nothttps", "forwarded_scheme"],
      ["X-Original-URL", "/cache-poison-test", "original_url"],
      ["Forwarded", "host=evil-cache-test.example.com", "rfc7239_forwarded"],
      ["X-Forwarded-Port", "1337", "forwarded_port"],
      ["X-Forwarded-Prefix", "/evil-prefix", "forwarded_prefix"],
    ]

    await get(sender, url) // baseline

    const tests: { technique: string; reflectedBody: boolean; reflectedHeader: boolean; status: number; detail: string }[] = []
    for (const [hdr, value, technique] of vectors) {
      const res = await get(sender, url, { [hdr]: value })
      if (failed(res)) continue

      const inBody = res.body.includes(value) || res.body.includes(value.replace(/\./g, ""))
      const inHeaders = Object.values(res.headers).some((h) => h.includes(value))
      const location = header(res, "location")
      const inRedirect = location.includes(value)

      tests.push({
        technique,
        reflectedBody: inBody,
        reflectedHeader: inHeaders || inRedirect,
        status: res.status,
        detail: inRedirect
          ? `Reflected in redirect Location: ${location}`
          : inBody
            ? "Reflected in response body"
            : inHeaders
              ? "Reflected in response headers"
              : "Not reflected",
      })
    }

    const debugRes = await get(sender, url, { "Fastly-Debug": "1" })
    const cacheDigest = ok(debugRes) ? header(debugRes, "fastly-debug-digest") : ""

    const vulnerable = tests.filter((t) => t.reflectedBody || t.reflectedHeader)
    if (vulnerable.length === 0)
      return { check: "cache_poison", hit: false, severity: "info", detail: "No cache poisoning vectors detected" }
    return {
      check: "cache_poison",
      hit: true,
      severity: "high",
      detail: `Cache poisoning vectors found — reflected values may be cached and served to other users: ${vulnerable.map((t) => t.technique).join(", ")}`,
      evidence: `cache_digest=${cacheDigest || "not exposed"} ${vulnerable.map((t) => `${t.technique}[${t.status}]`).join(" ")}`,
    }
  }

  export async function originBypass(sender: HttpSender, origin: string): Promise<Check> {
    const url = origin

    const results: { technique: string; status: number; viaFastly: boolean; detail: string }[] = []

    // Normal request (baseline)
    const baseline = await get(sender, url)
    const baseStatus = ok(baseline) ? baseline.status : 0
    const baseVia = ok(baseline) ? header(baseline, "via").toLowerCase().includes("varnish") : false
    results.push({ technique: "baseline", status: baseStatus, viaFastly: baseVia, detail: "Normal request through CDN" })

    // Fastly-Debug header
    const debug = await get(sender, url, { "Fastly-Debug": "1" })
    const debugPath = ok(debug) ? header(debug, "fastly-debug-path") : ""
    const debugTtl = ok(debug) ? header(debug, "fastly-debug-ttl") : ""
    results.push({
      technique: "fastly_debug_header",
      status: ok(debug) ? debug.status : 0,
      viaFastly: true,
      detail: debugPath
        ? `Debug path revealed: ${debugPath}`
        : debugTtl
          ? `Debug TTL info: ${debugTtl}`
          : "Debug header sent but no additional debug info returned",
    })

    // Force pass (no-cache)
    const noCache = await get(sender, url, { "Cache-Control": "no-cache, no-store", Pragma: "no-cache" })
    const noCacheServedBy = ok(noCache) ? header(noCache, "x-served-by") : ""
    results.push({
      technique: "cache_bypass_no_cache",
      status: ok(noCache) ? noCache.status : 0,
      viaFastly: noCacheServedBy.startsWith("cache-"),
      detail: "no-cache/no-store headers — forces origin fetch but still through Fastly",
    })

    // Direct IP via Host header manipulation
    const hostManip = await get(sender, url, { "X-Forwarded-For": "127.0.0.1", "Fastly-Client-IP": "127.0.0.1" })
    const hostManipStatus = ok(hostManip) ? hostManip.status : 0
    results.push({
      technique: "client_ip_spoof",
      status: hostManipStatus,
      viaFastly: ok(hostManip) ? header(hostManip, "via").includes("varnish") : false,
      detail: hostManipStatus !== baseStatus
        ? `Status changed from ${baseStatus} to ${hostManipStatus} — IP-based routing may be manipulable`
        : "No status change — IP spoofing likely filtered",
    })

    const indicators = results.filter((r) => r.technique !== "baseline" && !r.viaFastly)
    const debugExposed = !!debugPath || !!debugTtl
    if (indicators.length === 0)
      return { check: "origin_bypass", hit: false, severity: "info", detail: `no origin-bypass indicators${debugExposed ? " (debug info exposed)" : ""}` }
    return {
      check: "origin_bypass",
      hit: true,
      severity: "high",
      detail: `origin-bypass indicators — responses not served via Fastly: ${indicators.map((r) => r.technique).join(", ")}${debugExposed ? " (debug info exposed)" : ""}`,
      evidence: indicators.map((r) => `${r.technique}[${r.status}]`).join(" "),
    }
  }

  export async function vclError(sender: HttpSender, origin: string): Promise<Check> {
    const url = origin
    const errorTriggers: { technique: string; status: number; leaked: string[] }[] = []

    // Trigger 503 via large header
    const largeHeader = "X".repeat(16384)
    const res503 = await get(sender, url, { "X-Custom-Large": largeHeader })
    const body503 = ok(res503) ? res503.body : ""
    const leaked503: string[] = []
    if (body503.includes("Varnish") || body503.includes("vcl_error")) leaked503.push("varnish_error_page")
    if (body503.includes("backend")) leaked503.push("backend_reference")
    if (body503.match(/\d+\.\d+\.\d+\.\d+/)) leaked503.push("ip_address")
    if (body503.includes("XID:")) leaked503.push("request_xid")
    errorTriggers.push({ technique: "oversized_header", status: ok(res503) ? res503.status : 0, leaked: leaked503 })

    // Invalid HTTP method
    const badMethod = await sender.send({ method: "PURGE", url, headers: {} })
    const badStatus = ok(badMethod) ? badMethod.status : 0
    const badBody = ok(badMethod) ? badMethod.body : ""
    const leakedPurge: string[] = []
    if (badStatus === 405 || badStatus === 403) {
      if (badBody.includes("Varnish")) leakedPurge.push("varnish_reference")
      if (badBody.includes("Fastly")) leakedPurge.push("fastly_reference")
      if (badBody.includes("not allowed")) leakedPurge.push("method_filtering_details")
    }
    errorTriggers.push({ technique: "purge_method", status: badStatus, leaked: leakedPurge })

    // Non-existent path for custom 404
    const random404 = await get(sender, `${url}/__fastly_error_test_${Date.now()}`)
    const body404 = ok(random404) ? random404.body : ""
    const leaked404: string[] = []
    if (body404.includes("Varnish")) leaked404.push("varnish_error_page")
    if (body404.includes("backend")) leaked404.push("backend_reference")
    if (body404.match(/cache-[a-z]{3}\d+/)) leaked404.push("pop_identifier")
    errorTriggers.push({ technique: "custom_404", status: ok(random404) ? random404.status : 0, leaked: leaked404 })

    // Trigger timeout-like error via slow path
    const slowPath = await get(sender, `${url}/${"\x00".repeat(10)}`)
    const bodySlow = ok(slowPath) ? slowPath.body : ""
    const leakedSlow: string[] = []
    if (bodySlow.includes("guru meditation") || bodySlow.includes("Guru Meditation")) leakedSlow.push("guru_meditation_error")
    if (bodySlow.includes("XID:")) leakedSlow.push("request_xid")
    errorTriggers.push({ technique: "null_bytes_path", status: ok(slowPath) ? slowPath.status : 0, leaked: leakedSlow })

    const uniqueLeaks = [...new Set(errorTriggers.flatMap((e) => e.leaked))]
    if (uniqueLeaks.length === 0)
      return { check: "vcl_error", hit: false, severity: "info", detail: "Error pages appear clean — no significant information leakage" }
    return {
      check: "vcl_error",
      hit: true,
      severity: "low",
      detail: `Verbose error pages expose internal infrastructure details: ${uniqueLeaks.join(", ")}`,
      evidence: errorTriggers.filter((e) => e.leaked.length > 0).map((e) => `${e.technique}[${e.status}]=${e.leaked.join("+")}`).join(" "),
    }
  }

  export async function shieldDetect(sender: HttpSender, origin: string): Promise<Check> {
    const url = origin
    const responses: { attempt: number; popChain: string[] }[] = []

    for (let i = 0; i < 3; i++) {
      const cacheBuster = `${url}${url.includes("?") ? "&" : "?"}__shield_test=${Date.now()}_${i}`
      const res = await get(sender, cacheBuster)
      const xServedBy = ok(res) ? header(res, "x-served-by") : ""
      const popChain = xServedBy ? xServedBy.split(",").map((s) => s.trim()) : []
      responses.push({ attempt: i + 1, popChain })
    }

    const allPops = new Set(responses.flatMap((r) => r.popChain))
    const hasShield = responses.some((r) => r.popChain.length > 1)
    const shieldPop = hasShield ? responses.find((r) => r.popChain.length > 1)?.popChain.slice(-1)[0] ?? null : null
    const edgePops = new Set(responses.map((r) => r.popChain[0]).filter(Boolean))

    const debugRes = await get(sender, url, { "Fastly-Debug": "1" })
    const debugPath = ok(debugRes) ? header(debugRes, "fastly-debug-path") : ""

    if (!hasShield)
      return { check: "shield_detect", hit: false, severity: "info", detail: `No shielding detected — single POP chain with ${allPops.size} unique node(s)` }
    return {
      check: "shield_detect",
      hit: true,
      severity: "info",
      detail: `Fastly shielding active — shield POP: ${shieldPop}, edge POPs: ${[...edgePops].join(", ")}`,
      evidence: `all_pops=${[...allPops].join(", ")}${debugPath ? ` debug_path=${debugPath}` : ""}`,
    }
  }

  const RUNNERS: Record<string, (s: HttpSender, o: string) => Promise<Check>> = {
    detect,
    cache_poison: cachePoison,
    origin_bypass: originBypass,
    vcl_error: vclError,
    shield_detect: shieldDetect,
  }

  export async function run(sender: HttpSender, origin: string, which: string): Promise<Check[]> {
    const names = which === "all" ? Object.keys(RUNNERS) : [which]
    const out: Check[] = []
    for (const n of names) out.push(await RUNNERS[n](sender, origin))
    return out
  }
}

const DESCRIPTION = `Fastly edge checks (detection via X-Served-By/Varnish, cache poisoning via Host/forwarded headers, origin shield bypass + Fastly-Debug/client-IP spoof, verbose VCL error disclosure, shield POP-chain topology). 1:1 port of the infra-security fastly provider.

Run after Vortex fingerprints Fastly/Varnish. Probes go through the scope-guarded replay engine. check="all" (default) runs every check.`

export const FastlyTestTool = defineWebhookTool({
  name: "fastly_test",
  description: DESCRIPTION,
  parameters: z.object({
    target: z.string().describe("Target origin or URL (e.g. https://target.com)."),
    check: z
      .enum(["all", "detect", "cache_poison", "origin_bypass", "vcl_error", "shield_detect"])
      .default("all")
      .describe("Which check to run; 'all' runs every Fastly check."),
  }),
  async run(params, ctx) {
    const origin = base(params.target)
    const results = await Fastly.run(ctx.sender, origin, params.check)
    return { target: origin, results }
  },
  format(r) {
    return summarize("fastly_test", r.target, r.results)
  },
})
