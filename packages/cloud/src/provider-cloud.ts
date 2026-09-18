import type { AgentSpec, DomainProvider } from "@cyberstrike-io/plugin"

import PROMPT_METHODOLOGY_COMMON from "./prompts/common-methodology.txt"
import PROMPT_METHODOLOGY_CONTINUATION from "./prompts/forced-continuation.txt"
import PROMPT_CLOUD_SECURITY from "./prompts/cloud-security.txt"

// Final composed system prompt, byte-for-byte what the agent carried while it was
// hardcoded in core's agent.ts (methodology preamble → forced-continuation →
// separator → domain prompt). specsToAgents uses spec.prompt verbatim.
const PROMPT = `${PROMPT_METHODOLOGY_COMMON}\n\n${PROMPT_METHODOLOGY_CONTINUATION}\n\n---\n\n${PROMPT_CLOUD_SECURITY}`

export class CloudProvider implements DomainProvider {
  key = "cloud"

  agentSpecs(): AgentSpec[] {
    return [
      {
        name: "cloud-security",
        role: "specialist",
        description: "Cloud security specialist. AWS, Azure, GCP security testing. IAM, CIS benchmarks.",
        color: "cyan",
        hidden: false,
        prompt: PROMPT,
        skills: [
          "cis-aws-foundations-2.1.1",
          "cis-aws-foundations-2.2",
          "cis-aws-foundations-3.1.1",
          "cis-aws-foundations-4.1",
          "cis-aws-foundations-5.1",
          "cis-aws-foundations-6.2",
          "aws-postexploit",
          "azure-postexploit",
          "k8s-postexploit",
          "gcp-postexploit",
          "cloud-assessment",
          "k8s-assessment",
          "ci-assessment",
        ],
        permissions: {
          question: "allow",
          bash: "allow",
          hackbrowser: "allow",
          read: "allow",
          glob: "allow",
          grep: "allow",
          report_vulnerability: "allow",
          triage_vulnerability: "allow",
          add_intel: "allow",
          update_vrt_check: "allow",
          methodology_status: "allow",
          scope_check: "allow",
          ensure_tools: "allow",
          attack_script: "allow",
          awshook: "allow",
          azurehook: "allow",
          kubehook: "allow",
          gcphook: "allow",
          containerhook: "allow",
          iachook: "allow",
          cloud_audit: "allow",
          k8s_audit: "allow",
          ci_audit: "allow",
        },
      },
    ]
  }
}
