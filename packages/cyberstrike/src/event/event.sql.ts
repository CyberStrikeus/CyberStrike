import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core"
import { ProjectTable } from "../project/project.sql"

export const EngagementEventTable = sqliteTable(
  "engagement_event",
  {
    id: text().primaryKey(),
    project_id: text()
      .notNull()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    session_id: text(),
    type: text().notNull(),
    source: text().notNull(),
    correlation_id: text(),
    parent_id: text(),
    data: text({ mode: "json" }).notNull().$type<Record<string, unknown>>(),
    time_created: integer().notNull(),
  },
  (table) => [
    index("engagement_event_project_time_idx").on(table.project_id, table.time_created),
    index("engagement_event_session_time_idx").on(table.session_id, table.time_created),
    index("engagement_event_correlation_idx").on(table.correlation_id),
  ],
)
