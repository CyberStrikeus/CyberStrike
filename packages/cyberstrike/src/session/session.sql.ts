import { sqliteTable, text, integer, real, index, primaryKey } from "drizzle-orm/sqlite-core"
import { ProjectTable } from "../project/project.sql"
import type { MessageV2 } from "./message-v2"
import type { Snapshot } from "@/snapshot"
import type { PermissionNext } from "@/permission/next"
import { Timestamps } from "@/storage/schema.sql"

type PartData = Omit<MessageV2.Part, "id" | "sessionID" | "messageID">
type InfoData = Omit<MessageV2.Info, "id" | "sessionID">

export const SessionTable = sqliteTable(
  "session",
  {
    id: text().primaryKey(),
    project_id: text()
      .notNull()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    parent_id: text(),
    slug: text().notNull(),
    directory: text().notNull(),
    title: text().notNull(),
    version: text().notNull(),
    share_url: text(),
    summary_additions: integer(),
    summary_deletions: integer(),
    summary_files: integer(),
    summary_diffs: text({ mode: "json" }).$type<Snapshot.FileDiff[]>(),
    revert: text({ mode: "json" }).$type<{ messageID: string; partID?: string; snapshot?: string; diff?: string }>(),
    permission: text({ mode: "json" }).$type<PermissionNext.Ruleset>(),
    ...Timestamps,
    time_compacting: integer(),
    time_archived: integer(),
  },
  (table) => [index("session_project_idx").on(table.project_id), index("session_parent_idx").on(table.parent_id)],
)

export const MessageTable = sqliteTable(
  "message",
  {
    id: text().primaryKey(),
    session_id: text()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    ...Timestamps,
    data: text({ mode: "json" }).notNull().$type<InfoData>(),
  },
  (table) => [index("message_session_idx").on(table.session_id)],
)

export const PartTable = sqliteTable(
  "part",
  {
    id: text().primaryKey(),
    message_id: text()
      .notNull()
      .references(() => MessageTable.id, { onDelete: "cascade" }),
    session_id: text().notNull(),
    ...Timestamps,
    data: text({ mode: "json" }).notNull().$type<PartData>(),
  },
  (table) => [index("part_message_idx").on(table.message_id), index("part_session_idx").on(table.session_id)],
)

export const TodoTable = sqliteTable(
  "todo",
  {
    session_id: text()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    content: text().notNull(),
    status: text().notNull(),
    priority: text().notNull(),
    position: integer().notNull(),
    ...Timestamps,
  },
  (table) => [
    primaryKey({ columns: [table.session_id, table.position] }),
    index("todo_session_idx").on(table.session_id),
  ],
)

export const VulnerabilityTable = sqliteTable(
  "vulnerability",
  {
    id: text().primaryKey(),
    session_id: text()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    message_id: text().references(() => MessageTable.id, { onDelete: "set null" }),
    severity: text().notNull(),
    title: text().notNull(),
    description: text().notNull(),
    cwe_id: text(),
    file: text(),
    line_start: integer(),
    line_end: integer(),
    steps_to_reproduce: text(),
    business_impact: text(),
    recommendation: text(),
    poc: text(),
    status: text().notNull(),
    position: integer().notNull(),
    ...Timestamps,
  },
  (table) => [
    index("vulnerability_session_idx").on(table.session_id),
    index("vulnerability_severity_idx").on(table.severity),
  ],
)

export const PermissionTable = sqliteTable("permission", {
  project_id: text()
    .primaryKey()
    .references(() => ProjectTable.id, { onDelete: "cascade" }),
  ...Timestamps,
  data: text({ mode: "json" }).notNull().$type<PermissionNext.Ruleset>(),
})

export const RequestTable = sqliteTable(
  "request",
  {
    id: text().primaryKey(),
    session_id: text()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    credential_id: text(),
    method: text().notNull(),
    normalized_path: text().notNull(),
    raw_request: text(),
    body_hash: text(),
    query_hash: text(),
    status: text().notNull(),
    // Browser-agent enrichment fields (nullable — not sent by Firefox extension)
    trigger_element: text(),
    element_roles: text({ mode: "json" }).$type<string[]>(),
    ui_context: text({ mode: "json" }).$type<Record<string, unknown>>(),
    page_url: text(),
    page_visited_by: text({ mode: "json" }).$type<string[]>(),
    // normalize-proto pipeline fields (nullable — legacy rows pre-date this).
    // canonical_path is the lowercased + percent-decoded form used for cache
    // identity; normalized_path holds the placeholder template (e.g. /users/{id}).
    scheme: text(),                                                          // "http" | "https"
    host: text(),
    port: integer(),
    origin: text(),                                                          // scheme://host:port
    site: text(),                                                            // eTLD+1, populated by parser; not yet indexed
    canonical_path: text(),
    template_id: text(),                                                     // soft pointer to endpoint_template.id
    norm_source: text(),                                                     // "tier1" | "tier2" | "tier3" | "failed"
    // Response fields
    response_status: integer(),
    response_headers: text({ mode: "json" }).$type<Record<string, string>>(),
    response_content_type: text(),
    response_size: integer(),
    processed_response: text(),
    ...Timestamps,
  },
  (table) => [
    index("request_session_idx").on(table.session_id),
    index("request_normalized_idx").on(table.session_id, table.method, table.normalized_path),
    index("request_credential_idx").on(table.credential_id),
    index("request_template_idx").on(table.template_id),
  ],
)

