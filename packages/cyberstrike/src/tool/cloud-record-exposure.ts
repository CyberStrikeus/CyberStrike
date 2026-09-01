import z from "zod"
import { Tool } from "./tool"
import { Session } from "../session"
import { CloudAsset, CloudExposure, ExposureType } from "../cloud/inventory"

export const CloudRecordExposureTool = Tool.define("cloud_record_exposure", {
  description: [
    "Record a public-facing attack surface on a cloud asset.",
    "Exposures are separate from the asset itself — one asset can have multiple exposures.",
    "Used for chain detection: an exposed asset connected to internal resources = lateral movement.",
    "",
    "Exposure types: " + ExposureType.options.join(", "),
  ].join("\n"),
  parameters: z.object({
    asset: z.string().describe("Asset name or ID that has this exposure"),
    asset_kind: z.string().optional().describe("Asset kind (helps resolve name to ID)"),
    type: ExposureType.describe("Type of exposure"),
    severity: z.string().describe("Severity: critical, high, medium, low, info"),
    detail: z.string().optional().describe("Specific details (e.g. 'port 22 open to 0.0.0.0/0')"),
    verified: z.boolean().optional().describe("Whether this exposure has been verified (default: false)"),
  }),
  async execute(params, ctx) {
    const sessionID = Session.root(ctx.sessionID)
    const assets = CloudAsset.list(sessionID)

    const normalized = params.asset.toLowerCase().trim()
    let target = assets.find((a) => a.id === params.asset)
    if (!target) {
      const byName = assets.filter((a) => a.name.toLowerCase().trim() === normalized)
      if (byName.length === 1) target = byName[0]
      else if (byName.length > 1 && params.asset_kind) {
        target = byName.find((a) => a.kind === params.asset_kind)
      }
      if (!target && byName.length > 0) target = byName[0]
    }

    if (!target) {
      return {
        title: "Exposure failed: asset not found",
        output: `Asset "${params.asset}" not found. Use cloud_record_asset first.`,
        metadata: { exposureID: "", duplicate: false },
      }
    }

    const result = CloudExposure.add({
      sessionID,
      assetID: target.id,
      type: params.type,
      severity: params.severity,
      detail: params.detail,
      verified: params.verified,
      sourceAgent: ctx.agent ?? "unknown",
    })

    return {
      title: result.duplicate
        ? `Exposure exists: ${params.type} on ${params.asset}`
        : `Exposure recorded: ${params.type} on ${params.asset}`,
      output: JSON.stringify({
        id: result.id,
        asset: target.name,
        type: result.type,
        severity: result.severity,
        duplicate: result.duplicate,
      }),
      metadata: { exposureID: result.id, duplicate: result.duplicate },
    }
  },
})
