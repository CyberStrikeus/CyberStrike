// Ruby on Rails stack checks — 1:1 port of infra-security-mcp `providers/rails`.
// Every URL path, header, config-file path, dangerous mass-assignment attr and
// detection branch matches the source exactly; only the transport (scope-guarded
// webhook sender) and the Check/severity adapter are CyberStrike's.
import z from "zod"
import { defineWebhookTool } from "../define"
import type { HttpSender } from "../transport"
import { get, header, failed, ok, base, summarize, verdict, type Check, type Finding } from "./shared"

export namespace Rails {
  export async function detect(sender: HttpSender, origin: string): Promise<Check> {
    const main = await get(sender, origin)
    if (failed(main)) return { check: "detect", hit: false, severity: "info", detail: "no response" }
    const findings: string[] = []

    const xRequestId = header(main, "x-request-id")
    if (xRequestId && /^[0-9a-f-]{36}$/.test(xRequestId)) findings.push(`X-Request-Id: ${xRequestId} (Rails UUID pattern)`)

    const xRuntime = header(main, "x-runtime")
    if (xRuntime && /^\d+\.\d+$/.test(xRuntime)) findings.push(`X-Runtime: ${xRuntime} (Rails timing header)`)

    const cookie = header(main, "set-cookie")
    if (cookie.includes("_session_id")) findings.push("Rails _session_id cookie detected")
    if (cookie.includes("_csrf_token")) findings.push("Rails _csrf_token cookie detected")

    const bogus = await get(sender, `${origin}/${crypto.randomUUID().slice(0, 8)}`)
    if (ok(bogus)) {
      if (bogus.body.includes("Action Controller") || bogus.body.includes("ActionController")) findings.push("Rails ActionController error page")
      if (bogus.body.includes("Routing Error")) findings.push("Rails Routing Error page")
      if (bogus.body.includes("Rails.root")) findings.push("Rails.root path disclosed in error")
    }

    if (main.body.includes("csrf-token") || main.body.includes("authenticity_token")) findings.push("Rails authenticity_token / csrf-token in page")

    const poweredBy = header(main, "x-powered-by")
    if (poweredBy.toLowerCase().includes("phusion") || poweredBy.toLowerCase().includes("passenger")) findings.push(`X-Powered-By: ${poweredBy} (Phusion Passenger — Ruby app server)`)

    if (findings.length === 0) return { check: "detect", hit: false, severity: "info", detail: "Ruby on Rails not detected" }
    return { check: "detect", hit: true, severity: "info", detail: findings.join("; "), evidence: findings[0] }
  }

  export async function debugMode(sender: HttpSender, origin: string): Promise<Check> {
    const findings: Finding[] = []

    const bogus = await get(sender, `${origin}/${crypto.randomUUID().slice(0, 8)}`)
    if (ok(bogus)) {
      if (bogus.body.includes("Action Controller: Exception Caught") || bogus.body.includes("actioncontroller-")) findings.push({ severity: "high", detail: "Rails detailed error page active — full stack trace, request params, session data visible" })
      if (bogus.body.includes("better_errors") || bogus.body.includes("BetterErrors")) findings.push({ severity: "critical", detail: "BetterErrors interactive debugger in production — allows code execution via REPL" })
      if (bogus.body.includes("web-console") || bogus.body.includes("__web_console")) findings.push({ severity: "critical", detail: "Rails Web Console active — provides interactive Ruby REPL in browser (RCE)" })
      if (bogus.body.includes("Rails.env") || bogus.body.includes("RAILS_ENV")) {
        const envMatch = bogus.body.match(/RAILS_ENV[=:]\s*(\w+)/)
        findings.push({ severity: "medium", detail: `Rails environment disclosed: ${envMatch?.[1] ?? "unknown"}` })
      }
      if (bogus.body.includes("Source extract") || bogus.body.includes("source-extract")) findings.push({ severity: "high", detail: "Source code extract shown in error page — reveals application code around the error" })
    }

    const info = await get(sender, `${origin}/rails/info`)
    if (ok(info) && info.status === 200 && (info.body.includes("Rails version") || info.body.includes("routes"))) findings.push({ severity: "high", detail: "Rails info page accessible — shows framework version, middleware stack, routes" })

    const routes = await get(sender, `${origin}/rails/info/routes`)
    if (ok(routes) && routes.status === 200 && routes.body.includes("Path")) findings.push({ severity: "high", detail: "All application routes exposed at /rails/info/routes — full attack surface map" })

    const mailers = await get(sender, `${origin}/rails/mailers`)
    if (ok(mailers) && mailers.status === 200 && mailers.body.includes("Mailer")) findings.push({ severity: "medium", detail: "Rails mailer previews accessible — may reveal email templates and user data patterns" })

    return verdict("debug_mode", findings, "no Rails debug/development surface exposed")
  }

