import type { AssessmentProvider, AgentSpec } from "./provider"
import type { CloudAnalysis } from "./types"
import { CLOUD_GROUPS, identityGroup as azureIdentityGroup, parallelGroups as azureParallelGroups } from "./groups"
import { getAssessResult } from "../tool/azurehook/assess-cache"
import { classifyGroupFindings } from "./classify"
import { Intel } from "../methodology/intel"
import { triageGuide, triageActions } from "../session/vulnerability-status"

import PROMPT_CLOUD_ANALYST_COMMON from "../agent/prompt/cloud/analyst-common.txt"
import PROMPT_CLOUD_ORCHESTRATOR from "../agent/prompt/cloud/orchestrator.txt"
import PROMPT_CLOUD_VERIFY from "../agent/prompt/cloud/verify.txt"
import PROMPT_CLOUD_BATCH_VERIFIER from "../agent/prompt/cloud/batch-verifier.txt"

const ANALYST_PERMISSIONS: Record<string, "ask" | "allow" | "deny"> = {
  bash: "allow", read: "allow", glob: "allow", grep: "allow",
  azurehook: "allow", awshook: "allow", kubehook: "allow", gcphook: "allow",
  add_intel: "allow", get_cloud_intel: "allow", get_cloud_groups: "allow",
  get_assess_findings: "allow", report_vulnerability: "allow",
  triage_vulnerability: "allow", update_vrt_check: "allow",
  methodology_status: "allow", skill: "allow",
}

const GROUP_SKILLS: Record<string, string[]> = {
  identity: ["azure-postexploit", "cloud-assessment", "ad-security"],
  compute: ["azure-postexploit", "cloud-assessment", "k8s-assessment"],
  network: ["cloud-assessment", "azure-postexploit"],
  data: ["azure-postexploit", "cloud-assessment"],
  security: ["cloud-assessment", "azure-postexploit"],
  access: ["azure-postexploit", "cloud-assessment", "ad-security"],
  specialized: ["azure-postexploit", "cloud-assessment", "k8s-assessment"],
  compliance: ["cloud-assessment", "azure-postexploit", "ci-assessment"],
  exposure: ["cloud-assessment", "azure-postexploit", "attack-subdomain-takeover"],
}

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
      `## Scaling`,
      `If you have more findings than you can thoroughly verify within your time limit, call add_intel with title "SCALE:${group.key}" and body describing what remains. The orchestrator will spawn a helper agent to handle remaining draft findings.`,
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

  followupPrompt(chain: CloudAnalysis.FollowUp) {
    return chain.prompt
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

  agentSpecs(): AgentSpec[] {
    for (const g of CLOUD_GROUPS) {
      if (!GROUP_SKILLS[g.key]) console.warn(`[azure-provider] GROUP_SKILLS missing for group "${g.key}" — using generic fallback`)
    }
    const analysts: AgentSpec[] = CLOUD_GROUPS.map((g) => ({
      name: g.analyst,
      role: "analyst" as const,
      group: g.key,
      description: `Cloud analyst: ${g.label}. ${g.description}`,
      steps: 30,
      color: "cyan",
      prompt: `${PROMPT_CLOUD_ANALYST_COMMON}\n\n---\n\n## Your Group: ${g.label}\n\nYou own the **${g.key}** group.\nPrograms in your group: ${g.programs.join(", ")}\n\n${g.description}`,
      skills: GROUP_SKILLS[g.key] ?? ["cloud-assessment", "azure-postexploit"],
      permissions: ANALYST_PERMISSIONS,
    }))

    return [
      ...analysts,
      {
        name: "cloud-orchestrator",
        role: "orchestrator",
        description: "Cloud assessment orchestrator. Dispatches analyst subagents, coordinates cross-group correlation, runs verification.",
        steps: 40,
        color: "cyan",
        prompt: PROMPT_CLOUD_ORCHESTRATOR,
        skills: [],
        permissions: {
          "*": "deny",
          task: "allow", question: "allow",
          get_cloud_intel: "allow", get_cloud_groups: "allow",
          get_assess_findings: "allow", web_get_vuln_detail: "allow",
          triage_vulnerability: "allow", methodology_status: "allow",
        },
      },
      {
        name: "cloud-followup",
        role: "followup",
        description: "Cloud follow-up agent for verifying cross-group attack chains.",
        steps: 20,
        color: "cyan",
        prompt: [
          PROMPT_CLOUD_ANALYST_COMMON,
          "\n\n---\n\n## Your Role: Follow-up Verification\n\n",
          "You are a targeted verifier. The orchestrator detected a cross-group attack chain and dispatched you to confirm it.\n\n",
          "Your job:\n",
          "1. Verify each link in the chain by running the relevant azurehook programs\n",
          "2. Confirm the full chain is exploitable end-to-end\n",
          "3. Report the chain as a vulnerability if confirmed, with the full attack path\n",
          "4. Record the chain via add_intel with type \"attack_path\"\n\n",
          "Use the `skill` tool to load relevant skills for the chain you are verifying.",
        ].join(""),
        skills: ["azure-postexploit", "cloud-assessment"],
        permissions: {
          bash: "allow", read: "allow",
          azurehook: "allow", awshook: "allow", kubehook: "allow", gcphook: "allow",
          add_intel: "allow", get_cloud_intel: "allow",
          report_vulnerability: "allow", triage_vulnerability: "allow",
          skill: "allow",
        },
      },
      {
        name: "cloud-verify",
        role: "verifier",
        description: "Cloud verification agent. Final validation of all cloud findings before presentation.",
        steps: 20,
        color: "cyan",
        prompt: PROMPT_CLOUD_VERIFY,
        skills: ["cloud-assessment", "azure-postexploit"],
        permissions: {
          bash: "allow", read: "allow",
          azurehook: "allow",
          get_cloud_intel: "allow", get_assess_findings: "allow",
          web_get_vuln_detail: "allow", triage_vulnerability: "allow",
          methodology_status: "allow", skill: "allow",
        },
      },
      {
        name: "cloud-batch-verifier",
        role: "batch-verifier",
        description: "Rapid batch verifier for formulaic cloud findings. Single-pass triage without deep investigation.",
        steps: 15,
        color: "cyan",
        prompt: PROMPT_CLOUD_BATCH_VERIFIER,
        skills: ["cloud-assessment"],
        permissions: {
          bash: "allow", read: "allow",
          azurehook: "allow",
          get_assess_findings: "allow", get_cloud_intel: "allow",
          add_intel: "allow", triage_vulnerability: "allow",
          skill: "allow",
        },
      },
    ]
  }
}
