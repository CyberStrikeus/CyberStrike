import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core"
import { SessionTable } from "../session/session.sql"

export const TargetNoteTable = sqliteTable(
  "target_note",
  {
    id: text().primaryKey(),
    session_id: text()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    entity_id: text().notNull(),
    title: text().notNull(),
    content: text().notNull(),
    links: text({ mode: "json" }).notNull().$type<string[]>(),
    tags: text({ mode: "json" }).notNull().$type<string[]>(),
    author: text().notNull(),
    time_created: integer().notNull(),
    time_updated: integer().notNull(),
  },
  (table) => [
    index("target_note_session_idx").on(table.session_id),
    index("target_note_entity_idx").on(table.session_id, table.entity_id),
  ],
)
