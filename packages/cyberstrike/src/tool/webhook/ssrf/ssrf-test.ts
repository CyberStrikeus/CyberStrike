// ssrf_test — SSRF tool (plan §05). Composes the target library (./payloads), the
// response oracle (./oracle), the probe orchestrator (./probe), and the shared
// transport: pick a URL-bearing parameter, fire internal targets at it, and report
// which responses show internal-resource evidence the benign baseline did not.
// Facts + leads — confirm and weaponize yourself.
//
// The Tool.define is a thin shell; SsrfTest.run is the testable orchestration (mock
// HttpSender, no socket). NOT yet registered in tool/registry.ts — registration +
// agent wiring is a separate step.
import z from "zod"
import { Tool } from "../../tool"
import { Session } from "../../../session"
import { ReplaySender, type HttpSender, type ProbeRequest } from "../transport"
import { resolveCapturedRequest } from "../resolve"
import { SsrfPayloads, type CloudProvider, type SsrfCategory } from "./payloads"
import { SsrfProbe, detectUrlParams, type SsrfProbeReport } from "./probe"

export namespace SsrfTest {
  export interface Input {
    request: ProbeRequest
    param?: string
    categories?: SsrfCategory[]
    providers?: CloudProvider[]
    limit?: number
  }

  export interface Report {
    param: string
    detectedParams: string[]
    probe: SsrfProbeReport
  }

  /** Resolve the sink param (explicit or auto-detected), select targets, probe. */
  export async function run(input: Input, sender: HttpSender): Promise<Report | { error: string }> {
    const detected = detectUrlParams(input.request.url)
    const param = input.param ?? detected[0]
    if (!param) {
      return { error: "No URL-bearing query parameter found to test; pass `param` explicitly (SSRF sink)." }
    }
    const targets = SsrfPayloads.select({ categories: input.categories, providers: input.providers, limit: input.limit })
    const probe = await new SsrfProbe(sender).run({ request: input.request, param, targets })
    return { param, detectedParams: detected, probe }
  }
}

const CATEGORY = z.enum(["localhost", "cloud_metadata", "internal_range", "ip_bypass", "protocol", "dns_bypass"])
const PROVIDER = z.enum(["aws", "gcp", "azure", "digitalocean", "oracle", "alibaba"])

const DESCRIPTION = `Test a captured request for SSRF by firing internal targets (localhost, cloud metadata, RFC1918, IP-encoding bypasses, protocol handlers) at a URL-bearing query parameter, then reporting which responses reveal internal-resource evidence (cloud IAM creds, service banners, local-file reads) the benign baseline did not. Auto-detects the sink parameter (url/redirect/webhook/…) or takes one explicitly. Query-parameter SSRF; blind/OOB SSRF needs the callback listener. Facts + leads — confirm yourself.`

export const SsrfTestTool = Tool.define("ssrf_test", {
  description: DESCRIPTION,
  parameters: z.object({
    request_id: z.string().describe("Captured request whose URL parameter to test for SSRF."),
    param: z.string().optional().describe("The URL-bearing parameter to inject (default: auto-detected)."),
    categories: z.array(CATEGORY).optional().describe("Restrict to these target categories (default: all)."),
    providers: z.array(PROVIDER).optional().describe("Restrict cloud_metadata targets to these providers."),
    limit: z.number().int().positive().optional().describe("Cap the number of targets sent."),
  }),
  async execute(params, ctx) {
    const sessionID = Session.root(ctx.sessionID)
    const err = (output: string) => ({ title: "ssrf_test", output, metadata: {} })

    const resolved = resolveCapturedRequest(sessionID, params.request_id)
    if ("error" in resolved) return err(resolved.error)

    const report = await SsrfTest.run(
      { request: resolved, param: params.param, categories: params.categories, providers: params.providers, limit: params.limit },
      new ReplaySender({ signal: ctx.abort }),
    )
    if ("error" in report) return err(report.error)

    const hits = report.probe.hits.length
    return {
      title: hits > 0 ? `ssrf_test: ${hits} target(s) reached internal resources (verify)` : "ssrf_test: no internal resource reached",
      output: JSON.stringify(report, null, 2),
      metadata: {},
    }
  },
})
