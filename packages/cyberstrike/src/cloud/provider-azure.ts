import type { AssessmentProvider } from "./provider"
import type { CloudAnalysis } from "./types"
import type { ClassifiedGroup } from "./classify"
import { CLOUD_GROUPS, identityGroup as azureIdentityGroup, parallelGroups as azureParallelGroups } from "./groups"
import { getAssessResult } from "../tool/azurehook/assess-cache"
import { classifyGroupFindings } from "./classify"
import { Intel } from "../methodology/intel"
import { triageGuide, triageActions } from "../session/vulnerability-status"

export class AzureProvider implements AssessmentProvider {
  key = "azure"

  groups() {
    return CLOUD_GROUPS
  }

  identityGroup() {
    return azureIdentityGroup()
  }

  parallelGroups() {
    return azureParallelGroups()
  }

  validate(rootSession: string) {
    const result = getAssessResult(rootSession)
    if (!result) return { ok: false as const, reason: "No assessment results cached. Run azurehook azure_assess first — results are lost on process restart." }
    if (!result.authOk) return { ok: false as const, reason: "Last assessment failed authentication." }
    return { ok: true as const, totalFindings: result.findings.length }
  }

  findingCount(rootSession: string, groupKey: string) {
    const result = getAssessResult(rootSession)
    if (!result) return 0
    return result.phases.flatMap((p) => p.groups).filter((g) => g.key === groupKey).flatMap((g) => g.findings).length
  }

  classify(rootSession: string, groups: CloudAnalysis.GroupDef[]) {
    const result = getAssessResult(rootSession)
    if (!result) return []
    const groupFindings = groups.map((g) => {
      const gResults = result.phases.flatMap((p) => p.groups).filter((r) => r.key === g.key)
      return { key: g.key, findings: gResults.flatMap((r) => r.findings) }
    })
    return classifyGroupFindings(groupFindings)
  }

  analystPrompt(group: CloudAnalysis.GroupDef, identityContext: string, slice?: string) {
    const sliceArg = slice ? `, slice: '${slice}'` : ""
    const sliceNote = slice ? `\nYou are agent ${slice} for this group — only analyze the findings in your slice.` : ""
    return [
      `Analyze the ${group.key} group findings.${sliceNote}`,
      `Call get_assess_findings(group: '${group.key}'${sliceArg}) to retrieve your Layer 1 findings.`,
      "",
      `## Workflow`,
      `1. ENRICH FIRST: For each Layer 1 finding, verify it and use enrich_vulnerability(id, steps_to_reproduce, poc, ...) to add details to the EXISTING record. This updates the skeleton in place — no duplicate is created.`,
      `2. NEW FINDINGS: Only use report_vulnerability for genuinely NEW issues not already in the Layer 1 findings.`,
      `3. Run additional azurehook programs if needed to verify or discover more issues.`,
      "",
      `Use add_intel to record significant discoveries. Tag entries with group:${group.key}.`,
      "",
      `You have relevant skills loaded — use the \`skill\` tool to search and load cloud-specific skills (azure-postexploit, cloud-assessment, etc.) for detailed methodology when verifying findings.`,
      "",
      identityContext ? `## Identity Context\n${identityContext}` : "",
    ].filter(Boolean).join("\n")
  }

  batchPrompt(groupKeys: string[], identityContext: string) {
    return [
      `Rapidly triage formulaic findings across these groups: ${groupKeys.join(", ")}`,
      "",
      "For each group, call `get_assess_findings(group: '<key>')` to see findings with their triage status and vulnerability IDs.",
      `Triage each finding using triage_vulnerability with one of: ${triageActions()}.`,
      "",
      "Status guide:",
      triageGuide(),
      "",
      "**Escalation:** If a finding turns out to be MORE complex than expected (e.g. involves privilege escalation, lateral movement, or cross-group chain potential), do NOT attempt deep investigation. Instead, call `add_intel` with title starting with `ESCALATE:` and describe why it needs deeper analysis. The orchestrator will route it to a follow-up agent.",
      "",
      identityContext ? `## Identity Context\n${identityContext}` : "",
    ].filter(Boolean).join("\n")
  }

  verifyPrompt(summary: string) {
    return [
      "Review all cloud intel and reported vulnerabilities. Check for false positives, verify severity ratings, confirm attack chains are documented.",
      "",
      "Use cloud_get_context(include_chains: true) to review the structured inventory graph and auto-detected chains. Use get_cloud_intel for text-based intel. Use the `skill` tool to load relevant skills (cloud-assessment, azure-postexploit) for CIS compliance checks.",
      "",
      "## Orchestration Context",
      summary,
      "",
      "Pay special attention to failed/timed-out analysts — their groups may have incomplete coverage. Check if any findings from those groups were missed.",
    ].join("\n")
  }

  identityContext(rootSession: string) {
    const entries = Intel.get(rootSession)
    const identity = entries.filter((e) => e.tags.includes("group:identity"))
    if (identity.length === 0) return ""
    const lines = ["Identity analysis found:"]
    for (const e of identity.slice(0, 20)) {
      lines.push(`- [${e.severity ?? "info"}] ${e.title}`)
      if (e.chainPotential) lines.push(`  Chain: ${e.chainPotential}`)
    }
    return lines.join("\n")
  }
}
