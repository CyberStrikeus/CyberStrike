import z from "zod"
import { Tool } from "../../tool"
import { Session } from "../../../session"
import { Request } from "../../../session/request"
import { ReplaySender, type HttpSender } from "../transport"
import { ReconProbe, type MetafileReport, type FingerprintReport, type LeakageReport } from "./probe"

export namespace ReconTest {
  export type Mode = "metafiles" | "fingerprint" | "leakage"

  export interface MetafilesInput {
    mode: "metafiles"
    origin: string
    limit?: number
  }

  export interface FingerprintInput {
    mode: "fingerprint"
    origin: string
    limit?: number
  }

  export interface LeakageInput {
    mode: "leakage"
    url: string
    body: string
  }

  export type Input = MetafilesInput | FingerprintInput | LeakageInput

  export interface MetafilesResult { mode: "metafiles"; report: MetafileReport }
  export interface FingerprintResult { mode: "fingerprint"; report: FingerprintReport }
  export interface LeakageResult { mode: "leakage"; report: LeakageReport }
  export type Result = MetafilesResult | FingerprintResult | LeakageResult

  export async function run(input: Input, sender: HttpSender): Promise<Result> {
    const probe = new ReconProbe(sender)

    switch (input.mode) {
      case "metafiles": {
        const report = await probe.metafiles({ origin: input.origin, limit: input.limit })
        return { mode: "metafiles", report }
      }
      case "fingerprint": {
        const report = await probe.fingerprint({ origin: input.origin, limit: input.limit })
        return { mode: "fingerprint", report }
      }
      case "leakage": {
        const report = probe.leakage({ url: input.url, body: input.body })
        return { mode: "leakage", report }
      }
    }
  }
}

const DESCRIPTION = `Actively probe a target for reconnaissance data. Three modes:

**metafiles** — fetch and PARSE well-known metafiles (robots.txt, sitemap.xml, security.txt, openapi.json, swagger.json, crossdomain.xml, etc.) at the target origin. Returns extracted URLs, disallowed paths, and raw previews. Goes beyond existence checking — parses content to extract actionable intelligence (sitemap URLs, disallowed paths, API endpoints).

**fingerprint** — send requests to technology-specific paths (wp-login.php, /actuator/info, /server-status, Django debug, etc.) and match evidence patterns in responses. Returns detected technologies and frameworks. Active tech detection, not passive header sniffing.

**leakage** — scan a response body for information leakage: HTML comments (developer notes, TODO/FIXME, internal paths), internal IP addresses (RFC1918), version strings, email addresses, debug flags. Run this against interesting pages discovered by metafiles or the crawler.

Facts + leads — the agent confirms and prioritizes.`

export const ReconTestTool = Tool.define("recon_test", {
  description: DESCRIPTION,
  parameters: z.object({
    mode: z.enum(["metafiles", "fingerprint", "leakage"]).describe("Probe mode."),
    request_id: z.string().optional().describe("Captured request — used to derive origin (metafiles/fingerprint) or body (leakage)."),
    origin: z.string().optional().describe("metafiles/fingerprint: target origin (e.g. https://example.com). Defaults to the request's origin if request_id given."),
    limit: z.number().int().positive().optional().describe("metafiles/fingerprint: cap the number of probes sent."),
    body: z.string().optional().describe("leakage: response body to scan. If omitted with request_id, fetches the request's URL and scans that response."),
  }),
  async execute(params, ctx) {
    const sessionID = Session.root(ctx.sessionID)
    const err = (output: string) => ({ title: "recon_test", output, metadata: {} })

    if (params.mode === "metafiles" || params.mode === "fingerprint") {
      let origin = params.origin
      if (!origin && params.request_id) {
        const request = Request.get(sessionID).find((r) => r.id === params.request_id)
        if (!request) return err(`Request "${params.request_id}" not found.`)
        origin = request.origin ?? (request.host ? `${request.scheme ?? "http"}://${request.host}` : undefined)
      }
      if (!origin) return err(`${params.mode} mode requires origin or request_id.`)

      const sender = new ReplaySender({ signal: ctx.abort })

      if (params.mode === "metafiles") {
        const result = await ReconTest.run({ mode: "metafiles", origin, limit: params.limit }, sender)
        const r = result as ReconTest.MetafilesResult
        const found = r.report.results.filter((x) => x.found).length
        return {
          title: found > 0 ? `recon_test metafiles: ${found} file(s) found, ${r.report.allUrls.length} URL(s) extracted` : "recon_test metafiles: no metafiles found",
          output: JSON.stringify(r.report, null, 2),
          metadata: {},
        }
      }

      const result = await ReconTest.run({ mode: "fingerprint", origin, limit: params.limit }, sender)
      const r = result as ReconTest.FingerprintResult
      const tech = r.report.detectedTech
      return {
        title: tech.length > 0 ? `recon_test fingerprint: ${tech.join(", ")} detected` : "recon_test fingerprint: no technologies detected",
        output: JSON.stringify(r.report, null, 2),
        metadata: {},
      }
    }

    // leakage mode
    let body = params.body
    let url = "unknown"
    if (!body && params.request_id) {
      const request = Request.get(sessionID).find((r) => r.id === params.request_id)
      if (!request) return err(`Request "${params.request_id}" not found.`)
      const reqOrigin = request.origin ?? `${request.scheme ?? "http"}://${request.host ?? ""}`
      url = `${reqOrigin}${request.normalized_path}`
      const sender = new ReplaySender({ signal: ctx.abort })
      const resp = await sender.send({ method: "GET", url, headers: {} })
      if ("error" in resp) return err(`Could not fetch ${url}: ${resp.error}`)
      body = resp.body
    }
    if (!body) return err("leakage mode requires body text or request_id to fetch.")

    if (params.origin) url = params.origin

    const result = await ReconTest.run({ mode: "leakage", url, body }, new ReplaySender({ signal: ctx.abort }))
    const r = result as ReconTest.LeakageResult
    const total = r.report.comments.length + r.report.findings.length
    return {
      title: total > 0 ? `recon_test leakage: ${r.report.comments.length} comment(s), ${r.report.findings.length} finding(s)` : "recon_test leakage: no leakage found",
      output: JSON.stringify(r.report, null, 2),
      metadata: {},
    }
  },
})