// ============================================================================
// Web Proxy Agent Tables - For advanced endpoint analysis and testing
// ============================================================================

export const WebCredentialTable = sqliteTable(
  "web_credential",
  {
    id: text().primaryKey(),
    session_id: text()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    label: text().notNull(),
    // Generic header storage: { "Authorization": "Bearer xxx", "Cookie": "session=abc" }
    headers: text({ mode: "json" }).$type<Record<string, string>>().notNull(),
    container_id: text(), // Firefox container ID for sync
    role_id: text(),
    ...Timestamps,
  },
  (table) => [
    index("web_credential_session_idx").on(table.session_id),
    index("web_credential_container_idx").on(table.container_id),
  ],
)

export const WebRoleTable = sqliteTable(
  "web_role",
  {
    id: text().primaryKey(),
    session_id: text()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    name: text().notNull(),
    level: integer(),
    discovered_from: text(),
    ...Timestamps,
  },
  (table) => [
    index("web_role_session_idx").on(table.session_id),
    index("web_role_name_idx").on(table.session_id, table.name),
  ],
)

export const WebObjectTable = sqliteTable(
  "web_object",
  {
    id: text().primaryKey(),
    session_id: text()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    name: text().notNull(),
    fields: text({ mode: "json" }).$type<string[]>(),
    sensitive_fields: text({ mode: "json" }).$type<string[]>(),
    id_fields: text({ mode: "json" }).$type<string[]>(),
    discovered_from: text(),
    ...Timestamps,
  },
  (table) => [
    index("web_object_session_idx").on(table.session_id),
    index("web_object_name_idx").on(table.session_id, table.name),
  ],
)

export const WebObjectValueTable = sqliteTable(
  "web_object_value",
  {
    id: text().primaryKey(),
    session_id: text()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    object_id: text()
      .notNull()
      .references(() => WebObjectTable.id, { onDelete: "cascade" }),
    field_name: text().notNull(),
    value: text().notNull(),
    credential_id: text(),
    discovered_from: text(),
    ...Timestamps,
  },
  (table) => [
    index("web_object_value_session_idx").on(table.session_id),
    index("web_object_value_object_idx").on(table.object_id),
  ],
)

export const WebFunctionTable = sqliteTable(
  "web_function",
  {
    id: text().primaryKey(),
    session_id: text()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    name: text().notNull(),
    action_type: text().notNull(), // create, read, update, delete
    request_id: text()
      .notNull()
      .references(() => RequestTable.id, { onDelete: "cascade" }),
    role_id: text(),
    objects: text({ mode: "json" }).$type<string[]>(),
    template_id: text(),                                                     // soft pointer to endpoint_template.id
    ...Timestamps,
  },
  (table) => [
    index("web_function_session_idx").on(table.session_id),
    index("web_function_request_idx").on(table.request_id),
  ],
)

// Endpoint template cache for the 4-tier path normalizer.
// One row per (session, origin, method, template). Tier 2 reads it during
// path normalization; tier 1 / tier 3 write it as new shapes are discovered.
// FK on session_id ensures templates are gc'd when a session is deleted.
export const EndpointTemplateTable = sqliteTable(
  "endpoint_template",
  {
    id: text().primaryKey(),
    session_id: text()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    origin: text().notNull(),                                                // scheme://host:port
    method: text().notNull(),
    template: text().notNull(),                                              // e.g. /users/{id}/posts/{id}
    segment_count: integer().notNull(),                                      // pre-computed for O(1) bucket reject
    source: text().notNull(),                                                // "tier1" | "tier3-llm"
    confidence: real().notNull(),                                            // 1.0 for tier1, 0.8 for tier3-llm
    hit_count: integer().notNull(),
    ...Timestamps,
  },
  (table) => [
    index("endpoint_template_session_idx").on(table.session_id),
    index("endpoint_template_lookup_idx").on(table.session_id, table.origin, table.method, table.segment_count),
    index("endpoint_template_unique_idx").on(table.session_id, table.origin, table.method, table.template),
  ],
)

export const WebRetestQueueTable = sqliteTable(
  "web_retest_queue",
  {
    id: text().primaryKey(),
    session_id: text()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    request_id: text()
      .notNull()
      .references(() => RequestTable.id, { onDelete: "cascade" }),
    trigger_type: text().notNull(), // new_role, new_object_value, new_credential
    trigger_source: text().notNull(),
    status: text().notNull(), // pending, processing, completed
    priority: text().notNull(), // high, medium, low
    ...Timestamps,
  },
  (table) => [
    index("web_retest_queue_session_idx").on(table.session_id),
    index("web_retest_queue_status_idx").on(table.session_id, table.status),
  ],
)
