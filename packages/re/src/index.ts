import type { Hooks, PluginInput } from "@cyberstrike-io/plugin"
import type { CoreRuntime } from "cyberstrike/public"
import { setCore, core } from "./core"
import { REProvider } from "./provider-re"

export { REProvider } from "./provider-re"

export default async function rePlugin(input: PluginInput): Promise<Hooks> {
  setCore(input.core as CoreRuntime)
  core().requireCoreApi("1.2.0")

  return {
    provider: {
      "re": () => new REProvider(),
    },
  }
}