  export async function secretLeak(sender: HttpSender, origin: string): Promise<Check> {
    const secretPaths = [
      { path: "/config/secrets.yml", indicator: "secret_key_base", severity: "critical" as const },
      { path: "/config/database.yml", indicator: "adapter:", severity: "critical" as const },
      { path: "/config/master.key", indicator: null, severity: "critical" as const },
      { path: "/config/credentials.yml.enc", indicator: null, severity: "medium" as const },
      { path: "/config/storage.yml", indicator: "service:", severity: "high" as const },
      { path: "/config/cable.yml", indicator: "adapter:", severity: "medium" as const },
      { path: "/.ruby-version", indicator: null, severity: "low" as const },
      { path: "/Gemfile", indicator: "gem", severity: "low" as const },
      { path: "/Gemfile.lock", indicator: "BUNDLED", severity: "low" as const },
    ]

    const findings: Finding[] = []
    for (const entry of secretPaths) {
      const res = await get(sender, `${origin}${entry.path}`)
      if (failed(res)) continue
      const isAccessible = res.status === 200 && res.body.length > 5
      const matchesIndicator = !entry.indicator || res.body.includes(entry.indicator)
      if (isAccessible && matchesIndicator) {
        const detail = entry.path.includes("master.key")
          ? "master.key exposed — can decrypt credentials.yml.enc (full secret access)"
          : entry.path.includes("secrets.yml")
            ? "secrets.yml exposed — contains SECRET_KEY_BASE and other secrets in plaintext"
            : entry.path.includes("database.yml")
              ? "database.yml exposed — reveals database host, credentials, and adapter configuration"
              : `${entry.path} accessible — ${res.body.slice(0, 200)}`
        findings.push({ severity: entry.severity, detail })
      }
    }

    const bogus = await get(sender, `${origin}/${crypto.randomUUID().slice(0, 8)}`)
    if (ok(bogus) && (bogus.body.includes("SECRET_KEY_BASE") || bogus.body.includes("secret_key_base"))) findings.push({ severity: "critical", detail: "SECRET_KEY_BASE visible in error page — allows session forgery and RCE via deserialization" })

    return verdict("secret_leak", findings, "no exposed Rails credentials")
  }

  export async function massAssignment(sender: HttpSender, origin: string): Promise<Check> {
    const page = await get(sender, origin)
    if (failed(page)) return { check: "mass_assignment", hit: false, severity: "info", detail: "no response" }

    const modelParams: string[] = []
    const inputPattern = /<input[^>]*name="([^"]*\[[^\]]*\])"[^>]*>/gi
    let match: RegExpExecArray | null
    while ((match = inputPattern.exec(page.body)) !== null) modelParams.push(match[1])
    const selectPattern = /<select[^>]*name="([^"]*\[[^\]]*\])"[^>]*>/gi
    while ((match = selectPattern.exec(page.body)) !== null) modelParams.push(match[1])

    if (modelParams.length === 0) return { check: "mass_assignment", hit: false, severity: "info", detail: "No Rails model parameters found in form" }

    const modelPrefix = modelParams[0]?.match(/^([^[]+)\[/)?.[1]
    if (!modelPrefix) return { check: "mass_assignment", hit: false, severity: "info", detail: `model params found but no prefix: ${modelParams.join(", ")}` }

    const dangerousAttrs = ["admin", "role", "is_admin", "is_superuser", "email_verified", "approved", "active", "permissions", "group_id", "plan", "subscription", "balance", "credits"]
    const csrfToken = page.body.match(/name="authenticity_token"[^>]*value="([^"]*)"/)?.[1]

    const findings: Finding[] = []
    for (const attr of dangerousAttrs) {
      const paramName = `${modelPrefix}[${attr}]`
      const formData = new URLSearchParams()
      formData.set(paramName, "true")
      if (csrfToken) formData.set("authenticity_token", csrfToken)
      const res = await sender.send({ method: "POST", url: origin, headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: formData.toString() })
      if (ok(res) && res.status >= 200 && res.status < 400 && !res.body.includes("Unpermitted parameter")) findings.push({ severity: "high", detail: `Parameter '${paramName}' accepted without rejection — possible mass assignment of '${attr}'` })
    }

    return verdict("mass_assignment", findings, `no dangerous params accepted (model prefix '${modelPrefix}')`)
  }

  export async function assetExposure(sender: HttpSender, origin: string): Promise<Check> {
    const findings: Finding[] = []

    const assets = await get(sender, `${origin}/assets/`)
    if (ok(assets) && assets.status === 200 && (assets.body.includes("Index of") || assets.body.includes("Directory listing"))) findings.push({ severity: "medium", detail: "/assets/: Asset pipeline directory listing — reveals all compiled assets and their hashed names" })

    const sprocketsPaths = ["/assets/application.js?body=1", "/assets/application.css?body=1"]
    for (const p of sprocketsPaths) {
      const res = await get(sender, `${origin}${p}`)
      if (ok(res) && res.status === 200 && (res.body.includes("//= require") || res.body.includes("*= require"))) {
        findings.push({ severity: "medium", detail: `${p}: Sprockets debug mode — ?body=1 returns uncompiled source with require directives` })
        break
      }
    }

    const sourcePaths = ["/assets/application.js.map", "/assets/application.css.map", "/packs/application.js.map", "/packs/js/application.js.map"]
    for (const p of sourcePaths) {
      const res = await get(sender, `${origin}${p}`)
      if (ok(res) && res.status === 200 && (res.body.includes('"sources"') || res.body.includes('"mappings"'))) {
        findings.push({ severity: "medium", detail: `${p}: Source map file exposed — original unminified source code recoverable` })
        break
      }
    }

    const webpacker = await get(sender, `${origin}/packs/manifest.json`)
    if (ok(webpacker) && webpacker.status === 200 && webpacker.body.includes("{")) findings.push({ severity: "low", detail: "/packs/manifest.json: Webpacker manifest exposed — maps logical names to compiled asset paths" })

    return verdict("asset_exposure", findings, "no exposed asset-pipeline source")
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

const DESCRIPTION = `Ruby on Rails checks (detection via X-Request-Id/X-Runtime/_session_id/ActionController/Passenger, debug mode: detailed error page + BetterErrors + Web Console + /rails/info + /rails/info/routes + /rails/mailers, secret leak: secrets.yml/database.yml/master.key/credentials.yml.enc/storage.yml/cable.yml/Gemfile + SECRET_KEY_BASE in error, mass assignment of admin/role/is_admin/… attrs, asset pipeline exposure: /assets/ listing + Sprockets ?body=1 + source maps + Webpacker manifest). 1:1 port of the infra-security rails provider.

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
