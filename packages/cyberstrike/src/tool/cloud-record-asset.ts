import z from "zod"
import { Tool } from "./tool"
import { Session } from "../session"
import { CloudAsset, AssetKind } from "../cloud/inventory"

export const CloudRecordAssetTool = Tool.define("cloud_record_asset", {
  description: [
    "Record a discovered cloud resource or identity in the structured inventory.",
    "Every cloud analyst should use this instead of add_intel for cloud-specific objects.",
    "Duplicates are detected by (kind, name) — calling with the same name merges properties.",
    "",
    "Asset kinds: " + AssetKind.options.join(", "),
  ].join("\n"),
  parameters: z.object({
    kind: AssetKind.describe("The type of cloud resource or identity"),
    name: z.string().describe("Resource name (e.g. 'vm-prod-01', 'sp-deploy-pipeline')"),
    resource_id: z.string().optional().describe("Full Azure resource ID (/subscriptions/...)"),
    subscription: z.string().optional().describe("Subscription name or ID"),
    resource_group: z.string().optional().describe("Resource group name"),
    region: z.string().optional().describe("Azure region (e.g. eastus, westeurope)"),
    properties: z.record(z.string(), z.unknown()).optional().describe("Additional properties (e.g. { os: 'ubuntu', publicIP: '1.2.3.4' })"),
  }),
  async execute(params, ctx) {
    const sessionID = Session.root(ctx.sessionID)
    const agent = ctx.agent ?? "unknown"
    const result = CloudAsset.add({
      sessionID,
      kind: params.kind,
      name: params.name,
      resourceID: params.resource_id,
      subscription: params.subscription,
      resourceGroup: params.resource_group,
      region: params.region,
      properties: params.properties,
      group: agent.replace("cloud-analyst-", ""),
      sourceAgent: agent,
    })

    return {
      title: result.duplicate
        ? `Asset merged: ${params.kind}/${params.name}`
        : `Asset recorded: ${params.kind}/${params.name}`,
      output: JSON.stringify({
        id: result.id,
        kind: result.kind,
        name: result.name,
        duplicate: result.duplicate,
        properties: result.properties,
      }),
      metadata: { assetID: result.id, duplicate: result.duplicate },
    }
  },
})
