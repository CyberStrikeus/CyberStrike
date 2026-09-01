import { buildGraph, CloudAsset, CloudEdge, CloudExposure } from "./inventory"
import type { AssetKind, EdgeType } from "./inventory"
import { Identifier } from "../id/id"

// ============================================================
// CLOUD CHAIN DETECTION — Deterministic graph traversal
//
// Replaces LLM-guessed detectFollowUps with structured
// pattern matching on the asset/edge/exposure graph.
//
// Each pattern walks the graph looking for a specific shape
// (e.g. principal → high-priv edge → resource with exposure).
// ============================================================

export type CloudChainPattern =
  | "privilege_escalation"
  | "lateral_movement"
  | "data_exfiltration"
  | "subdomain_takeover"
  | "credential_harvest"
  | "identity_pivot"
  | "network_path"
  | "custom"

export interface CloudChainCandidate {
  id: string
  pattern: CloudChainPattern
  assetIDs: string[]
  assetNames: string[]
  edgeIDs: string[]
  exposureIDs: string[]
  expectedImpact: string
  severity: string
  testingPlan: string
  confidence: number
  detectedAt: number
}

const PRIV_EDGE_TYPES = new Set<EdgeType>([
  "rbac_owner",
  "rbac_contributor",
  "rbac_user_access_admin",
  "rbac_custom",
  "key_access",
  "secret_access",
])

const PRINCIPAL_KINDS = new Set<AssetKind>([
  "user",
  "group",
  "service_principal",
  "managed_identity",
  "app_registration",
])

