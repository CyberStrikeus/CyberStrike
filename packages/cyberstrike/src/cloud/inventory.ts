import { Database, eq, and, asc } from "../storage/db"
import { CloudAssetTable, CloudEdgeTable, CloudExposureTable } from "./inventory.sql"
import { Identifier } from "../id/id"
import { Bus } from "../bus"
import { BusEvent } from "../bus/bus-event"
import z from "zod"

// ============================================================
// CLOUD INVENTORY — Composable asset/edge/exposure graph
//
// "Define the car once (engine, doors, wheel),
//  then every new model composes those parts."
//
// Every cloud analyst records structured objects here using
// the same API. Chain detection runs graph traversal on the
// result — no text-based guessing.
// ============================================================

// ── Asset Kinds ────────────────────────────────────────────

export const AssetKind = z.enum([
  // Azure
  "vm",
  "vmss",
  "aks",
  "container",
  "app_service",
  "function_app",
  "static_web_app",
  "storage_account",
  "keyvault",
  "sql_server",
  "sql_database",
  "cosmos_db",
  "redis",
  "vnet",
  "subnet",
  "nsg",
  "public_ip",
  "load_balancer",
  "front_door",
  "dns_zone",
  "private_endpoint",
  "vpn_gateway",
  "express_route",
  "user",
  "group",
  "service_principal",
  "managed_identity",
  "app_registration",
  "role_definition",
  "subscription",
  "resource_group",
  "logic_app",
  "automation_account",
  "runbook",
  "data_factory",
  "synapse",
  "databricks",
  "acr",
  "iot_hub",
  "apim",
  "cognitive_service",
  "sentinel_workspace",
  "monitor_workspace",
  "recovery_vault",
  // AWS
  "ec2_instance",
  "s3_bucket",
  "lambda_function",
  "iam_role",
  "iam_user",
  "iam_policy",
  "rds_instance",
  "ecs_cluster",
  "ecs_service",
  "eks_cluster",
  "vpc",
  "security_group",
  "ebs_volume",
  "sns_topic",
  "sqs_queue",
  "dynamodb_table",
  "cloudformation_stack",
  "api_gateway",
  "cloudfront_distribution",
  "route53_zone",
  "secrets_manager",
  "ssm_parameter",
  "kms_key",
  "opensearch_domain",
  "elasticache_cluster",
  "redshift_cluster",
  "efs_filesystem",
  "elb",
  "cognito_pool",
  "ecr_repository",
  "sso_instance",
  "aws_account",
  "other",
])
export type AssetKind = z.infer<typeof AssetKind>

// ── Edge Types ─────────────────────────────────────────────

export const EdgeType = z.enum([
  "rbac_owner",
  "rbac_contributor",
  "rbac_reader",
  "rbac_custom",
  "rbac_user_access_admin",
  "managed_identity_assigned",
  "key_access",
  "secret_access",
  "certificate_access",
  "network_peering",
  "subnet_membership",
  "private_link",
  "nsg_association",
  "dns_cname",
  "dns_a_record",
  "service_endpoint",
  "connection_string",
  "group_membership",
  "app_role_assignment",
  "oauth_permission",
  "api_connection",
  "data_flow",
  "contains",
  "delegates_to",
  "other",
])
export type EdgeType = z.infer<typeof EdgeType>

// ── Exposure Types ─────────────────────────────────────────

export const ExposureType = z.enum([
  "public_ip",
  "open_nsg_rule",
  "public_blob",
  "public_container",
  "anonymous_access",
  "dangling_dns",
  "dangling_cname",
  "public_endpoint",
  "unrestricted_network",
  "no_private_endpoint",
  "http_enabled",
  "weak_tls",
  "no_waf",
  "public_management_port",
  "stale_credential",
  "excessive_permission",
  "no_mfa",
  "guest_access",
  // AWS-specific
  "wildcard_policy",
  "public_snapshot",
  "public_bucket",
  "metadata_exposed",
  "unencrypted_storage",
  "unencrypted_transport",
  "logging_disabled",
  "secret_in_env",
  "secret_in_template",
  "cross_account_trust",
  "privilege_escalation_path",
  "no_auth",
  "other",
])
export type ExposureType = z.infer<typeof ExposureType>

