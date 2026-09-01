import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core"
import { SessionTable } from "../session/session.sql"
import { Timestamps } from "../storage/schema.sql"

export const CloudAssetTable = sqliteTable(
  "cloud_asset",
  {
    id: text().primaryKey(),
    session_id: text()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    kind: text().notNull(),
    name: text().notNull(),
    resource_id: text(),
    subscription: text(),
    resource_group: text(),
    region: text(),
    properties: text({ mode: "json" }).$type<Record<string, unknown>>(),
    group: text().notNull(),
    source_agent: text(),
    ...Timestamps,
  },
  (table) => [
    index("cloud_asset_session_idx").on(table.session_id),
    index("cloud_asset_kind_idx").on(table.session_id, table.kind),
    index("cloud_asset_name_idx").on(table.session_id, table.name),
    index("cloud_asset_group_idx").on(table.session_id, table.group),
  ],
)

export const CloudEdgeTable = sqliteTable(
  "cloud_edge",
  {
    id: text().primaryKey(),
    session_id: text()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    from_asset_id: text()
      .notNull()
      .references(() => CloudAssetTable.id, { onDelete: "cascade" }),
    to_asset_id: text()
      .notNull()
      .references(() => CloudAssetTable.id, { onDelete: "cascade" }),
    type: text().notNull(),
    direction: text().notNull().default("outbound"),
    evidence: text(),
    severity: text(),
    source_agent: text(),
    ...Timestamps,
  },
  (table) => [
    index("cloud_edge_session_idx").on(table.session_id),
    index("cloud_edge_from_idx").on(table.from_asset_id),
    index("cloud_edge_to_idx").on(table.to_asset_id),
    index("cloud_edge_type_idx").on(table.session_id, table.type),
  ],
)

export const CloudExposureTable = sqliteTable(
  "cloud_exposure",
  {
    id: text().primaryKey(),
    session_id: text()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    asset_id: text()
      .notNull()
      .references(() => CloudAssetTable.id, { onDelete: "cascade" }),
    type: text().notNull(),
    severity: text().notNull(),
    detail: text(),
    verified: integer().notNull().default(0),
    source_agent: text(),
    ...Timestamps,
  },
  (table) => [
    index("cloud_exposure_session_idx").on(table.session_id),
    index("cloud_exposure_asset_idx").on(table.asset_id),
    index("cloud_exposure_severity_idx").on(table.session_id, table.severity),
  ],
)
