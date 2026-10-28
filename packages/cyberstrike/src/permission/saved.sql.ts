import { sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"
import { ProjectTable } from "../project/project.sql"
import { Timestamps } from "@/storage/schema.sql"

// A permission the user approved with "always". `action` is the permission name and `resource` the pattern it covers.
export const PermissionSavedTable = sqliteTable(
  "permission_saved",
  {
    id: text().primaryKey(),
    project_id: text()
      .notNull()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    action: text().notNull(),
    resource: text().notNull(),
    ...Timestamps,
  },
  (table) => [uniqueIndex("permission_saved_project_action_resource_idx").on(table.project_id, table.action, table.resource)],
)
