// Signal-fabric persistence (plan §07). Two durable, session-scoped tables kept in
// their own schema file so the web signal fabric stays self-contained for the
// eventual @cyberstrike/web package split. Both reference the core `session` table
// (cascade cleanup) but nothing else, so they lift out cleanly.
//
// `request_id` is intentionally NOT a foreign key: replay-elicited responses have
// synthetic ids with no `request` row, and a signal/canary must still persist for
// them. Session scoping is the only enforced relation.
import { sqliteTable, text, index, uniqueIndex } from "drizzle-orm/sqlite-core"
import { SessionTable } from "../../session.sql"
import { Timestamps } from "@/storage/schema.sql"

// Registered canaries — one row per unique (session, token). The searchable
// `token` is what later responses are scanned for; `origin_request_id` is the
// inject site, so a hit in any other request is cross-page (stored) reflection.
export const WebCanaryTable = sqliteTable(
  "web_canary",
  {
    id: text().primaryKey(),
    session_id: text()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    token: text().notNull(),
    kind: text().notNull(), // reflect, template, callback, file, log
    origin_request_id: text().notNull(),
    endpoint: text().notNull(),
    field: text().notNull(),
    agent: text().notNull(),
    vuln_class: text().notNull(),
    ...Timestamps,
  },
  (table) => [
    index("web_canary_session_idx").on(table.session_id),
    uniqueIndex("web_canary_token_idx").on(table.session_id, table.token),
  ],
)

// Emitted signals — one row per unique (session, dedup_key), so re-scanning the
// same evidence does not pile up duplicates. `status` tracks the routing lifecycle.
export const WebSignalTable = sqliteTable(
  "web_signal",
  {
    id: text().primaryKey(),
    session_id: text()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    signal_type: text().notNull(),
    owner: text().notNull(), // specialist class the router assigned
    request_id: text().notNull(), // NOT a FK — may be a synthetic replay id
    evidence: text().notNull(),
    meta: text(), // JSON blob (structured detail; e.g. inject/render sites)
    status: text().notNull(), // pending, routed, confirmed, dismissed
    dedup_key: text().notNull(),
    ...Timestamps,
  },
  (table) => [
    index("web_signal_session_idx").on(table.session_id),
    index("web_signal_status_idx").on(table.session_id, table.status),
    uniqueIndex("web_signal_dedup_idx").on(table.session_id, table.dedup_key),
  ],
)
