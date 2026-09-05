import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core"
import { ProjectTable } from "../project/project.sql"

export const MemoryEntryTable = sqliteTable(
  "memory_entry",
  {
    id: text().primaryKey(),
    project_id: text()
      .notNull()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    session_id: text(),
    kind: text().notNull(),
    title: text().notNull(),
    content: text().notNull(),
    source: text().notNull(),
    trust: text().notNull(),
    confidence: real().notNull(),
    tags: text({ mode: "json" }).notNull().$type<string[]>(),
    related_ids: text({ mode: "json" }).notNull().$type<string[]>(),
    metadata: text({ mode: "json" }).notNull().$type<Record<string, unknown>>(),
    redacted: integer({ mode: "boolean" }).notNull(),
    valid_from: integer().notNull(),
    invalid_at: integer(),
    use_count: integer().notNull().default(0),
    last_used_at: integer(),
    time_created: integer().notNull(),
    time_updated: integer().notNull(),
  },
  (table) => [
    index("memory_entry_project_idx").on(table.project_id),
    index("memory_entry_session_idx").on(table.project_id, table.session_id),
    index("memory_entry_kind_idx").on(table.project_id, table.kind),
    index("memory_entry_valid_idx").on(table.project_id, table.invalid_at),
  ],
)
