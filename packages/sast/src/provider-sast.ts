import type { AgentSpec, DomainProvider } from "@cyberstrike-io/plugin"

// SAST (Static Application Security Testing) domain provider. Template stub: no agents yet — the domain's
// specialists get added to agentSpecs() as this domain is built out (same shape as the other domains, so
// deepening one never means re-learning the contract).
export class SastProvider implements DomainProvider {
  readonly key = "sast"

  agentSpecs(): AgentSpec[] {
    return []
  }
}
