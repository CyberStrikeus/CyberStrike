// @cyberstrike-io/aws — AWS cloud assessment domain (plugin).
//
// Installed via `npm install @cyberstrike-io/aws`. The CyberStrike plugin
// loader runs this default export and wires the returned `provider` + `tool`
// hooks into the host — no core edits. The awshook tool + AWS agents +
// cloud-intel/assess-findings tools all live in THIS package; the package
// reaches core runtime through the host-injected `input.core` (the versioned
// boundary) and the `@cyberstrike-io/plugin` contract.
import type { Hooks, PluginInput } from "@cyberstrike-io/plugin"
import type { CoreRuntime } from "cyberstrike/public"
import { setCore, core } from "./core"
import { AwsProvider } from "./provider-aws"
import { AwshookTool } from "./awshook"
import { GetCloudIntelTool, GetCloudGroupsTool } from "./cloud-intel"
import { GetAssessGroupFindingsTool } from "./assess-findings"

export default async function awsPlugin(input: PluginInput): Promise<Hooks> {
  setCore(input.core as CoreRuntime)
  core().requireCoreApi("1.2.0")

  return {
    provider: {
      aws: () => new AwsProvider(),
    },
    tool: {
      awshook: AwshookTool,
      get_cloud_intel: GetCloudIntelTool,
      get_cloud_groups: GetCloudGroupsTool,
      get_assess_findings: GetAssessGroupFindingsTool,
    },
  }
}
