import type { AgentSpec, DomainProvider } from "@cyberstrike-io/plugin"

import PROMPT_METHODOLOGY_COMMON from "./prompts/common-methodology.txt"
import PROMPT_METHODOLOGY_CONTINUATION from "./prompts/forced-continuation.txt"
import PROMPT_INTERNAL_NETWORK from "./prompts/internal-network.txt"

// Final composed system prompt, byte-for-byte what the agent carried while it was
// hardcoded in core's agent.ts (methodology preamble → forced-continuation →
// separator → domain prompt). specsToAgents uses spec.prompt verbatim, so the
// package composes the whole thing here.
const PROMPT = `${PROMPT_METHODOLOGY_COMMON}\n\n${PROMPT_METHODOLOGY_CONTINUATION}\n\n---\n\n${PROMPT_INTERNAL_NETWORK}`

export class InternalNetworkProvider implements DomainProvider {
  key = "internal-network"

  agentSpecs(): AgentSpec[] {
    return [
      {
        name: "internal-network",
        role: "specialist",
        description: "Internal network and Active Directory specialist. AD attacks, Kerberos, lateral movement.",
        color: "yellow",
        hidden: false,
        prompt: PROMPT,
        skills: [
          "ad-security",
          "kerberos-attacks",
          "ebpf-attacks",
          "windows-postexploit",
          "linux-postexploit",
          "macos-postexploit",
          "aws-postexploit",
          "azure-postexploit",
          "k8s-postexploit",
          "gcp-postexploit",
          "cicd-attacks",
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
          ebpf: "allow",
          winhook: "allow",
          machook: "allow",
          linuxhook: "allow",
          awshook: "allow",
          azurehook: "allow",
          kubehook: "allow",
          gcphook: "allow",
          containerhook: "allow",
          iachook: "allow",
          cloud_audit: "allow",
          k8s_audit: "allow",
          ci_audit: "allow",
          cipipe: "allow",
        },
      },
    ]
  }
}
