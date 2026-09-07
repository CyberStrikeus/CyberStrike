// misconfig_test — Misconfiguration active-probe tool (plan §05). Composes the
// wordlists (backup/admin/sensitive/methods) with the shared HttpSender transport
// and the probe orchestrator. Three modes: paths, methods, cors. The P0 signal
// fabric auto-classifies every response (ExposedArtifact, DirectoryListing,
// MissingSecurityHeaders, ServerBanner, CorsMisconfig, etc.) — this tool just
// generates the traffic.
//
// Tool.define is a thin shell; MisconfigTest.run is the testable core.
import z from "zod"
import { Tool } from "../../tool"
import { webhookContext, toolResult, toolError } from "../define"
import { MisconfigProbe, type PathProbeReport, type MethodProbeReport, type CorsProbeReport, type HeaderProbeReport } from "./probe"
import type { HttpSender, ProbeRequest } from "../transport"

export namespace MisconfigTest {
  export type Mode = "paths" | "methods" | "cors" | "headers"

  export interface PathsInput {
    mode: "paths"
    origin: string
    categories?: ("backup" | "admin" | "sensitive_file")[]
    limit?: number
    basePath?: string
  }

  export interface MethodsInput {
    mode: "methods"
    request: ProbeRequest
  }

  export interface CorsInput {
    mode: "cors"
    request: ProbeRequest
    origins?: string[]
  }

  export interface HeadersInput {
    mode: "headers"
    request: ProbeRequest
  }

  export type Input = PathsInput | MethodsInput | CorsInput | HeadersInput

  export interface PathsResult { mode: "paths"; report: PathProbeReport }
  export interface MethodsResult { mode: "methods"; report: MethodProbeReport }
  export interface CorsResult { mode: "cors"; report: CorsProbeReport }
  export interface HeadersResult { mode: "headers"; report: HeaderProbeReport }
  export type Result = PathsResult | MethodsResult | CorsResult | HeadersResult

  export async function run(input: Input, sender: HttpSender): Promise<Result> {
    const probe = new MisconfigProbe(sender)

    switch (input.mode) {
      case "paths": {
        const report = await probe.paths({
          origin: input.origin,
          categories: input.categories,
          limit: input.limit,
          basePath: input.basePath,
        })
        return { mode: "paths", report }
      }
      case "methods": {
        const report = await probe.methods({ request: input.request })
        return { mode: "methods", report }
      }
      case "cors": {
        const report = await probe.cors({ request: input.request, origins: input.origins })
        return { mode: "cors", report }
      }
      case "headers": {
        const report = await probe.headers({ request: input.request })
        return { mode: "headers", report }
      }
    }
  }
}

const CATEGORY = z.enum(["backup", "admin", "sensitive_file"])

const DESCRIPTION = `Actively probe a target for misconfigurations. Three modes:

**paths** — send GET requests for backup files (.bak/.old/.swp/~), admin panels (/admin, /wp-admin, /phpmyadmin), and sensitive files (.env, .git/HEAD, phpinfo.php, actuator, swagger) at the target origin. Flags responses that differ from the 404 baseline (200=found, 403=exists-but-blocked, 500=error leak). The signal fabric auto-classifies hits (ExposedArtifact, DirectoryListing, etc.).

**methods** — send unusual HTTP methods (TRACE, PUT, DELETE, PROPFIND, etc.) at a captured endpoint. Flags methods the server allows (not 405). TRACE enabled = XST risk; PUT/DELETE = unauthorized write.

**cors** — send Origin header variations (evil.com, subdomain confusion, null) at a captured endpoint. Flags reflected-origin + credentials=true (credential theft) or wildcard + credentials (spec violation).

**headers** — evaluate the security-header posture of a captured endpoint's response: missing/weak HSTS (WSTG-CONF-07), missing X-Frame-Options / CSP frame-ancestors (clickjacking, CWE-1021), missing CSP, missing X-Content-Type-Options nosniff, missing Referrer-Policy / Permissions-Policy, and version-disclosure headers (Server/X-Powered-By/X-AspNet-Version, CWE-200). Returns a complete issue checklist with per-issue severity.

Facts + leads — the agent confirms and weaponizes.`

export const MisconfigTestTool = Tool.define("misconfig_test", {
  description: DESCRIPTION,
  parameters: z.object({
    mode: z.enum(["paths", "methods", "cors", "headers"]).describe("Probe mode."),
    request_id: z.string().optional().describe("Captured request (required for methods, cors and headers modes)."),
    origin: z.string().optional().describe("paths: target origin (e.g. https://example.com). Defaults to the request's origin if request_id given."),
    categories: z.array(CATEGORY).optional().describe("paths: restrict to these wordlist categories."),
    limit: z.number().int().positive().optional().describe("paths: cap the number of paths probed."),
    base_path: z.string().optional().describe("paths: prefix for backup suffixes (e.g. /app/config.php → /app/config.php.bak)."),
    cors_origins: z.array(z.string()).optional().describe("cors: custom Origin values to test."),
  }),
  async execute(params, ctx) {
    const wctx = webhookContext(ctx)
    const NAME = "misconfig_test"
    const err = (msg: string) => toolError(NAME, msg)

    if (params.mode === "paths") {
      let origin = params.origin
      if (!origin && params.request_id) {
        const resolved = wctx.resolve(params.request_id)
        if ("error" in resolved) return err(resolved.error)
        try { origin = new URL(resolved.url).origin } catch { return err("Could not extract origin from request.") }
      }
      if (!origin) return err("paths mode requires origin or request_id.")

      const result = await MisconfigTest.run(
        { mode: "paths", origin, categories: params.categories, limit: params.limit, basePath: params.base_path },
        wctx.sender,
      )
      const r = result as MisconfigTest.PathsResult
      const count = r.report.interesting.length
      const label = count > 0 ? `${count} interesting path(s) found` : "nothing found"
      return toolResult(NAME + " paths", label, r.report)
    }

    if (!params.request_id) return err(`${params.mode} mode requires request_id.`)
    const resolved = wctx.resolve(params.request_id)
    if ("error" in resolved) return err(resolved.error)

    if (params.mode === "methods") {
      const result = await MisconfigTest.run(
        { mode: "methods", request: resolved },
        wctx.sender,
      )
      const r = result as MisconfigTest.MethodsResult
      const allowed = r.report.allowedMethods
      const label = allowed.length > 0 ? `${allowed.join(",")} allowed` : "only standard methods"
      return toolResult(NAME + " methods", label, r.report)
    }

    if (params.mode === "headers") {
      const result = await MisconfigTest.run({ mode: "headers", request: resolved }, wctx.sender)
      const r = result as MisconfigTest.HeadersResult
      const n = r.report.issues.length
      const label = n > 0 ? `${n} header issue(s)` : "security headers OK"
      return toolResult(NAME + " headers", label, r.report)
    }

    // cors
    const result = await MisconfigTest.run(
      { mode: "cors", request: resolved, origins: params.cors_origins },
      wctx.sender,
    )
    const c = result as MisconfigTest.CorsResult
    const vulnCount = c.report.vulnerable.length
    const label = vulnCount > 0 ? `${vulnCount} vulnerable origin(s)` : "no CORS misconfig"
    return toolResult(NAME + " cors", label, c.report)
  },
})
