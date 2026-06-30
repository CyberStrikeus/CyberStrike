import z from "zod"
import { Tool } from "./tool"
import { Intel } from "../methodology/intel"
import { Session } from "../session"
import { vrtScopeViolation, offLaneMessage } from "./vuln-scope"

export const UpdateVrtCheckTool = Tool.define("update_vrt_check", {
  description:
    "Update a VRT (Vulnerability Rating Taxonomy) check for an intel entry. After testing an endpoint/parameter for a specific vulnerability category, record the result here. This feeds the coverage tracking system — every check moved from 'pending' to a tested state improves coverage.",
  parameters: z.object({
    entry_id: z.string().describe("The intel entry ID to update the VRT check for"),
    vrt_category: z.string().describe("The VRT category being tested (e.g., IDOR, XSS, SQLi, SSRF, Auth Bypass)"),
    status: z.enum(["tested_vulnerable", "tested_not_vulnerable", "not_applicable"]).describe("Result of the test"),
    technique: z
      .string()
      .optional()
      .describe("Testing technique used (e.g., 'parameter tampering', 'reflected input test')"),
    evidence: z
      .object({
        requestSent: z.string().optional().describe("The HTTP request sent (must contain HTTP verb or curl command)"),
        responseCode: z.number().optional().describe("HTTP response status code"),
        responseSummary: z
          .string()
          .optional()
          .describe(
            "Summary of the response (min 50 chars for vulnerable findings). Include actual data if exploited.",
          ),
        reasoning: z
          .string()
          .optional()
          .describe("Explanation of why this is/isn't vulnerable (min 100 chars for vulnerable findings)"),
        requestCount: z
          .number()
          .optional()
          .describe("Number of HTTP requests made during testing (min 1 for valid testing)"),
        findingRef: z.string().optional().describe("Reference to a report_vulnerability call if applicable"),
      })
      .optional()
      .describe("Evidence supporting the test result. Required for 'tested_vulnerable' status."),
  }),
  async execute(params, ctx) {
    // Lane discipline: a proxy-tester may only record VRT checks in its own
    // vulnerability class. Off-class checks are rejected (not written) with a
    // hand-off hint — structural, capability-agnostic (Phase 2).
    const violation = vrtScopeViolation(ctx.agent, params.vrt_category)
    if (violation) {
      return {
        title: `VRT rejected — ${params.vrt_category} out of ${violation.cls} scope`,
        output: offLaneMessage(violation.cls, violation.allowed, params.vrt_category),
        metadata: { entryID: params.entry_id, category: params.vrt_category, status: params.status },
      }
    }

    Intel.updateVrtCheck(Session.root(ctx.sessionID), params.entry_id, params.vrt_category, {
      status: params.status,
      technique: params.technique,
      testedBy: ctx.agent,
      evidence: params.evidence as Record<string, unknown>,
    })

    const icon =
      params.status === "tested_vulnerable"
        ? "VULNERABLE"
        : params.status === "tested_not_vulnerable"
          ? "NOT VULNERABLE"
          : "N/A"

    return {
      title: `VRT: ${params.vrt_category} — ${icon}`,
      output: `Updated VRT check for entry ${params.entry_id}: ${params.vrt_category} = ${icon}${params.technique ? ` (technique: ${params.technique})` : ""}`,
      metadata: { entryID: params.entry_id, category: params.vrt_category, status: params.status },
    }
  },
})