// ── CloudAsset ─────────────────────────────────────────────

export namespace CloudAsset {
  export interface Info {
    id: string
    sessionID: string
    kind: AssetKind
    name: string
    resourceID?: string
    subscription?: string
    resourceGroup?: string
    region?: string
    properties: Record<string, unknown>
    group: string
    sourceAgent?: string
    timeCreated: number
    timeUpdated: number
  }

  export const Event = {
    Updated: BusEvent.define(
      "cloud_asset.updated",
      z.object({
        sessionID: z.string(),
        assetCount: z.number(),
      }),
    ),
  }

  export function add(input: {
    sessionID: string
    kind: AssetKind
    name: string
    resourceID?: string
    subscription?: string
    resourceGroup?: string
    region?: string
    properties?: Record<string, unknown>
    group: string
    sourceAgent?: string
  }): Info & { duplicate: boolean } {
    const existing = getByName(input.sessionID, input.kind, input.name)
    if (existing) {
      if (input.properties && Object.keys(input.properties).length > 0) {
        return { ...merge(existing.id, input.properties), duplicate: true }
      }
      return { ...existing, duplicate: true }
    }

    const id = Identifier.ascending("cloud_asset")
    const now = Date.now()
    const props = input.properties ?? {}

    Database.use((db) => {
      db.insert(CloudAssetTable)
        .values({
          id,
          session_id: input.sessionID,
          kind: input.kind,
          name: input.name,
          resource_id: input.resourceID ?? null,
          subscription: input.subscription ?? null,
          resource_group: input.resourceGroup ?? null,
          region: input.region ?? null,
          properties: props,
          group: input.group,
          source_agent: input.sourceAgent ?? null,
          time_created: now,
          time_updated: now,
        })
        .run()
    })

    const entry: Info = {
      id,
      sessionID: input.sessionID,
      kind: input.kind,
      name: input.name,
      resourceID: input.resourceID,
      subscription: input.subscription,
      resourceGroup: input.resourceGroup,
      region: input.region,
      properties: props,
      group: input.group,
      sourceAgent: input.sourceAgent,
      timeCreated: now,
      timeUpdated: now,
    }

    Database.effect(() => {
      const count = list(input.sessionID).length
      Bus.publish(Event.Updated, { sessionID: input.sessionID, assetCount: count })
    })

    return { ...entry, duplicate: false }
  }

  export function merge(assetID: string, properties: Record<string, unknown>): Info {
    const row = Database.use((db) =>
      db.select().from(CloudAssetTable).where(eq(CloudAssetTable.id, assetID)).get(),
    )
    if (!row) throw new Error(`cloud asset not found: ${assetID}`)

    const merged = { ...(row.properties as Record<string, unknown> ?? {}), ...properties }
    Database.use((db) => {
      db.update(CloudAssetTable)
        .set({ properties: merged, time_updated: Date.now() })
        .where(eq(CloudAssetTable.id, assetID))
        .run()
    })

    return rowToInfo(Database.use((db) =>
      db.select().from(CloudAssetTable).where(eq(CloudAssetTable.id, assetID)).get()!,
    ))
  }

  export function list(sessionID: string): Info[] {
    const rows = Database.use((db) =>
      db.select().from(CloudAssetTable)
        .where(eq(CloudAssetTable.session_id, sessionID))
        .orderBy(asc(CloudAssetTable.time_created))
        .all(),
    )
    return rows.map(rowToInfo)
  }

