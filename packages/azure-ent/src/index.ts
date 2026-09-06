// @cyberstrike-io-ent/azure — Azure cloud assessment domain (paid plugin).
//
// Installed via `npm install @cyberstrike-io-ent/azure` (private registry). The
// CyberStrike plugin loader runs this default export and wires the returned
// `provider` + `tool` hooks into the host — no core edits. The azure agents +
// azurehook/cloud-intel/assess-findings tools all live in THIS package now; the
// package reaches core runtime only through `cyberstrike/public` (the versioned
// boundary) and the `@cyberstrike-io/plugin` contract.
import type { Hooks, PluginInput } from "@cyberstrike-io/plugin"
import { requireCoreApi } from "cyberstrike/public"
import { AzureProvider } from "./provider-azure"
import { AzurehookTool } from "./azurehook"
import { GetCloudIntelTool, GetCloudGroupsTool } from "./cloud-intel"
import { GetAssessGroupFindingsTool } from "./assess-findings"

export default async function azurePlugin(_input: PluginInput): Promise<Hooks> {
  // Refuse to load against an incompatible host; the loader surfaces the throw as
  // a health error for this domain instead of registering a broken domain.
  requireCoreApi("1.1.0")

  return {
    provider: {
      azure: () => new AzureProvider(),
    },
    tool: {
      azurehook: AzurehookTool,
      get_cloud_intel: GetCloudIntelTool,
      get_cloud_groups: GetCloudGroupsTool,
      get_assess_findings: GetAssessGroupFindingsTool,
    },
  }
}
