import z from "zod"
import { Tool } from "./tool"
import { Intel } from "../methodology/intel"
import { Chain } from "../methodology/chain"
import { Session } from "../session"

export const AddIntelTool = Tool.define("add_intel", {
  description:
    "Add an intelligence entry discovered during security testing. Use this to log discovered endpoints, subdomains, technologies, credentials, parameters, and other findings. Each entry automatically gets a VRT (Vulnerability Rating Taxonomy) checklist for systematic testing. Always use this tool to record discoveries — it feeds the methodology engine, coverage tracking, and chain detection.",
  parameters: z.object({
    type: Intel.Type.describe(
      "Type of intelligence entry: endpoint, subdomain, technology, credential, parameter, vulnerability_hint, configuration, api_schema, authentication_flow, business_rule, sensitive_data, infrastructure",
    ),
    title: z.string().describe("Short descriptive title for the finding"),
    asset: z.string().describe("Target domain, IP, or URL this entry belongs to"),
    severity: Intel.Severity.optional().describe("Severity assessment: critical, high, medium, low, info"),
    detail: z
      .string()
      .optional()
      .describe(
        "Detailed description with evidence. For exploited entries, must be >= 50 chars with real data references.",
      ),
    confidence_level: Intel.Confidence.optional().describe(
      "How confident are you in this finding: confirmed (verified with evidence), high, medium, low",
    ),
    tags: z
      .array(z.string())
      .optional()
      .describe(
        "Tags for methodology tracking. Use phase tags like: scope-analysis, passive-recon, active-recon, technology, auth-testing, session-testing, authz-testing, input-validation, business-logic, api-security",
      ),
    chain_potential: z
      .string()
      .optional()
      .describe("If this finding could chain with others, describe the potential chain"),
    related_entries: z.array(z.string()).optional().describe("IDs of related intel entries that could form a chain"),
    target_class: z
      .string()
      .optional()
      .describe(
        "For a vulnerability_hint handed off to another specialist: the target tester class (e.g. ssrf, idor, file-attacks). Lets the orchestrator route the hint to the right specialist instead of testing it yourself.",
      ),
  }),
  async execute(params, ctx) {
    // Carry hint-routing intent on the existing tags channel (no schema change):
    // a `target:<class>` tag the orchestrator can read to route the hint.
    const tags = params.target_class ? [...(params.tags ?? []), `target:${params.target_class}`] : params.tags
    const result = Intel.add({
      sessionID: Session.root(ctx.sessionID),
      data: {
        type: params.type,
        severity: params.severity,
        title: params.title,
        detail: params.detail,
        source: ctx.agent,
        asset: params.asset,
        confidenceLevel: params.confidence_level,
        tags,
        chainPotential: params.chain_potential,
        relatedEntries: params.related_entries,
      },
    })

    if (result.duplicate)
      return {
        title: "Duplicate intel entry",
        output: `Entry already exists: "${result.title}" for asset "${result.asset}". ID: ${result.id}`,
        metadata: { entryID: result.id, vrtChecks: 0, chains: 0 },
      }

    // Auto-detect chains after adding
    const chains = Chain.detectAndPersist(Session.root(ctx.sessionID))
    const newChains = chains.filter((c) => c.status === "detected")

    const output = [
      `Intel entry added: ${result.id}`,
      `Type: ${result.type} | Asset: ${result.asset} | Confidence: ${result.confidenceLevel}`,
      `VRT checks created: ${result.vrtChecksCreated}`,
    ]
    if (newChains.length > 0) {
      output.push(`Chain opportunities detected: ${newChains.length}`)
      for (const c of newChains.slice(0, 3)) {
        output.push(`  - ${c.pattern}: ${c.entryTitles.join(" + ")} -> ${c.expectedImpact}`)
      }
    }

    return {
      title: `Intel: ${result.title}`,
      output: output.join("\n"),
      metadata: { entryID: result.id, vrtChecks: result.vrtChecksCreated, chains: newChains.length },
    }
  },
})
