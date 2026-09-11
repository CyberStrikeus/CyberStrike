import type { AgentSpec, DomainProvider } from "@cyberstrike-io/plugin"

// iOS assessment domain provider. Template stub: no agents yet — the domain's
// specialists get added to agentSpecs() as this domain is built out (same shape as
// the other domains, so deepening one never means re-learning the contract).
export class IosProvider implements DomainProvider {
  readonly key = "ios"

  agentSpecs(): AgentSpec[] {
    return []
  }
}
