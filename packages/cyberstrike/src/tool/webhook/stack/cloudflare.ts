// cloudflare stack checks — ported from infra-security-mcp `providers/cloudflare` (cf_*).
import z from "zod"
import { defineWebhookTool } from "../define"
import type { HttpSender } from "../transport"
import { get, header, failed, ok, base, host, summarize, type Check } from "./shared"

function apex(h: string): string {
  const parts = h.split(".")
  return parts.length <= 2 ? h : parts.slice(-2).join(".")
}

export namespace Cloudflare {
  export async function detect(sender: HttpSender, origin: string): Promise<Check> {
    const res = await get(sender, origin)
    if (failed(res)) return { check: "detect", hit: false, severity: "info", detail: "no response" }
    const ray = header(res, "cf-ray")
    const server = header(res, "server")
    const cookie = header(res, "set-cookie")
    const cf = ray || /cloudflare/i.test(server) || /__cf_bm|__cfduid/.test(cookie)
    if (!cf) return { check: "detect", hit: false, severity: "info", detail: "Cloudflare not detected" }
    return { check: "detect", hit: true, severity: "info", detail: "Cloudflare in front of origin", evidence: ray ? `cf-ray=${ray}` : server }
  }

  export async function originLeak(sender: HttpSender, origin: string): Promise<Check> {
    const dom = apex(host(origin))
    const labels = ["direct", "origin", "mail", "api", "staging", "dev", "vpn", "cpanel", "webmail", "ftp"]
    for (const l of labels) {
      const res = await get(sender, `https://${l}.${dom}`)
      if (failed(res)) continue
      if (res.status > 0 && res.status < 500 && !header(res, "cf-ray") && !/cloudflare/i.test(header(res, "server")))
        return { check: "origin_leak", hit: true, severity: "high", detail: `possible origin IP behind CF at ${l}.${dom} (no cf-ray)`, evidence: `status=${res.status} server=${header(res, "server")}` }
    }
    return { check: "origin_leak", hit: false, severity: "info", detail: "no origin leak via common subdomains (in-scope only)" }
  }

  export async function wafBypass(sender: HttpSender, origin: string): Promise<Check> {
    const payload = "<script>alert(1)</script>"
    const baseUrl = `${origin}/?q=${encodeURIComponent(payload)}`
    const bl = await get(sender, baseUrl)
    if (failed(bl) || bl.status !== 403)
      return { check: "waf_bypass", hit: false, severity: "info", detail: "baseline payload not blocked (403) — nothing to bypass" }
    const attempts: { how: string; res: Awaited<ReturnType<typeof get>> }[] = [
      { how: "X-HTTP-Method-Override", res: await get(sender, baseUrl, { "X-HTTP-Method-Override": "GET" }) },
      { how: "path-normalization", res: await get(sender, `${origin}/%2e/%2e%2e;/?q=${encodeURIComponent(payload)}`) },
      { how: "fullwidth-unicode", res: await get(sender, `${origin}/?q=${encodeURIComponent("＜script＞alert(1)＜/script＞")}`) },
      { how: "double-url-encode", res: await get(sender, `${origin}/?q=%253Cscript%253Ealert(1)%253C%2Fscript%253E`) },
    ]
    for (const a of attempts)
      if (ok(a.res) && a.res.status !== 403 && a.res.status < 500)
        return { check: "waf_bypass", hit: true, severity: "high", detail: `Cloudflare WAF bypass via ${a.how}`, evidence: `baseline=403 bypass=${a.res.status}` }
    return { check: "waf_bypass", hit: false, severity: "info", detail: "no WAF bypass among tested techniques" }
  }

  export async function securityLevel(sender: HttpSender, origin: string): Promise<Check> {
    const res = await get(sender, origin)
    if (failed(res)) return { check: "security_level", hit: false, severity: "info", detail: "no response" }
    const body = res.body.slice(0, 4000)
    if (/Checking your browser|cf-browser-verification|Just a moment/i.test(body))
      return { check: "security_level", hit: true, severity: "info", detail: "Cloudflare Under-Attack / JS challenge active", evidence: "challenge interstitial" }
    if (/challenges\.cloudflare\.com\/turnstile|hcaptcha/i.test(body))
      return { check: "security_level", hit: true, severity: "info", detail: "Cloudflare Turnstile/CAPTCHA present" }
    return { check: "security_level", hit: false, severity: "info", detail: "no challenge/under-attack interstitial" }
  }

  export async function workersDetect(sender: HttpSender, origin: string): Promise<Check> {
    const worker = await get(sender, `${origin}/_worker.js`)
    if (ok(worker) && worker.status === 200 && /addEventListener\(["']fetch|export default/.test(worker.body))
      return { check: "workers_detect", hit: true, severity: "medium", detail: "Cloudflare Worker source exposed at /_worker.js", evidence: worker.body.slice(0, 200) }
    const root = await get(sender, origin)
    if (ok(root) && (header(root, "cf-worker") || /cfWorker/i.test(header(root, "server-timing"))))
      return { check: "workers_detect", hit: true, severity: "info", detail: "Cloudflare Worker in request path", evidence: header(root, "cf-worker") || header(root, "server-timing") }
    return { check: "workers_detect", hit: false, severity: "info", detail: "no Cloudflare Worker detected" }
  }

  export async function turnstileDetect(sender: HttpSender, origin: string): Promise<Check> {
    const res = await get(sender, origin)
    if (failed(res)) return { check: "turnstile_detect", hit: false, severity: "info", detail: "no response" }
    if (!/challenges\.cloudflare\.com\/turnstile|cf-turnstile/i.test(res.body))
      return { check: "turnstile_detect", hit: false, severity: "info", detail: "no Turnstile widget" }
    const key = res.body.match(/data-sitekey=["']([^"']+)["']/)
    return { check: "turnstile_detect", hit: true, severity: "info", detail: "Cloudflare Turnstile widget present", evidence: key ? `sitekey=${key[1]}` : "turnstile script" }
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

const DESCRIPTION = `Cloudflare edge checks (CF detection, origin-IP leak via common subdomains, WAF bypass techniques, security-level/challenge state, Workers detection + /_worker.js source leak, Turnstile widget).

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
