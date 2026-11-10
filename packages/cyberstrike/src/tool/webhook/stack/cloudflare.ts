// cloudflare stack checks — ported 1:1 from infra-security-mcp `providers/cloudflare` (cf_*).
// Every subdomain label, WAF-bypass technique/payload, path and signature string
// matches the source exactly; only the transport (scope-guarded webhook sender)
// and the Check/severity adapter are CyberStrike's.
import z from "zod"
import { defineWebhookTool } from "../define"
import type { HttpSender } from "../transport"
import { get, header, failed, ok, base, host, summarize, type Check } from "./shared"

const CF_IP_RANGES = [
  "173.245.48.0/20", "103.21.244.0/22", "103.22.200.0/22", "103.31.4.0/22",
  "141.101.64.0/18", "108.162.192.0/18", "190.93.240.0/20", "188.114.96.0/20",
  "197.234.240.0/22", "198.41.128.0/17", "162.158.0.0/15", "104.16.0.0/13",
  "104.24.0.0/14", "172.64.0.0/13", "131.0.72.0/22",
]

export namespace Cloudflare {
  export async function detect(sender: HttpSender, origin: string): Promise<Check> {
    const res = await get(sender, origin)
    if (failed(res)) return { check: "detect", hit: false, severity: "info", detail: "no response" }

    const signals: Record<string, boolean> = {}
    signals["cf-ray_header"] = !!header(res, "cf-ray")
    signals["cf-cache-status_header"] = !!header(res, "cf-cache-status")
    const server = header(res, "server")
    signals["server_cloudflare"] = server.toLowerCase().includes("cloudflare")
    const setCookie = header(res, "set-cookie")
    signals["__cfduid_cookie"] = setCookie.includes("__cfduid")
    signals["__cf_bm_cookie"] = setCookie.includes("__cf_bm")
    signals["cf-connecting-ip_expected"] = !!header(res, "cf-connecting-ip")
    signals["cf-ipcountry_header"] = !!header(res, "cf-ipcountry")
    signals["body_cloudflare_references"] = res.body.includes("cloudflare") || res.body.includes("cf-browser-verification")

    const positiveSignals = Object.values(signals).filter(Boolean).length
    const confidence = positiveSignals >= 3 ? "high" : positiveSignals >= 1 ? "medium" : "none"
    if (positiveSignals < 1) return { check: "detect", hit: false, severity: "info", detail: "Cloudflare not detected" }
    return {
      check: "detect",
      hit: true,
      severity: "info",
      detail: `behind Cloudflare (confidence ${confidence}, ${CF_IP_RANGES.length} known CF ranges)`,
      evidence: header(res, "cf-ray") || server,
    }
  }

  export async function originLeak(sender: HttpSender, origin: string): Promise<Check> {
    const domain = host(origin)
    const subdomains = [
      "direct", "mail", "ftp", "cpanel", "staging", "dev", "api", "origin",
      "webmail", "smtp", "pop", "imap", "ns1", "ns2", "old", "test",
      "admin", "portal", "internal", "vpn", "backend", "m",
    ]

    const mainRes = await get(sender, origin)
    const mainCfRay = ok(mainRes) ? !!header(mainRes, "cf-ray") : false

    const leaks: string[] = []
    for (const sub of subdomains) {
      const url = `https://${sub}.${domain}`
      const res = await get(sender, url)
      if (failed(res) || res.status === 0) continue
      const hasCfRay = !!header(res, "cf-ray")
      const serverHeader = header(res, "server")
      const isCloudflare = hasCfRay || serverHeader.toLowerCase().includes("cloudflare")
      const potentialOrigin = mainCfRay && !isCloudflare && res.status > 0
      if (potentialOrigin) leaks.push(`${sub}.${domain}[${res.status} ${serverHeader || "no-server"}]`)
    }

    if (leaks.length === 0)
      return { check: "origin_leak", hit: false, severity: "info", detail: "no origin leak via subdomain probing (in-scope only)" }
    return {
      check: "origin_leak",
      hit: true,
      severity: "high",
      detail: `subdomains not behind Cloudflare may reveal origin IP: ${leaks.join(", ")}`,
      evidence: leaks.join(", "),
    }
  }

