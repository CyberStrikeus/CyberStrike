import { sqliteTable, text, integer, primaryKey, uniqueIndex } from "drizzle-orm/sqlite-core"
import { SessionTable } from "./session.sql"

// Durable per-session event log. `seq` is the aggregate sequence within one session, starting at 1.
export const SessionLogTable = sqliteTable(
  "session_log",
  {
    id: text().primaryKey(),
    session_id: text()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    seq: integer().notNull(),
    type: text().notNull(),
    version: integer().notNull(),
    data: text({ mode: "json" }).notNull().$type<Record<string, unknown>>(),
    time_created: integer().notNull(),
  },
  (table) => [uniqueIndex("session_log_seq_idx").on(table.session_id, table.seq)],
)

// API-managed instruction entries attached to one session. Values are JSON, keyed by the client-facing key.
export const SessionInstructionTable = sqliteTable(
  "session_instruction",
  {
    session_id: text()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    key: text().notNull(),
    value: text({ mode: "json" }).notNull().$type<unknown>(),
    time_created: integer().notNull(),
    time_updated: integer().notNull(),
  },
  (table) => [primaryKey({ columns: [table.session_id, table.key] })],
)
