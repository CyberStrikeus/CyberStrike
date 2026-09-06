// @cyberstrike-io-ent/azure — Azure cloud assessment domain (paid plugin).
//
// SCAFFOLD (staged extraction, docs/domain-plugin-architecture.md). The full
// AzureProvider, the azurehook tool, cloud groups, classify, and the azure
// prompts move into this package during the extraction; core keeps only the
// shared runtime, reached through `cyberstrike/public`. For now this proves a
// real workspace package builds against the two boundaries it is allowed to use:
//   - @cyberstrike-io/plugin  (contract: Hooks, DomainProvider, AgentSpec)
//   - cyberstrike/public      (runtime: version check, registry, orchestration)
//
// When installed, CyberStrike's plugin loader runs this default export and wires
// the returned `provider` + `tool` hooks into the host — no core edits.
import type { Hooks, PluginInput, DomainProvider } from "@cyberstrike-io/plugin"
import { requireCoreApi } from "cyberstrike/public"

export default async function azurePlugin(_input: PluginInput): Promise<Hooks> {
  // Refuse to load against an incompatible host instead of misbehaving; the
  // loader surfaces the throw as a health error for this domain.
  requireCoreApi("1.0.0")

  return {
    provider: {
      // The real AzureProvider (AssessmentProvider with groups/analystPrompt/…)
      // moves here. Kept a thin DomainProvider in the scaffold so the package
      // compiles against the boundary without the yet-to-be-moved azure machinery.
      azure: (): DomainProvider => ({
        key: "azure",
        agentSpecs: () => [],
      }),
    },
    // tool: { azurehook: … }  ← the azurehook tool moves here in the extraction.
  }
}
