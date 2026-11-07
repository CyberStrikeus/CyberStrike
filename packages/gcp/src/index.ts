// @cyberstrike-io/gcp — GCP cloud assessment domain (plugin).
//
// Installed via `npm install @cyberstrike-io/gcp`. The CyberStrike plugin
// loader runs this default export and wires the returned `provider` + `tool`
// hooks into the host — no core edits. The gcphook tool + GCP agents +
// cloud-intel/assess-findings tools all live in THIS package; the package
// reaches core runtime through the host-injected `input.core` (the versioned
// boundary) and the `@cyberstrike-io/plugin` contract.
import type { Hooks, PluginInput } from "@cyberstrike-io/plugin"
import type { CoreRuntime } from "cyberstrike/public"
import { setCore, core } from "./core"
import { GcpProvider } from "./provider-gcp"
import { GcphookTool } from "./gcphook"
import { GetCloudIntelTool, GetCloudGroupsTool } from "./cloud-intel"
import { GetAssessGroupFindingsTool } from "./assess-findings"

export default async function gcpPlugin(input: PluginInput): Promise<Hooks> {
  setCore(input.core as CoreRuntime)
  core().requireCoreApi("1.2.0")

  return {
    provider: {
      gcp: () => new GcpProvider(),
    },
    tool: {
      gcphook: GcphookTool,
      get_cloud_intel: GetCloudIntelTool,
      get_cloud_groups: GetCloudGroupsTool,
      get_assess_findings: GetAssessGroupFindingsTool,
    },
  }
}
