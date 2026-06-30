import z from "zod"
import { Tool } from "./tool"
import { CoverageNote } from "../session/coverage-note"
import { Session } from "../session"

export const RecordCoverageNoteTool = Tool.define("record_coverage_note", {
  description:
    "Record what you tested so it is not re-tested. Call this AFTER you finish testing a CLASS of issue, " +
    "for BOTH outcomes (found or clean — a clean result is just as important to record). Declare the SCOPE " +
    "you tested at:\n" +
    '- `scope: "wide"` — the verdict is a property of the whole deployment/account/host, not one specific ' +
    "asset. Set `asset` to the deployment-wide identifier. Recorded ONCE and applied to every later asset " +
    "under it — do NOT re-test it per asset.\n" +
    '- `scope: "local"` — specific to this one asset (a single endpoint, resource, or service). Set `asset` ' +
    "to that asset's identifier.\n" +
    "Make a SEPARATE call for EACH distinct asset you tested — never describe two assets in one note. " +
    "The note's existence marks that cell tested. Actual findings still go via report_vulnerability; this is " +
    "the 'what was tested' memory, not a finding. Record a note only AFTER you have actually run tests for " +
    "this class and reached a verdict from the results — not from reading captured data. This note makes " +
    "later checks SKIP this class, so a verdict you guessed without testing can hide a real issue. (Your " +
    "domain-specific guidance for what counts as wide vs local, and how to format the asset, is in your own instructions.)",
  parameters: z.object({
    asset: z
      .string()
      .describe(
        "The scope identifier you tested at — copy it verbatim from your task context where shown. For " +
          "scope=wide use the deployment-wide id; for scope=local use the specific asset's id. (Examples by " +
          "domain: a web origin or endpoint, a cloud account or resource id, a host or host:port service.)",
      ),
    class: z
      .string()
      .describe(
        "The class of issue you tested (e.g. authn-crypto, idor, injection, iam-misconfig, weak-tls — whatever fits your domain).",
      ),
    scope: z
      .enum(["wide", "local"])
      .describe(
        '"wide" if the verdict applies to the whole deployment/account/host; "local" if it is specific to ' +
          "this one asset. You decide based on what you actually tested.",
      ),
    note: z
      .string()
      .describe(
        "A SHORT, simple summary of the tests you ACTUALLY RAN and the verdict they produced — a couple of lines, like a quick note, " +
          "NOT a full report (detailed evidence belongs in report_vulnerability). This note gets injected into " +
          "later agents' prompts on every request, so keep it brief: techniques tried · result · key gap.",
      ),
    request_id: z.string().optional().describe("Optional: the request/target id you were testing, for traceability."),
  }),
  async execute(params, ctx) {
    const rec = CoverageNote.record({
      sessionID: Session.root(ctx.sessionID),
      asset: params.asset,
      class: params.class,
      scope: params.scope,
      note: params.note,
      testedBy: ctx.agent,
      requestID: params.request_id,
    })
    return {
      title: `Coverage: ${params.class} @ ${params.asset} (${params.scope})`,
      output: `Recorded — ${params.class} on ${params.asset} can be skipped${params.scope === "wide" ? " across this origin" : ""}. (${rec.id})`,
      metadata: { asset: params.asset, class: params.class, scope: params.scope, id: rec.id },
    }
  },
})

export const GetCoverageNotesTool = Tool.define("get_coverage_notes", {
  description:
    "Look up what has already been tested (coverage notes), to answer 'what was done?' or to avoid repeating " +
    "work. Results are paginated (max 20 per call). Filter by `scope` (wide = deployment/account/host-wide; " +
    "local = per-asset) and/or `asset`. The wide notes relevant to your current scope are already auto-injected " +
    "into your prompt — use this only when you need more (the full list, a specific asset, or local notes).",
  parameters: z.object({
    scope: z
      .enum(["wide", "local"])
      .optional()
      .describe("Filter to wide (deployment-wide) or local (per-asset) notes."),
    asset: z.string().optional().describe("Filter to one asset identifier."),
    offset: z.number().optional().describe("Pagination offset (default 0). Add 20 to page forward."),
  }),
  async execute(params, ctx) {
    const page = CoverageNote.query({
      sessionID: Session.root(ctx.sessionID),
      scope: params.scope,
      asset: params.asset,
      offset: params.offset,
    })
    const shown = page.offset + page.notes.length
    const more = shown < page.total
    const lines = page.notes.map((n) => `- [${n.scope}/${n.class}] ${n.asset}: ${n.note}`)
    const header = `Coverage notes ${page.offset + 1}–${shown} of ${page.total}${params.scope ? ` (scope=${params.scope})` : ""}${params.asset ? ` (asset=${params.asset})` : ""}`
    const footer = more ? `\n… more — call again with offset: ${shown}` : ""
    return {
      title: `Coverage notes (${page.total})`,
      output: page.total === 0 ? "No coverage notes recorded yet." : `${header}\n${lines.join("\n")}${footer}`,
      metadata: { total: page.total, offset: page.offset, returned: page.notes.length, more },
    }
  },
})