  export async function wafBypass(sender: HttpSender, origin: string): Promise<Check> {
    const url = origin
    const testPayload = "<script>alert(1)</script>"

    const techniques: { name: string; blocked: boolean; status: number; detail: string }[] = []

    // Baseline: normal request with payload in query
    const baseline = await get(sender, `${url}?q=${encodeURIComponent(testPayload)}`)
    const baselineBlocked =
      ok(baseline) && (baseline.status === 403 || (baseline.body.includes("cloudflare") && baseline.body.includes("blocked")))
    techniques.push({
      name: "baseline_query_param",
      blocked: baselineBlocked,
      status: ok(baseline) ? baseline.status : 0,
      detail: "Standard GET with payload in query parameter",
    })

    // Technique 1: HTTP method override
    const methodOverride = await sender.send({
      method: "POST",
      url,
      headers: { "X-HTTP-Method-Override": "GET", "Content-Type": "application/x-www-form-urlencoded" },
      body: `q=${encodeURIComponent(testPayload)}`,
    })
    techniques.push({
      name: "x_http_method_override",
      blocked: ok(methodOverride) && methodOverride.status === 403,
      status: ok(methodOverride) ? methodOverride.status : 0,
      detail: "POST with X-HTTP-Method-Override: GET header",
    })

    // Technique 2: Content-Type manipulation
    const ctManip = await sender.send({
      method: "POST",
      url,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ q: testPayload }),
    })
    techniques.push({
      name: "content_type_json",
      blocked: ok(ctManip) && ctManip.status === 403,
      status: ok(ctManip) ? ctManip.status : 0,
      detail: "POST with JSON content-type instead of form-encoded",
    })

    // Technique 3: multipart/form-data
    const boundary = "----WebKitFormBoundary7MA4YWxkTrZu0gW"
    const multipartBody = `--${boundary}\r\nContent-Disposition: form-data; name="q"\r\n\r\n${testPayload}\r\n--${boundary}--`
    const multipart = await sender.send({
      method: "POST",
      url,
      headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
      body: multipartBody,
    })
    techniques.push({
      name: "multipart_form_data",
      blocked: ok(multipart) && multipart.status === 403,
      status: ok(multipart) ? multipart.status : 0,
      detail: "POST with multipart/form-data encoding",
    })

    // Technique 4: Path normalization
    const pathNorm = await get(sender, `${url}/./..;/..;/?q=${encodeURIComponent(testPayload)}`)
    techniques.push({
      name: "path_normalization",
      blocked: ok(pathNorm) && pathNorm.status === 403,
      status: ok(pathNorm) ? pathNorm.status : 0,
      detail: "Path traversal normalization tricks (./..;/)",
    })

    // Technique 5: Unicode encoding
    const unicodePayload = testPayload.replace(/</g, "＜").replace(/>/g, "＞")
    const unicode = await get(sender, `${url}?q=${encodeURIComponent(unicodePayload)}`)
    techniques.push({
      name: "unicode_fullwidth",
      blocked: ok(unicode) && unicode.status === 403,
      status: ok(unicode) ? unicode.status : 0,
      detail: "Fullwidth Unicode character substitution for < and >",
    })

    // Technique 6: Double URL encoding
    const doubleEnc = await get(sender, `${url}?q=${encodeURIComponent(encodeURIComponent(testPayload))}`)
    techniques.push({
      name: "double_url_encoding",
      blocked: ok(doubleEnc) && doubleEnc.status === 403,
      status: ok(doubleEnc) ? doubleEnc.status : 0,
      detail: "Double URL-encoded payload",
    })

    const bypassed = techniques.filter((t) => t.name !== "baseline_query_param" && baselineBlocked && !t.blocked)
    if (!baselineBlocked)
      return { check: "waf_bypass", hit: false, severity: "info", detail: "WAF did not block the baseline payload — may not be active for this rule set" }
    if (bypassed.length === 0)
      return { check: "waf_bypass", hit: false, severity: "info", detail: "WAF is active and blocked all tested techniques" }
    return {
      check: "waf_bypass",
      hit: true,
      severity: "high",
      detail: `WAF is active but ${bypassed.length} bypass technique(s) succeeded: ${bypassed.map((t) => t.name).join(", ")}`,
      evidence: bypassed.map((t) => `${t.name}=${t.status}`).join(" "),
    }
  }

  export async function securityLevel(sender: HttpSender, origin: string): Promise<Check> {
    const res = await get(sender, origin)
    if (failed(res)) return { check: "security_level", hit: false, severity: "info", detail: "no response" }
    const body = res.body

    const isChallenge = res.status === 503 && body.includes("jschallenge")
    const isManagedChallenge = body.includes("cf-challenge-running") || body.includes("challenge-platform")
    const isCaptcha = body.includes("cf-turnstile") || body.includes("hcaptcha")
    const underAttack = res.status === 503 && (body.includes("Checking your browser") || body.includes("DDoS protection by Cloudflare"))

    let securityLevel = "unknown"
    if (underAttack) securityLevel = "under_attack"
    else if (isChallenge || isManagedChallenge) securityLevel = "high"
    else if (isCaptcha) securityLevel = "medium_with_captcha"
    else if (header(res, "set-cookie").includes("__cf_bm")) securityLevel = "medium"
    else securityLevel = "low_or_essentially_off"

    const hit = underAttack || isChallenge || isManagedChallenge || isCaptcha
    if (!hit)
      return { check: "security_level", hit: false, severity: "info", detail: `estimated security level: ${securityLevel}` }
    return {
      check: "security_level",
      hit: true,
      severity: "info",
      detail: `Cloudflare protection active — estimated security level: ${securityLevel}`,
      evidence: `status=${res.status}`,
    }
  }

  export async function workersDetect(sender: HttpSender, origin: string): Promise<Check> {
    const testPaths = ["/", "/api", "/api/v1", "/cdn-cgi/trace", "/_worker.js"]
    const results: { path: string; status: number; hasWorker: boolean; detail: string }[] = []

    for (const path of testPaths) {
      const testUrl = new URL(path, origin).toString()
      const res = await get(sender, testUrl)
      if (failed(res)) continue

      const workerHeader = header(res, "cf-worker")
      const cacheStatus = header(res, "cf-cache-status")
      const serverTiming = header(res, "server-timing")

      let detail = ""
      if (workerHeader) detail = `Worker detected via cf-worker header: ${workerHeader}`
      else if (cacheStatus === "DYNAMIC" && serverTiming.includes("cfWorker")) detail = "Worker likely active (DYNAMIC + cfWorker timing)"
      else if (path === "/cdn-cgi/trace" && res.status === 200) detail = "CDN-CGI trace endpoint accessible"
      else if (path === "/_worker.js" && res.status === 200) detail = "Worker script may be publicly accessible"

      results.push({ path, status: res.status, hasWorker: !!workerHeader, detail })
    }

    const workersDetected = results.some((r) => r.hasWorker || r.detail.includes("Worker"))
    if (!workersDetected)
      return { check: "workers_detect", hit: false, severity: "info", detail: "no Workers detected on tested paths" }
    const scriptExposed = results.some((r) => r.detail.includes("publicly accessible"))
    return {
      check: "workers_detect",
      hit: true,
      severity: scriptExposed ? "medium" : "info",
      detail: `Cloudflare Workers detected: ${results.filter((r) => r.detail).map((r) => `${r.path} (${r.detail})`).join("; ")}`,
      evidence: results.filter((r) => r.detail).map((r) => `${r.path}=${r.status}`).join(" "),
    }
  }

  export async function turnstileDetect(sender: HttpSender, origin: string): Promise<Check> {
    const res = await get(sender, origin)
    if (failed(res)) return { check: "turnstile_detect", hit: false, severity: "info", detail: "no response" }
    const body = res.body

    const hasTurnstileScript = body.includes("challenges.cloudflare.com/turnstile") || body.includes("turnstile/v0/api.js")
    const hasTurnstileDiv = body.includes("cf-turnstile") || body.includes("data-sitekey")
    const hasHcaptcha = body.includes("hcaptcha.com") || body.includes("h-captcha")

    const siteKeyMatches = body.match(/data-sitekey=["']([^"']+)["']/g) ?? []
    const siteKeys = siteKeyMatches
      .map((m) => {
        const match = m.match(/data-sitekey=["']([^"']+)["']/)
        return match ? match[1] : null
      })
      .filter((k): k is string => !!k)

    let widgetMode = "unknown"
    if (body.includes('data-appearance="always"')) widgetMode = "always_visible"
    else if (body.includes('data-appearance="interaction-only"')) widgetMode = "interaction_only"
    else if (body.includes('data-appearance="execute"') || body.includes("turnstile.execute")) widgetMode = "invisible_execute"
    else if (hasTurnstileDiv) widgetMode = "managed"

    let theme = "auto"
    const themeMatch = body.match(/data-theme=["']([^"']+)["']/)
    if (themeMatch) theme = themeMatch[1]

    const explicitRender = body.includes("turnstile.render") || body.includes("onloadTurnstileCallback")
    const actionMatch = body.match(/data-action=["']([^"']+)["']/)
    const action = actionMatch ? actionMatch[1] : null

    const turnstileDetected = hasTurnstileScript || hasTurnstileDiv
    const captchaType = hasTurnstileScript ? "turnstile" : hasHcaptcha ? "hcaptcha" : hasTurnstileDiv ? "turnstile_widget_only" : "none"
    if (!turnstileDetected && !hasHcaptcha)
      return { check: "turnstile_detect", hit: false, severity: "info", detail: "no Turnstile detected on this page" }
    return {
      check: "turnstile_detect",
      hit: turnstileDetected,
      severity: "info",
      detail: `${captchaType} detected (widget_mode=${widgetMode}, theme=${theme}, explicit_render=${explicitRender}${action ? `, action=${action}` : ""})`,
      evidence: siteKeys.length > 0 ? `sitekey=${siteKeys[0]}` : captchaType,
    }
  }

  const RUNNERS: Record<string, (s: HttpSender, o: string) => Promise<Check>> = {
    detect,
    origin_leak: originLeak,
    waf_bypass: wafBypass,
    security_level: securityLevel,
    workers_detect: workersDetect,
    turnstile_detect: turnstileDetect,
  }

  export async function run(sender: HttpSender, origin: string, which: string): Promise<Check[]> {
    const names = which === "all" ? Object.keys(RUNNERS) : [which]
    const out: Check[] = []
    for (const n of names) out.push(await RUNNERS[n](sender, origin))
    return out
  }
}

const DESCRIPTION = `Cloudflare edge checks (CF detection via headers/cookies/body, origin-IP leak via 22 common subdomains, WAF bypass — method override/content-type/multipart/path-normalization/fullwidth-unicode/double-encoding, security-level/challenge state, Workers detection + /_worker.js source leak, Turnstile widget). 1:1 port of the infra-security cloudflare provider.

Run after Vortex fingerprints Cloudflare (technology:cloudflare). Subdomain/origin probes respect the captured-host scope guard (out-of-scope hosts are skipped). check="all" (default) runs every check.`

export const CloudflareTestTool = defineWebhookTool({
  name: "cf_test",
  description: DESCRIPTION,
  parameters: z.object({
    target: z.string().describe("Target origin or URL (e.g. https://target.com)."),
    check: z
      .enum(["all", "detect", "origin_leak", "waf_bypass", "security_level", "workers_detect", "turnstile_detect"])
      .default("all")
      .describe("Which check to run; 'all' runs every Cloudflare check."),
  }),
  async run(params, ctx) {
    const origin = base(params.target)
    const results = await Cloudflare.run(ctx.sender, origin, params.check)
    return { target: origin, results }
  },
  format(r) {
    return summarize("cf_test", r.target, r.results)
  },
})
