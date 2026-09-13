// @cyberstrike-io/enterprise-vortex — the Enterprise bootstrap that plugs the jsmine JS-miner into
// the Vortex ingest pipeline. A cyberstrike plugin: the host's loader runs this default export at
// startup, and we register jsmine's Vortex plugin through the host-injected runtime
// (input.core.registerVortexExtractor). Reaching core via input.core (not a direct host import)
// is what makes this work in the distributed compiled binary — the versioned boundary.
//
// This package ships ONLY in the Enterprise repo. In the free build it is simply absent, so no JS
// mining is wired and the ingest extractor pass stays a no-op. Dependency direction:
// enterprise-vortex → jsmine → vortex; the free core imports none of them.
import type { Hooks, PluginInput } from "@cyberstrike-io/plugin"
import type { VortexPlugin } from "@cyberstrike-io/vortex"
import { plugin as jsminePlugin } from "@cyberstrike-io/jsmine"

// Minimal view of the host runtime this plugin needs (core API >= 1.3.0 provides
// `registerVortexExtractor`). Declared locally so the package does not couple to the host's full
// CoreRuntime type — which is published as a built .d.ts that can lag the source in a dev workspace.
interface VortexCapableCore {
  registerVortexExtractor(plugin: VortexPlugin): void
}

export default async function enterpriseVortexPlugin(input: PluginInput): Promise<Hooks> {
  const core = input.core as VortexCapableCore
  // Register jsmine's Vortex plugin (its onTransaction hook mines every JS response) onto the shared
  // ingest registry. One registration covers every session (the registry is process-wide).
  core.registerVortexExtractor(jsminePlugin())
  // No providers/tools/agents — this plugin only wires the Vortex JS-miner.
  return {}
}
