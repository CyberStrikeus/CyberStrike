// fastly stack checks — ported from infra-security-mcp `providers/fastly`.
import z from "zod"
import { defineWebhookTool } from "../define"
import type { HttpSender } from "../transport"
import { get, header, failed, ok, base, summarize, type Check } from "./shared"

function pop(served: string): string {
  const m = served.match(/cache-[a-z]{3}\d+/i)
  return m ? m[0] : ""
}

export namespace Fastly {
  export async function detect(sender: HttpSender, origin: string): Promise<Check> {
    const res = await get(sender, origin)
    if (failed(res)) return { check: "detect", hit: false, severity: "info", detail: "no response" }
    const served = header(res, "x-served-by")
    const fastly = /cache-/i.test(served) || /varnish/i.test(header(res, "via")) || header(res, "x-timer") !== "" || header(res, "fastly-debug-digest") !== ""
    if (!fastly) return { check: "detect", hit: false, severity: "info", detail: "Fastly not detected" }
    return { check: "detect", hit: true, severity: "info", detail: `Fastly edge in front of origin${pop(served) ? ` (POP ${pop(served)})` : ""}`, evidence: served || header(res, "via") }
  }

  export async function cachePoison(sender: HttpSender, origin: string): Promise<Check> {
    const evil = "evil.attacker.example"
    const injections: Record<string, string>[] = [
      { "X-Forwarded-Host": evil }, { "X-Host": evil }, { Forwarded: `host=${evil}` },
      { "X-Forwarded-Scheme": "http" }, { "X-Forwarded-Prefix": "/evil" }, { "X-Original-URL": `http://${evil}/` },
    ]
    for (const inj of injections) {
      const res = await get(sender, `${origin}/?cb=${Date.now()}`, { ...inj, "Fastly-Debug": "1" })
      if (failed(res)) continue
      if (res.body.includes(evil))
        return { check: "cache_poison", hit: true, severity: "high", detail: `forwarding header reflected (cache poison): ${Object.keys(inj).join("+")}`, evidence: `x-cache=${header(res, "x-cache")}` }
    }
    return { check: "cache_poison", hit: false, severity: "info", detail: "no reflected forwarding-header cache poison" }
  }

  export async function originBypass(sender: HttpSender, origin: string): Promise<Check> {
    const res = await get(sender, origin, { "Cache-Control": "no-cache", "X-Forwarded-For": "127.0.0.1", "Fastly-Client-IP": "127.0.0.1" })
    if (failed(res)) return { check: "origin_bypass", hit: false, severity: "info", detail: "no response" }
    const viaFastly = /varnish/i.test(header(res, "via")) || header(res, "x-served-by") !== ""
    if (!viaFastly && res.status === 200)
      return { check: "origin_bypass", hit: true, severity: "medium", detail: "response served without Fastly markers — possible origin reachable / cache bypass", evidence: `via=${header(res, "via") || "none"}` }
    return { check: "origin_bypass", hit: false, severity: "info", detail: "requests stay on the Fastly edge" }
  }

  export async function vclError(sender: HttpSender, origin: string): Promise<Check> {
    const probes = [
      get(sender, `${origin}/%00`),
      sender.send({ method: "PURGE", url: origin, headers: {} }),
      get(sender, `${origin}/__fastly_404_${Date.now()}`),
    ]
    for (const p of probes) {
      const res = await p
      if (failed(res)) continue
      if (/(Varnish|vcl_error|guru meditation|XID:|Fastly error)/i.test(res.body))
        return { check: "vcl_error", hit: true, severity: "low", detail: "Fastly/Varnish error page leaks internals", evidence: res.body.slice(0, 200) }
    }
    return { check: "vcl_error", hit: false, severity: "info", detail: "no Varnish/VCL error leak" }
  }

  export async function shieldDetect(sender: HttpSender, origin: string): Promise<Check> {
    const pops = new Set<string>()
    for (let i = 0; i < 3; i++) {
      const res = await get(sender, `${origin}/?cb=${Date.now()}_${i}`, { "Fastly-Debug": "1" })
      if (ok(res)) {
        const served = header(res, "x-served-by")
        for (const m of served.matchAll(/cache-[a-z]{3}\d+/gi)) pops.add(m[0])
      }
    }
    if (pops.size > 1)
      return { check: "shield_detect", hit: true, severity: "info", detail: `Fastly shield POP topology observed (${pops.size} POPs)`, evidence: [...pops].join(" → ") }
    return { check: "shield_detect", hit: false, severity: "info", detail: "single-POP / no shield observed" }
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

const DESCRIPTION = `Fastly edge checks (detection + POP, forwarding-header cache poisoning, origin/cache bypass, Varnish/VCL error leak, shield POP topology).

Run after Vortex fingerprints Fastly. Probes go through the scope-guarded replay engine. check="all" (default) runs every check.`

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