  export function listByKind(sessionID: string, kind: AssetKind): Info[] {
    const rows = Database.use((db) =>
      db.select().from(CloudAssetTable)
        .where(and(eq(CloudAssetTable.session_id, sessionID), eq(CloudAssetTable.kind, kind)))
        .orderBy(asc(CloudAssetTable.time_created))
        .all(),
    )
    return rows.map(rowToInfo)
  }

  export function listByGroup(sessionID: string, group: string): Info[] {
    const rows = Database.use((db) =>
      db.select().from(CloudAssetTable)
        .where(and(eq(CloudAssetTable.session_id, sessionID), eq(CloudAssetTable.group, group)))
        .orderBy(asc(CloudAssetTable.time_created))
        .all(),
    )
    return rows.map(rowToInfo)
  }

  export function getByName(sessionID: string, kind: AssetKind, name: string): Info | undefined {
    const normalized = name.toLowerCase().trim()
    return list(sessionID).find(
      (a) => a.kind === kind && a.name.toLowerCase().trim() === normalized,
    )
  }

  export function getById(id: string): Info | undefined {
    const row = Database.use((db) =>
      db.select().from(CloudAssetTable).where(eq(CloudAssetTable.id, id)).get(),
    )
    return row ? rowToInfo(row) : undefined
  }

  function rowToInfo(row: typeof CloudAssetTable.$inferSelect): Info {
    return {
      id: row.id,
      sessionID: row.session_id,
      kind: row.kind as AssetKind,
      name: row.name,
      resourceID: row.resource_id ?? undefined,
      subscription: row.subscription ?? undefined,
      resourceGroup: row.resource_group ?? undefined,
      region: row.region ?? undefined,
      properties: (row.properties as Record<string, unknown>) ?? {},
      group: row.group,
      sourceAgent: row.source_agent ?? undefined,
      timeCreated: row.time_created,
      timeUpdated: row.time_updated,
    }
  }
}

// ── CloudEdge ──────────────────────────────────────────────

export namespace CloudEdge {
  export interface Info {
    id: string
    sessionID: string
    fromAssetID: string
    toAssetID: string
    type: EdgeType
    direction: string
    evidence?: string
    severity?: string
    sourceAgent?: string
    timeCreated: number
    timeUpdated: number
  }

  export const Event = {
    Updated: BusEvent.define(
      "cloud_edge.updated",
      z.object({
        sessionID: z.string(),
        edgeCount: z.number(),
      }),
    ),
  }

  export function add(input: {
    sessionID: string
    fromAssetID: string
    toAssetID: string
    type: EdgeType
    direction?: string
    evidence?: string
    severity?: string
    sourceAgent?: string
  }): Info & { duplicate: boolean } {
    const existing = findDuplicate(input.sessionID, input.fromAssetID, input.toAssetID, input.type)
    if (existing) return { ...existing, duplicate: true }

    const id = Identifier.ascending("cloud_edge")
    const now = Date.now()

    Database.use((db) => {
      db.insert(CloudEdgeTable)
        .values({
          id,
          session_id: input.sessionID,
          from_asset_id: input.fromAssetID,
          to_asset_id: input.toAssetID,
          type: input.type,
          direction: input.direction ?? "outbound",
          evidence: input.evidence ?? null,
          severity: input.severity ?? null,
          source_agent: input.sourceAgent ?? null,
          time_created: now,
          time_updated: now,
        })
        .run()
    })

    const entry: Info = {
      id,
      sessionID: input.sessionID,
      fromAssetID: input.fromAssetID,
      toAssetID: input.toAssetID,
      type: input.type as EdgeType,
      direction: input.direction ?? "outbound",
      evidence: input.evidence,
      severity: input.severity,
      sourceAgent: input.sourceAgent,
      timeCreated: now,
      timeUpdated: now,
    }

    Database.effect(() => {
      const count = list(input.sessionID).length
      Bus.publish(Event.Updated, { sessionID: input.sessionID, edgeCount: count })
    })

    return { ...entry, duplicate: false }
  }

