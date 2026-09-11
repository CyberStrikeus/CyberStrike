// @cyberstrike-io/web — Web Application assessment domain (template stub).
//
// The CyberStrike plugin loader runs this default export and wires the returned
// provider hook into the host — no core edits. The package reaches core runtime
// through the host-injected input.core (the versioned boundary) and the
// @cyberstrike-io/plugin contract — never by importing the host — so it works
// inside the compiled binary.
import type { Hooks, PluginInput } from "@cyberstrike-io/plugin"
import type { CoreRuntime } from "cyberstrike/public"
import { setCore, core } from "./core"
import { WebProvider } from "./provider-web"

// Named re-export so the host (and tests) can source the roster directly:
// `import { WebProvider } from "@cyberstrike-io/web"`. The default export below is the
// plugin the loader runs; this is the provider class it registers.
export { WebProvider } from "./provider-web"

export default async function webPlugin(input: PluginInput): Promise<Hooks> {
  // Capture the host-injected runtime FIRST, then refuse an incompatible host.
  setCore(input.core as CoreRuntime)
  core().requireCoreApi("1.2.0")

  return {
    provider: {
      "web": () => new WebProvider(),
    },
  }
}
