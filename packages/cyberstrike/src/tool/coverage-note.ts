import z from "zod"
import { Tool } from "./tool"
import { CoverageNote } from "../session/coverage-note"
import { Session } from "../session"

export const RecordCoverageNoteTool = Tool.define("record_coverage_note", {
  description:
    "Record what you tested so the orchestrator can skip re-testing it. Call this AFTER you finish " +
    "testing a vulnerability CLASS: declare the SCOPE you tested at (`asset`) plus a short note.\n" +
    "- App-wide mechanisms (JWT/token crypto, TLS, security headers, CORS, server version) are properties " +
    "of the whole deployment — set `asset` to the ORIGIN (e.g. \"https://shop.example.com\") so they are " +
    "recorded ONCE for the app and not re-tested on every endpoint.\n" +
    "- Endpoint-specific classes (IDOR, injection on a route) — set `asset` to the endpoint " +
    "(e.g. \"GET /rest/basket/{id}\").\n" +
    "The note's existence marks that cell tested. Record actual findings separately via report_vulnerability; " +
    "this tool is the coverage/'what was tested' memory, not a finding.",
  parameters: z.object({
    asset: z
      .string()
      .describe(
        "Scope you tested at. ORIGIN (scheme://host[:port]) for app-wide classes; the endpoint " +
          '(e.g. "GET /rest/basket/{id}") for endpoint-specific classes. Generic across lanes: ARN for cloud, host:port for network.',
      ),
    class: z
      .string()
      .describe("Vulnerability class you tested (e.g. authn-crypto, idor, injection, authz, mass-assignment, ssrf)."),
    note: z
      .string()
      .describe(
        'Compact prose — what you tried, the result, and any gaps. e.g. "tried alg:none (blocked on ' +
          'Authorization header but works via Cookie token -> admin), RS256->HS256 blocked, weak-secret n/a. VULN."',
      ),
    request_id: z.string().optional().describe("Optional: the request id you were testing, for traceability."),
  }),
  async execute(params, ctx) {
    const rec = CoverageNote.record({
      sessionID: Session.root(ctx.sessionID),
      asset: params.asset,
      class: params.class,
      note: params.note,
      testedBy: ctx.agent,
      requestID: params.request_id,
    })
    return {
      title: `Coverage: ${params.class} @ ${params.asset}`,
      output: `Recorded — future ${params.class} tests on ${params.asset} can be skipped. (${rec.id})`,
      metadata: { asset: params.asset, class: params.class, id: rec.id },
    }
  },
})