  export function list(sessionID: string): Info[] {
    const rows = Database.use((db) =>
      db.select().from(CloudEdgeTable)
        .where(eq(CloudEdgeTable.session_id, sessionID))
        .orderBy(asc(CloudEdgeTable.time_created))
        .all(),
    )
    return rows.map(rowToInfo)
  }

  export function fromAsset(sessionID: string, assetID: string): Info[] {
    const rows = Database.use((db) =>
      db.select().from(CloudEdgeTable)
        .where(and(eq(CloudEdgeTable.session_id, sessionID), eq(CloudEdgeTable.from_asset_id, assetID)))
        .all(),
    )
    return rows.map(rowToInfo)
  }

  export function toAsset(sessionID: string, assetID: string): Info[] {
    const rows = Database.use((db) =>
      db.select().from(CloudEdgeTable)
        .where(and(eq(CloudEdgeTable.session_id, sessionID), eq(CloudEdgeTable.to_asset_id, assetID)))
        .all(),
    )
    return rows.map(rowToInfo)
  }

  export function connected(sessionID: string, assetID: string): Info[] {
    return [...fromAsset(sessionID, assetID), ...toAsset(sessionID, assetID)]
  }

  function findDuplicate(sessionID: string, fromID: string, toID: string, type: EdgeType): Info | undefined {
    return list(sessionID).find(
      (e) => e.fromAssetID === fromID && e.toAssetID === toID && e.type === type,
    )
  }

  function rowToInfo(row: typeof CloudEdgeTable.$inferSelect): Info {
    return {
      id: row.id,
      sessionID: row.session_id,
      fromAssetID: row.from_asset_id,
      toAssetID: row.to_asset_id,
      type: row.type as EdgeType,
      direction: row.direction,
      evidence: row.evidence ?? undefined,
      severity: row.severity ?? undefined,
      sourceAgent: row.source_agent ?? undefined,
      timeCreated: row.time_created,
      timeUpdated: row.time_updated,
    }
  }
}

// ── CloudExposure ──────────────────────────────────────────

export namespace CloudExposure {
  export interface Info {
    id: string
    sessionID: string
    assetID: string
    type: ExposureType
    severity: string
    detail?: string
    verified: boolean
    sourceAgent?: string
    timeCreated: number
    timeUpdated: number
  }

  export const Event = {
    Updated: BusEvent.define(
      "cloud_exposure.updated",
      z.object({
        sessionID: z.string(),
        exposureCount: z.number(),
      }),
    ),
  }

  export function add(input: {
    sessionID: string
    assetID: string
    type: ExposureType
    severity: string
    detail?: string
    verified?: boolean
    sourceAgent?: string
  }): Info & { duplicate: boolean } {
    const existing = findDuplicate(input.sessionID, input.assetID, input.type)
    if (existing) return { ...existing, duplicate: true }

    const id = Identifier.ascending("cloud_exposure")
    const now = Date.now()

    Database.use((db) => {
      db.insert(CloudExposureTable)
        .values({
          id,
          session_id: input.sessionID,
          asset_id: input.assetID,
          type: input.type,
          severity: input.severity,
          detail: input.detail ?? null,
          verified: input.verified ? 1 : 0,
          source_agent: input.sourceAgent ?? null,
          time_created: now,
          time_updated: now,
        })
        .run()
    })

    const entry: Info = {
      id,
      sessionID: input.sessionID,
      assetID: input.assetID,
      type: input.type as ExposureType,
      severity: input.severity,
      detail: input.detail,
      verified: input.verified ?? false,
      sourceAgent: input.sourceAgent,
      timeCreated: now,
      timeUpdated: now,
    }

    Database.effect(() => {
      const count = list(input.sessionID).length
      Bus.publish(Event.Updated, { sessionID: input.sessionID, exposureCount: count })
    })

    return { ...entry, duplicate: false }
  }

