// @cyberstrike-io/cloud — Cloud security specialist domain (paid plugin).
//
// Installed via `npm install @cyberstrike-io/cloud` (private registry) or
// auto-discovered when present in the workspace. The CyberStrike plugin loader runs
// this default export and wires the returned `provider` hook into the host — no core
// edits. The package reaches core runtime through the host-injected `input.core` (the
// versioned boundary) and the `@cyberstrike-io/plugin` contract — never by importing
// the host — so it works inside the compiled binary.
import type { Hooks, PluginInput } from "@cyberstrike-io/plugin"
import type { CoreRuntime } from "cyberstrike/public"
import { CloudProvider } from "./provider-cloud"

// Named re-export so the host (and tests) can source the provider directly.
export { CloudProvider } from "./provider-cloud"

export default async function cloudPlugin(input: PluginInput): Promise<Hooks> {
  // Refuse an incompatible host before registering; the loader surfaces the throw as
  // a health error for this domain instead of registering a broken one.
  ;(input.core as CoreRuntime).requireCoreApi("1.1.0")

  return {
    provider: {
      cloud: () => new CloudProvider(),
    },
  }
}
