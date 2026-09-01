import z from "zod"
import { Tool } from "./tool"
import { Session } from "../session"
import { CloudAsset, CloudEdge, EdgeType } from "../cloud/inventory"

export const CloudRecordEdgeTool = Tool.define("cloud_record_edge", {
  description: [
    "Record a relationship between two cloud assets in the inventory graph.",
    "Edges enable deterministic chain detection — the graph reveals attack paths automatically.",
    "Both assets must exist (use cloud_record_asset first). Duplicates are detected by (from, to, type).",
    "",
    "Edge types: " + EdgeType.options.join(", "),
  ].join("\n"),
  parameters: z.object({
    from: z.string().describe("Source asset name or ID"),
    to: z.string().describe("Target asset name or ID"),
    type: EdgeType.describe("Relationship type"),
    from_kind: z.string().optional().describe("Source asset kind (helps resolve name to ID)"),
    to_kind: z.string().optional().describe("Target asset kind (helps resolve name to ID)"),
    evidence: z.string().optional().describe("Evidence or context for this relationship"),
    severity: z.string().optional().describe("Severity implication of this edge (critical/high/medium/low/info)"),
  }),
  async execute(params, ctx) {
    const sessionID = Session.root(ctx.sessionID)
    const assets = CloudAsset.list(sessionID)

    const resolve = (ref: string, kindHint?: string): string | undefined => {
      const byId = assets.find((a) => a.id === ref)
      if (byId) return byId.id
      const normalized = ref.toLowerCase().trim()
      const byName = assets.filter((a) => a.name.toLowerCase().trim() === normalized)
      if (byName.length === 1) return byName[0]!.id
      if (byName.length > 1 && kindHint) {
        const exact = byName.find((a) => a.kind === kindHint)
        if (exact) return exact.id
      }
      return byName[0]?.id
    }

    const fromID = resolve(params.from, params.from_kind)
    const toID = resolve(params.to, params.to_kind)

    if (!fromID || !toID) {
      const missing = !fromID ? params.from : params.to
      return {
        title: `Edge failed: asset not found`,
        output: `Asset "${missing}" not found. Use cloud_record_asset first.`,
        metadata: { edgeID: "", duplicate: false },
      }
    }

    const result = CloudEdge.add({
      sessionID,
      fromAssetID: fromID,
      toAssetID: toID,
      type: params.type,
      evidence: params.evidence,
      severity: params.severity,
      sourceAgent: ctx.agent ?? "unknown",
    })

    return {
      title: result.duplicate
        ? `Edge exists: ${params.from} → ${params.to}`
        : `Edge recorded: ${params.from} --${params.type}--> ${params.to}`,
      output: JSON.stringify({
        id: result.id,
        from: params.from,
        to: params.to,
        type: result.type,
        duplicate: result.duplicate,
      }),
      metadata: { edgeID: result.id, duplicate: result.duplicate },
    }
  },
})
