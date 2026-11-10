// rails stack checks — ported from infra-security-mcp `providers/rails`.
import z from "zod"
import { defineWebhookTool } from "../define"
import type { HttpSender } from "../transport"
import { get, header, failed, ok, base, summarize, type Check } from "./shared"

export namespace Rails {
  export async function detect(sender: HttpSender, origin: string): Promise<Check> {
    const res = await get(sender, origin)
    if (failed(res)) return { check: "detect", hit: false, severity: "info", detail: "no response" }
    const rails =
      /^[0-9a-f-]{36}$/.test(header(res, "x-request-id")) ||
      header(res, "x-runtime") !== "" ||
      /_session_id|_csrf_token/.test(header(res, "set-cookie")) ||
      /phusion|passenger/i.test(header(res, "server")) ||
      /csrf-token|authenticity_token/.test(res.body)
    if (!rails) return { check: "detect", hit: false, severity: "info", detail: "Rails not detected" }
    return { check: "detect", hit: true, severity: "info", detail: "Ruby on Rails detected", evidence: header(res, "x-runtime") ? `x-runtime=${header(res, "x-runtime")}` : "csrf/session markers" }
  }

  export async function debugMode(sender: HttpSender, origin: string): Promise<Check> {
    const err = await get(sender, `${origin}/__err_${Date.now()}`)
    if (ok(err) && /BetterErrors|better_errors/i.test(err.body))
      return { check: "debug_mode", hit: true, severity: "critical", detail: "BetterErrors console exposed (RCE)", evidence: err.body.slice(0, 120) }
    if (ok(err) && /web-console|Rails::Console/i.test(err.body))
      return { check: "debug_mode", hit: true, severity: "critical", detail: "Rails web-console exposed (RCE)", evidence: err.body.slice(0, 120) }
    for (const p of ["/rails/info", "/rails/info/routes"]) {
      const res = await get(sender, `${origin}${p}`)
      if (ok(res) && res.status === 200 && /(Routes|Rails version|Controller#Action)/i.test(res.body))
        return { check: "debug_mode", hit: true, severity: "high", detail: `Rails info/routes exposed at ${p}`, evidence: res.body.slice(0, 120) }
    }
    if (ok(err) && /Action Controller: Exception caught|Stack Trace/i.test(err.body))
      return { check: "debug_mode", hit: true, severity: "medium", detail: "detailed Rails error pages (development-mode errors)", evidence: err.body.slice(0, 120) }
    return { check: "debug_mode", hit: false, severity: "info", detail: "no Rails debug/console exposure" }
  }

  export async function secretLeak(sender: HttpSender, origin: string): Promise<Check> {
    const files: [string, RegExp][] = [
      ["/config/secrets.yml", /secret_key_base/i],
      ["/config/database.yml", /adapter:|password:/i],
      ["/config/master.key", /^[0-9a-f]{32}$/m],
      ["/config/credentials.yml.enc", /./],
      ["/Gemfile", /gem ['"]rails['"]/i],
    ]
    for (const [p, rx] of files) {
      const res = await get(sender, `${origin}${p}`)
      if (ok(res) && res.status === 200 && rx.test(res.body) && !/<html/i.test(res.body.slice(0, 100)))
        return { check: "secret_leak", hit: true, severity: p.includes("master.key") || p.includes("secrets") ? "critical" : "high", detail: `Rails config file exposed at ${p}`, evidence: res.body.slice(0, 100).replace(/(password|secret_key_base):.*/gi, "$1: [REDACTED]") }
    }
    return { check: "secret_leak", hit: false, severity: "info", detail: "no exposed Rails config/secret file" }
  }

  export async function massAssignment(sender: HttpSender, origin: string): Promise<Check> {
    const res = await sender.send({ method: "POST", url: `${origin}/users`, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ admin: true, role: "admin", is_admin: true }) })
    if (failed(res)) return { check: "mass_assignment", hit: false, severity: "info", detail: "no /users endpoint" }
    if (res.status < 400 && !/Unpermitted parameter|ForbiddenAttributes/i.test(res.body))
      return { check: "mass_assignment", hit: true, severity: "high", detail: "dangerous attributes (admin/role) accepted without strong-params rejection", evidence: `status=${res.status}, no Unpermitted-parameter warning` }
    return { check: "mass_assignment", hit: false, severity: "info", detail: "strong params reject dangerous attributes" }
  }

  export async function assetExposure(sender: HttpSender, origin: string): Promise<Check> {
    const manifest = await get(sender, `${origin}/packs/manifest.json`)
    if (ok(manifest) && manifest.status === 200 && manifest.body.includes(".js"))
      return { check: "asset_exposure", hit: true, severity: "low", detail: "Webpacker manifest exposed (/packs/manifest.json)", evidence: manifest.body.slice(0, 120) }
    const map = await get(sender, `${origin}/assets/application.js.map`)
    if (ok(map) && map.status === 200 && map.body.includes('"sources"'))
      return { check: "asset_exposure", hit: true, severity: "low", detail: "asset source map exposed", evidence: "sourcesContent present" }
    return { check: "asset_exposure", hit: false, severity: "info", detail: "no asset manifest/source-map exposure" }
  }

  const RUNNERS: Record<string, (s: HttpSender, o: string) => Promise<Check>> = {
    detect,
    debug_mode: debugMode,
    secret_leak: secretLeak,
    mass_assignment: massAssignment,
    asset_exposure: assetExposure,
  }

  export async function run(sender: HttpSender, origin: string, which: string): Promise<Check[]> {
    const names = which === "all" ? Object.keys(RUNNERS) : [which]
    const out: Check[] = []
    for (const n of names) out.push(await RUNNERS[n](sender, origin))
    return out
  }
}

const DESCRIPTION = `Ruby on Rails checks (detection, BetterErrors/web-console/dev-error debug exposure, config/secret file leak, mass-assignment, Webpacker manifest/source-map exposure).

Run after Vortex fingerprints Rails. Probes go through the scope-guarded replay engine. check="all" (default) runs every check.`

export const RailsTestTool = defineWebhookTool({
  name: "rails_test",
  description: DESCRIPTION,
  parameters: z.object({
    target: z.string().describe("Target origin or URL (e.g. https://target.com)."),
    check: z
      .enum(["all", "detect", "debug_mode", "secret_leak", "mass_assignment", "asset_exposure"])
      .default("all")
      .describe("Which check to run; 'all' runs every Rails check."),
  }),
  async run(params, ctx) {
    const origin = base(params.target)
    const results = await Rails.run(ctx.sender, origin, params.check)
    return { target: origin, results }
  },
  format(r) {
    return summarize("rails_test", r.target, r.results)
  },
})
