import type { AgentSpec, DomainProvider } from "@cyberstrike-io/plugin"

import PROMPT_METHODOLOGY_COMMON from "./prompts/common-methodology.txt"
import PROMPT_METHODOLOGY_CONTINUATION from "./prompts/forced-continuation.txt"
import PROMPT_MOBILE_APPLICATION from "./prompts/mobile-application.txt"

// Final composed system prompt, byte-for-byte what the agent carried while it was
// hardcoded in core's agent.ts (methodology preamble → forced-continuation →
// separator → domain prompt). specsToAgents uses spec.prompt verbatim.
const PROMPT = `${PROMPT_METHODOLOGY_COMMON}\n\n${PROMPT_METHODOLOGY_CONTINUATION}\n\n---\n\n${PROMPT_MOBILE_APPLICATION}`

export class MobileProvider implements DomainProvider {
  key = "mobile"

  agentSpecs(): AgentSpec[] {
    return [
      {
        name: "mobile-application",
        role: "specialist",
        description:
          "Mobile application security specialist. Android/iOS testing, OWASP MASTG/MASVS, static/dynamic analysis, Frida/Objection.",
        color: "magenta",
        hidden: false,
        prompt: PROMPT,
        // No preloaded skills — matches the agent's pre-extraction spec (no `skills`).
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
        },
      },
    ]
  }
}