export function detectCloudChains(sessionID: string): CloudChainCandidate[] {
  const graph = buildGraph(sessionID)
  if (graph.assets.length < 2) return []

  const chains: CloudChainCandidate[] = []
  const seen = new Set<string>()

  function emit(
    pattern: CloudChainPattern,
    assets: CloudAsset.Info[],
    edges: CloudEdge.Info[],
    exposures: CloudExposure.Info[],
    impact: string,
    severity: string,
    plan: string,
    confidence: number,
  ) {
    const key = `${pattern}:${assets.map((a) => a.id).sort().join("+")}`
    if (seen.has(key)) return
    seen.add(key)
    chains.push({
      id: Identifier.ascending("chain_candidate"),
      pattern,
      assetIDs: assets.map((a) => a.id),
      assetNames: assets.map((a) => a.name),
      edgeIDs: edges.map((e) => e.id),
      exposureIDs: exposures.map((e) => e.id),
      expectedImpact: impact,
      severity,
      testingPlan: plan,
      confidence,
      detectedAt: Date.now(),
    })
  }

  // 1. PRIVILEGE_ESCALATION
  // principal --high-priv-edge--> resource --managed_identity/delegates--> high-priv-principal
  for (const principal of graph.principalAssets()) {
    for (const edge of graph.edgesByFrom.get(principal.id) ?? []) {
      if (!PRIV_EDGE_TYPES.has(edge.type as EdgeType)) continue
      const target = graph.assetMap.get(edge.toAssetID)
      if (!target) continue

      for (const hop of graph.edgesByFrom.get(target.id) ?? []) {
        if (hop.type !== "managed_identity_assigned" && hop.type !== "delegates_to") continue
        const endTarget = graph.assetMap.get(hop.toAssetID)
        if (!endTarget || !PRINCIPAL_KINDS.has(endTarget.kind)) continue

        const endEdges = graph.edgesByFrom.get(endTarget.id) ?? []
        const hasHighPriv = endEdges.some((e) => PRIV_EDGE_TYPES.has(e.type as EdgeType))
        if (!hasHighPriv) continue

        emit(
          "privilege_escalation",
          [principal, target, endTarget],
          [edge, hop],
          [],
          "PRIVILEGE_ESCALATION",
          "critical",
          `Abuse ${edge.type} on "${target.name}" to pivot via ${hop.type} to "${endTarget.name}" with elevated privileges`,
          85,
        )
      }
    }
  }

  // 2. LATERAL_MOVEMENT
  // resource [with exposure] --network_peering/subnet_membership--> resource [internal]
  for (const asset of graph.assets) {
    if (!graph.isExposed(asset.id)) continue
    for (const edge of graph.edgesByFrom.get(asset.id) ?? []) {
      if (edge.type !== "network_peering" && edge.type !== "subnet_membership" && edge.type !== "private_link") continue
      const target = graph.assetMap.get(edge.toAssetID)
      if (!target) continue

      const exposures = graph.exposuresByAsset.get(asset.id) ?? []
      emit(
        "lateral_movement",
        [asset, target],
        [edge],
        exposures,
        "LATERAL_MOVEMENT",
        "high",
        `From exposed "${asset.name}" (${exposures.map((e) => e.type).join(", ")}), traverse ${edge.type} to internal "${target.name}"`,
        exposures.some((e) => e.verified) ? 90 : 70,
      )
    }
  }

  // 3. DATA_EXFILTRATION
  // principal --key/secret_access--> keyvault --connection_string--> database
  for (const principal of graph.principalAssets()) {
    for (const kvEdge of graph.edgesByFrom.get(principal.id) ?? []) {
      if (kvEdge.type !== "key_access" && kvEdge.type !== "secret_access") continue
      const kv = graph.assetMap.get(kvEdge.toAssetID)
      if (!kv || kv.kind !== "keyvault") continue

      for (const connEdge of graph.edgesByFrom.get(kv.id) ?? []) {
        if (connEdge.type !== "connection_string" && connEdge.type !== "data_flow") continue
        const db = graph.assetMap.get(connEdge.toAssetID)
        if (!db) continue

        emit(
          "data_exfiltration",
          [principal, kv, db],
          [kvEdge, connEdge],
          [],
          "DATA_EXFILTRATION",
          "critical",
          `"${principal.name}" has ${kvEdge.type} to "${kv.name}", which holds connection strings to "${db.name}"`,
          80,
        )
      }
    }
  }

  // 4. SUBDOMAIN_TAKEOVER
  // dns_zone --dns_cname--> resource [deleted/dangling exposure]
  for (const dns of graph.assets.filter((a) => a.kind === "dns_zone")) {
    for (const edge of graph.edgesByFrom.get(dns.id) ?? []) {
      if (edge.type !== "dns_cname" && edge.type !== "dns_a_record") continue
      const target = graph.assetMap.get(edge.toAssetID)
      if (!target) continue

      const danglingExposures = (graph.exposuresByAsset.get(target.id) ?? [])
        .filter((e) => e.type === "dangling_dns" || e.type === "dangling_cname")
      if (danglingExposures.length === 0) continue

      emit(
        "subdomain_takeover",
        [dns, target],
        [edge],
        danglingExposures,
        "SUBDOMAIN_TAKEOVER",
        "critical",
        `DNS record in "${dns.name}" points to "${target.name}" which has dangling records — register to take over`,
        danglingExposures.some((e) => e.verified) ? 95 : 75,
      )
    }
  }

  // 5. CREDENTIAL_HARVEST
  // app_registration --secret/key_access--> keyvault [with exposure]
  for (const app of graph.assets.filter((a) => a.kind === "app_registration")) {
    for (const edge of graph.edgesByFrom.get(app.id) ?? []) {
      if (edge.type !== "secret_access" && edge.type !== "key_access" && edge.type !== "certificate_access") continue
      const target = graph.assetMap.get(edge.toAssetID)
      if (!target) continue

      if (!graph.isExposed(target.id)) continue
      const exposures = graph.exposuresByAsset.get(target.id) ?? []

      emit(
        "credential_harvest",
        [app, target],
        [edge],
        exposures,
        "CREDENTIAL_HARVEST",
        "critical",
        `App "${app.name}" has ${edge.type} to "${target.name}" which is exposed (${exposures.map((e) => e.type).join(", ")})`,
        80,
      )
    }
  }

  // 6. IDENTITY_PIVOT
  // principal --group_membership--> group --rbac_*--> high-value resource
  for (const principal of graph.assets.filter((a) => a.kind === "user" || a.kind === "service_principal")) {
    for (const grpEdge of graph.edgesByFrom.get(principal.id) ?? []) {
      if (grpEdge.type !== "group_membership") continue
      const group = graph.assetMap.get(grpEdge.toAssetID)
      if (!group || group.kind !== "group") continue

      for (const rbacEdge of graph.edgesByFrom.get(group.id) ?? []) {
        if (!PRIV_EDGE_TYPES.has(rbacEdge.type as EdgeType)) continue
        const resource = graph.assetMap.get(rbacEdge.toAssetID)
        if (!resource) continue

        emit(
          "identity_pivot",
          [principal, group, resource],
          [grpEdge, rbacEdge],
          [],
          "IDENTITY_PIVOT",
          "high",
          `"${principal.name}" is member of "${group.name}" which has ${rbacEdge.type} on "${resource.name}"`,
          75,
        )
      }
    }
  }

  // 7. NETWORK_PATH
  // exposed resource --nsg_association (weak)--> subnet --contains--> sensitive resource
  for (const asset of graph.assets) {
    const exposures = graph.exposuresByAsset.get(asset.id) ?? []
    const hasNetworkExposure = exposures.some((e) =>
      e.type === "open_nsg_rule" || e.type === "unrestricted_network" || e.type === "public_management_port",
    )
    if (!hasNetworkExposure) continue

    for (const edge of graph.edgesByFrom.get(asset.id) ?? []) {
      if (edge.type !== "subnet_membership" && edge.type !== "nsg_association") continue
      const subnet = graph.assetMap.get(edge.toAssetID)
      if (!subnet) continue

      for (const innerEdge of graph.edgesByTo.get(subnet.id) ?? []) {
        if (innerEdge.fromAssetID === asset.id) continue
        const peer = graph.assetMap.get(innerEdge.fromAssetID)
        if (!peer) continue

        const netExposures = exposures.filter((e) =>
          e.type === "open_nsg_rule" || e.type === "unrestricted_network" || e.type === "public_management_port",
        )
        emit(
          "network_path",
          [asset, subnet, peer],
          [edge, innerEdge],
          netExposures,
          "NETWORK_PATH",
          "high",
          `Exposed "${asset.name}" shares subnet "${subnet.name}" with "${peer.name}" — lateral movement via network`,
          netExposures.some((e) => e.verified) ? 85 : 65,
        )
      }
    }
  }

  chains.sort((a, b) => b.confidence - a.confidence)
  return chains
}

export function formatCloudChainsForPrompt(chains: CloudChainCandidate[]): string {
  if (chains.length === 0) return ""

  const lines: string[] = [`## Cloud Chain Opportunities (${chains.length} detected)`]
  for (const c of chains.slice(0, 15)) {
    const label = c.confidence >= 80 ? "HIGH" : c.confidence >= 60 ? "MED" : "LOW"
    lines.push(
      `[${label}-${c.confidence}%] ${c.pattern.toUpperCase()}: ${c.assetNames.map((n) => `"${n}"`).join(" → ")} → ${c.expectedImpact}`,
    )
    lines.push(`  Test: ${c.testingPlan}`)
  }
  return lines.join("\n")
}
