// Domain playbooks — the brain's proprietary expertise.
//
// Each domain (aws, azure, gcp, internal, mobile, web) has a playbook that
// defines: system prompt (orchestration logic), tool schemas (what the client
// can execute), and chaining rules (how to sequence actions).
//
// This is the moat. Playbooks contain pentest methodology, attack-path
// reasoning, and domain-specific chaining that never ships to the client.
export namespace Playbook {
  export interface ToolSchema {
    name: string
    description: string
    parameters: Record<string, unknown>
  }

  export interface Definition {
    domain: string
    system: string
    tools: ToolSchema[]
    maxSteps?: number
  }

  const registry = new Map<string, Definition>()

  export function register(playbook: Definition) {
    registry.set(playbook.domain, playbook)
  }

  export function resolve(domain: string): Definition | undefined {
    return registry.get(domain)
  }

  export function domains(): string[] {
    return [...registry.keys()]
  }
}
