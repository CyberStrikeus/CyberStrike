import { PermissionSaved as Saved } from "@opencode/schema/permission-saved"
import { Database, and, asc, eq } from "@/storage/db"
import { PermissionSavedTable } from "./saved.sql"

// Saved permissions persist the "always" approvals per project. PermissionNext reads them back as allow rules.
export namespace PermissionSaved {
  export type Row = typeof PermissionSavedTable.$inferSelect

  export function list(projectID?: string) {
    return Database.use((db) =>
      db
        .select()
        .from(PermissionSavedTable)
        .where(projectID ? eq(PermissionSavedTable.project_id, projectID) : undefined)
        .orderBy(asc(PermissionSavedTable.time_created), asc(PermissionSavedTable.id))
        .all(),
    )
  }

  export function get(id: string) {
    return Database.use((db) => db.select().from(PermissionSavedTable).where(eq(PermissionSavedTable.id, id)).get())
  }

  // Re-approving the same permission and pattern refreshes its timestamp instead of adding a duplicate.
  export function save(projectID: string, action: string, resource: string) {
    const now = Date.now()
    Database.use((db) =>
      db
        .insert(PermissionSavedTable)
        .values({
          id: Saved.ID.create(),
          project_id: projectID,
          action,
          resource,
          time_created: now,
          time_updated: now,
        })
        .onConflictDoUpdate({
          target: [PermissionSavedTable.project_id, PermissionSavedTable.action, PermissionSavedTable.resource],
          set: { time_updated: now },
        })
        .run(),
    )
  }

  // "missing" and "conflict" are the two refusals; a conflict means another saved row already has the new action and resource.
  export function update(id: string, input: { action?: string; resource?: string }) {
    const current = get(id)
    if (!current) return "missing" as const
    const action = input.action ?? current.action
    const resource = input.resource ?? current.resource
    const clash = Database.use((db) =>
      db
        .select()
        .from(PermissionSavedTable)
        .where(
          and(
            eq(PermissionSavedTable.project_id, current.project_id),
            eq(PermissionSavedTable.action, action),
            eq(PermissionSavedTable.resource, resource),
          ),
        )
        .get(),
    )
    if (clash && clash.id !== id) return "conflict" as const
    return Database.use((db) =>
      db
        .update(PermissionSavedTable)
        .set({ action, resource, time_updated: Date.now() })
        .where(eq(PermissionSavedTable.id, id))
        .returning()
        .get(),
    )
  }

  export function remove(id: string) {
    Database.use((db) => db.delete(PermissionSavedTable).where(eq(PermissionSavedTable.id, id)).run())
  }
}
