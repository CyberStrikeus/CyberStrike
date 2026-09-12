import { sqliteTable, text, uniqueIndex, index } from "drizzle-orm/sqlite-core"
import { SessionTable } from "@/session/session.sql"
import { Timestamps } from "@/storage/schema.sql"

export const InspectionQueueTable = sqliteTable(
  "inspection_queue",
  {
    id: text().primaryKey(),
    session_id: text()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    domain: text().notNull(),
    target_key: text().notNull(),
    target_label: text(),
    target_meta: text({ mode: "json" }).$type<Record<string, unknown>>(),
    status: text().notNull(), // "pending" | "examined"
    priority: text().notNull(), // "high" | "medium" | "low"
    evidence: text({ mode: "json" }).$type<Record<string, string[]>>(),
    examined_evidence: text({ mode: "json" }).$type<Record<string, string[]>>(),
    ...Timestamps,
  },
  (table) => [
    uniqueIndex("inspection_queue_target_idx").on(
      table.session_id,
      table.domain,
      table.target_key,
    ),
    index("inspection_queue_status_idx").on(
      table.session_id,
      table.domain,
      table.status,
    ),
  ],
)
