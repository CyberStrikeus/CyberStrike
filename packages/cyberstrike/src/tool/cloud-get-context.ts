import z from "zod"
import { Tool } from "./tool"
import { Session } from "../session"
import { CloudAsset, CloudEdge, CloudExposure, buildGraph } from "../cloud/inventory"
import { detectCloudChains, formatCloudChainsForPrompt } from "../cloud/cloud-chain"

export const CloudGetContextTool = Tool.define("cloud_get_context", {
  description: [
    "Get the structured cloud inventory graph for this session.",
    "Returns assets, edges (relationships), exposures, and detected attack chains.",
    "Use this to understand what other analysts discovered and find cross-group correlations.",
    "",
    "Filter by group to see only your area, or omit to see the full picture.",
    "Chain detection runs automatically — chains appear when the graph has enough structure.",
  ].join("\n"),
  parameters: z.object({
    group: z.string().optional().describe("Filter by cloud group key (identity, compute, network, data, security, access, specialized, compliance, exposure)"),
    kind: z.string().optional().describe("Filter assets by kind (vm, keyvault, service_principal, etc.)"),
    include_chains: z.boolean().optional().describe("Run chain detection and include results (default: true)"),
    include_properties: z.boolean().optional().describe("Include full asset properties (default: false — keeps output compact)"),
  }),
  async execute(params, ctx) {
    const sessionID = Session.root(ctx.sessionID)
    const graph = buildGraph(sessionID)

    let assets = graph.assets
    if (params.group) assets = assets.filter((a) => a.group === params.group)
    if (params.kind) assets = assets.filter((a) => a.kind === params.kind)

    const assetIDs = new Set(assets.map((a) => a.id))

    const edges = params.group || params.kind
      ? graph.edges.filter((e) => assetIDs.has(e.fromAssetID) || assetIDs.has(e.toAssetID))
      : graph.edges

    const exposures = params.group || params.kind
      ? graph.exposures.filter((e) => assetIDs.has(e.assetID))
      : graph.exposures

    const includeProps = params.include_properties ?? false
    const assetSummary = assets.map((a) => {
      const base: Record<string, unknown> = {
        id: a.id,
        kind: a.kind,
        name: a.name,
        group: a.group,
      }
      if (a.region) base.region = a.region
      if (a.subscription) base.subscription = a.subscription
      if (a.resourceGroup) base.resource_group = a.resourceGroup
      if (includeProps && Object.keys(a.properties).length > 0) base.properties = a.properties
      return base
    })

    const edgeSummary = edges.map((e) => {
      const from = graph.assetMap.get(e.fromAssetID)
      const to = graph.assetMap.get(e.toAssetID)
      return {
        from: from ? `${from.kind}/${from.name}` : e.fromAssetID,
        to: to ? `${to.kind}/${to.name}` : e.toAssetID,
        type: e.type,
        severity: e.severity,
        evidence: e.evidence,
      }
    })

    const exposureSummary = exposures.map((e) => {
      const asset = graph.assetMap.get(e.assetID)
      return {
        asset: asset ? `${asset.kind}/${asset.name}` : e.assetID,
        type: e.type,
        severity: e.severity,
        detail: e.detail,
        verified: e.verified,
      }
    })

    const stats = {
      assets: graph.assets.length,
      edges: graph.edges.length,
      exposures: graph.exposures.length,
      principals: graph.principalAssets().length,
      resources: graph.resourceAssets().length,
      exposed_assets: graph.assets.filter((a) => graph.isExposed(a.id)).length,
    }

    const context: Record<string, unknown> = {
      stats,
      assets: assetSummary,
      edges: edgeSummary,
      exposures: exposureSummary,
    }

    const includeChains = params.include_chains ?? true
    if (includeChains && graph.assets.length >= 2) {
      const chains = detectCloudChains(sessionID)
      if (chains.length > 0) {
        context.chains = chains.slice(0, 10).map((c) => ({
          pattern: c.pattern,
          assets: c.assetNames,
          impact: c.expectedImpact,
          severity: c.severity,
          confidence: c.confidence,
          plan: c.testingPlan,
        }))
        context.chain_summary = formatCloudChainsForPrompt(chains)
      }
    }

    const filterLabel = params.group ? ` (group: ${params.group})` : params.kind ? ` (kind: ${params.kind})` : ""
    return {
      title: `Cloud Inventory${filterLabel}: ${assets.length} assets, ${edges.length} edges, ${exposures.length} exposures`,
      output: JSON.stringify(context, null, 2),
      metadata: stats,
    }
  },
})
