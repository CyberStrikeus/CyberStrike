// misconfig_test — Misconfiguration active-probe tool (plan §05). Composes the
// wordlists (backup/admin/sensitive/methods) with the shared HttpSender transport
// and the probe orchestrator. Three modes: paths, methods, cors. The P0 signal
// fabric auto-classifies every response (ExposedArtifact, DirectoryListing,
// MissingSecurityHeaders, ServerBanner, CorsMisconfig, etc.) — this tool just
// generates the traffic.
//
// Tool.define is a thin shell; MisconfigTest.run is the testable core.
// NOT registered in tool/registry.ts.
import z from "zod"
import { Tool } from "../../tool"
import { Session } from "../../../session"
import { ReplaySender, type HttpSender, type ProbeRequest } from "../transport"
import { resolveCapturedRequest } from "../resolve"
import { MisconfigProbe, type PathProbeReport, type MethodProbeReport, type CorsProbeReport } from "./probe"

export namespace MisconfigTest {
  export type Mode = "paths" | "methods" | "cors"

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

  export type Input = PathsInput | MethodsInput | CorsInput

  export interface PathsResult { mode: "paths"; report: PathProbeReport }
  export interface MethodsResult { mode: "methods"; report: MethodProbeReport }
  export interface CorsResult { mode: "cors"; report: CorsProbeReport }
  export type Result = PathsResult | MethodsResult | CorsResult

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
    }
  }
}

const CATEGORY = z.enum(["backup", "admin", "sensitive_file"])

const DESCRIPTION = `Actively probe a target for misconfigurations. Three modes:

**paths** — send GET requests for backup files (.bak/.old/.swp/~), admin panels (/admin, /wp-admin, /phpmyadmin), and sensitive files (.env, .git/HEAD, phpinfo.php, actuator, swagger) at the target origin. Flags responses that differ from the 404 baseline (200=found, 403=exists-but-blocked, 500=error leak). The signal fabric auto-classifies hits (ExposedArtifact, DirectoryListing, etc.).

**methods** — send unusual HTTP methods (TRACE, PUT, DELETE, PROPFIND, etc.) at a captured endpoint. Flags methods the server allows (not 405). TRACE enabled = XST risk; PUT/DELETE = unauthorized write.

**cors** — send Origin header variations (evil.com, subdomain confusion, null) at a captured endpoint. Flags reflected-origin + credentials=true (credential theft) or wildcard + credentials (spec violation).

Facts + leads — the agent confirms and weaponizes.`

export const MisconfigTestTool = Tool.define("misconfig_test", {
  description: DESCRIPTION,
  parameters: z.object({
    mode: z.enum(["paths", "methods", "cors"]).describe("Probe mode."),
    request_id: z.string().optional().describe("Captured request (required for methods and cors modes)."),
    origin: z.string().optional().describe("paths: target origin (e.g. https://example.com). Defaults to the request's origin if request_id given."),
    categories: z.array(CATEGORY).optional().describe("paths: restrict to these wordlist categories."),
    limit: z.number().int().positive().optional().describe("paths: cap the number of paths probed."),
    base_path: z.string().optional().describe("paths: prefix for backup suffixes (e.g. /app/config.php → /app/config.php.bak)."),
    cors_origins: z.array(z.string()).optional().describe("cors: custom Origin values to test."),
  }),
  async execute(params, ctx) {
    const sessionID = Session.root(ctx.sessionID)
    const err = (output: string) => ({ title: "misconfig_test", output, metadata: {} })

    if (params.mode === "paths") {
      let origin = params.origin
      if (!origin && params.request_id) {
        const resolved = resolveCapturedRequest(sessionID, params.request_id)
        if ("error" in resolved) return err(resolved.error)
        try { origin = new URL(resolved.url).origin } catch { return err("Could not extract origin from request.") }
      }
      if (!origin) return err("paths mode requires origin or request_id.")

      const result = await MisconfigTest.run(
        { mode: "paths", origin, categories: params.categories, limit: params.limit, basePath: params.base_path },
        new ReplaySender({ signal: ctx.abort }),
      )
      const r = result as MisconfigTest.PathsResult
      const count = r.report.interesting.length
      return {
        title: count > 0 ? `misconfig_test paths: ${count} interesting path(s) found` : "misconfig_test paths: nothing found",
        output: JSON.stringify(r.report, null, 2),
        metadata: {},
      }
    }

    if (!params.request_id) return err(`${params.mode} mode requires request_id.`)
    const resolved = resolveCapturedRequest(sessionID, params.request_id)
    if ("error" in resolved) return err(resolved.error)

    if (params.mode === "methods") {
      const result = await MisconfigTest.run(
        { mode: "methods", request: resolved },
        new ReplaySender({ signal: ctx.abort }),
      )
      const r = result as MisconfigTest.MethodsResult
      const allowed = r.report.allowedMethods
      return {
        title: allowed.length > 0 ? `misconfig_test methods: ${allowed.join(",")} allowed` : "misconfig_test methods: only standard methods",
        output: JSON.stringify(r.report, null, 2),
        metadata: {},
      }
    }

    // cors
    const result = await MisconfigTest.run(
      { mode: "cors", request: resolved, origins: params.cors_origins },
      new ReplaySender({ signal: ctx.abort }),
    )
    const c = result as MisconfigTest.CorsResult
    const vulnCount = c.report.vulnerable.length
    return {
      title: vulnCount > 0 ? `misconfig_test cors: ${vulnCount} vulnerable origin(s)` : "misconfig_test cors: no CORS misconfig",
      output: JSON.stringify(c.report, null, 2),
      metadata: {},
    }
  },
})
