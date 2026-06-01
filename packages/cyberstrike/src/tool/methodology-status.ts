import z from "zod"
import { Tool } from "./tool"
import { Methodology } from "../methodology/methodology"
import { Intel } from "../methodology/intel"
import { Chain } from "../methodology/chain"
import { Validation } from "../methodology/validation"
import { Session } from "../session"

export const MethodologyStatusTool = Tool.define("methodology_status", {
  description:
    "Get the current methodology state, coverage report, chain opportunities, and validation status. Use this to check progress, identify gaps, and decide what to test next. Shows which phases are complete, which have blocking violations, per-asset coverage, and detected vulnerability chains.",
  parameters: z.object({
    include_validation: z
      .boolean()
      .optional()
      .default(false)
      .describe("Include full validation gate results (evidence quality, triager checks)"),
    scope_items: z
      .array(z.string())
      .optional()
      .describe("Scope items for validation gates (domains, wildcards, CIDRs)"),
  }),
  async execute(params, ctx) {
    const rootSession = Session.root(ctx.sessionID)
    const state = Methodology.computeState(rootSession)
    const coverage = Intel.computeCoverage(rootSession)
    const chains = Chain.load(rootSession)

    const sections: string[] = []

    // 1. Methodology progress
    sections.push(Methodology.formatForPrompt(rootSession))

    // 2. Coverage
    sections.push("")
    sections.push(Intel.formatCoverageForPrompt(coverage))

    // 3. Chains
    const chainPrompt = Chain.formatForPrompt(chains)
    if (chainPrompt) {
      sections.push("")
      sections.push(chainPrompt)
    }

    // 4. Validation gates (optional)
    if (params.include_validation) {
      const scopeItems = params.scope_items ?? []
      const gates = Validation.runAllGates(rootSession, scopeItems)
      sections.push("")
      sections.push(gates.summary)
    }

    // 5. Per-asset coverage
    const assetCoverages = Intel.computePerAssetCoverage(rootSession)
    if (assetCoverages.length > 0) {
      sections.push("")
      sections.push("## Per-Asset Coverage")
      for (const ac of assetCoverages) {
        sections.push(`- ${ac.asset}: ${ac.coveragePercent}% (${ac.completedChecks}/${ac.totalChecks} checks, ${ac.vulnerableChecks} vuln)`)
      }
    }

    // 6. Next steps
    if (state.currentPhase) {
      const directives = Methodology.getPhaseDirectives(state.currentPhase)
      if (directives) {
        sections.push("")
        sections.push("## Next Steps")
        sections.push(directives)
      }
    }

    return {
      title: `Methodology: ${state.completionPercent}% | Coverage: ${coverage.coveragePercent}%`,
      output: sections.join("\n"),
      metadata: {
        completionPercent: state.completionPercent,
        coveragePercent: coverage.coveragePercent,
        totalEntries: coverage.totalEntries,
        activeChains: chains.filter((c) => c.status === "detected" || c.status === "testing").length,
        blockingViolations: state.violations.filter((v) => v.severity === "blocking").length,
      },
    }
  },
})