  export function markVerified(id: string): void {
    Database.use((db) => {
      db.update(CloudExposureTable)
        .set({ verified: 1, time_updated: Date.now() })
        .where(eq(CloudExposureTable.id, id))
        .run()
    })
  }

  export function list(sessionID: string): Info[] {
    const rows = Database.use((db) =>
      db.select().from(CloudExposureTable)
        .where(eq(CloudExposureTable.session_id, sessionID))
        .orderBy(asc(CloudExposureTable.time_created))
        .all(),
    )
    return rows.map(rowToInfo)
  }

  export function forAsset(sessionID: string, assetID: string): Info[] {
    const rows = Database.use((db) =>
      db.select().from(CloudExposureTable)
        .where(and(eq(CloudExposureTable.session_id, sessionID), eq(CloudExposureTable.asset_id, assetID)))
        .all(),
    )
    return rows.map(rowToInfo)
  }

  function findDuplicate(sessionID: string, assetID: string, type: ExposureType): Info | undefined {
    return list(sessionID).find(
      (e) => e.assetID === assetID && e.type === type,
    )
  }

  function rowToInfo(row: typeof CloudExposureTable.$inferSelect): Info {
    return {
      id: row.id,
      sessionID: row.session_id,
      assetID: row.asset_id,
      type: row.type as ExposureType,
      severity: row.severity,
      detail: row.detail ?? undefined,
      verified: row.verified === 1,
      sourceAgent: row.source_agent ?? undefined,
      timeCreated: row.time_created,
      timeUpdated: row.time_updated,
    }
  }
}

// ── Graph Query Helpers ────────────────────────────────────

export function buildGraph(sessionID: string) {
  const assets = CloudAsset.list(sessionID)
  const edges = CloudEdge.list(sessionID)
  const exposures = CloudExposure.list(sessionID)

  const assetMap = new Map(assets.map((a) => [a.id, a]))
  const edgesByFrom = new Map<string, CloudEdge.Info[]>()
  const edgesByTo = new Map<string, CloudEdge.Info[]>()
  const exposuresByAsset = new Map<string, CloudExposure.Info[]>()

  for (const e of edges) {
    if (!edgesByFrom.has(e.fromAssetID)) edgesByFrom.set(e.fromAssetID, [])
    edgesByFrom.get(e.fromAssetID)!.push(e)
    if (!edgesByTo.has(e.toAssetID)) edgesByTo.set(e.toAssetID, [])
    edgesByTo.get(e.toAssetID)!.push(e)
  }

  for (const exp of exposures) {
    if (!exposuresByAsset.has(exp.assetID)) exposuresByAsset.set(exp.assetID, [])
    exposuresByAsset.get(exp.assetID)!.push(exp)
  }

  return {
    assets,
    edges,
    exposures,
    assetMap,
    edgesByFrom,
    edgesByTo,
    exposuresByAsset,

    neighbors(assetID: string): CloudAsset.Info[] {
      const ids = new Set<string>()
      for (const e of edgesByFrom.get(assetID) ?? []) ids.add(e.toAssetID)
      for (const e of edgesByTo.get(assetID) ?? []) ids.add(e.fromAssetID)
      return [...ids].map((id) => assetMap.get(id)).filter(Boolean) as CloudAsset.Info[]
    },

    isExposed(assetID: string): boolean {
      return (exposuresByAsset.get(assetID)?.length ?? 0) > 0
    },

    principalAssets(): CloudAsset.Info[] {
      const principalKinds = new Set<AssetKind>(["user", "group", "service_principal", "managed_identity", "app_registration"])
      return assets.filter((a) => principalKinds.has(a.kind))
    },

    resourceAssets(): CloudAsset.Info[] {
      const principalKinds = new Set<AssetKind>(["user", "group", "service_principal", "managed_identity", "app_registration", "role_definition", "subscription", "resource_group"])
      return assets.filter((a) => !principalKinds.has(a.kind))
    },
  }
}
