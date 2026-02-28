import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import z from "zod"
import { Database, eq, and } from "../../storage/db"
import { WebRoleTable } from "../session.sql"
import { Identifier } from "../../id/id"

export namespace WebRole {
  export const Info = z
    .object({
      id: z.string(),
      session_id: z.string(),
      name: z.string(),
      level: z.number().optional(),
      discovered_from: z.string().optional(),
      time: z.object({
        created: z.number(),
        updated: z.number(),
      }),
    })
    .meta({ ref: "WebRole" })
  export type Info = z.infer<typeof Info>

  export const Event = {
    Updated: BusEvent.define(
      "web_role.updated",
      z.object({
        sessionID: z.string(),
        roles: z.array(Info),
      }),
    ),
  }

  export function add(input: { sessionID: string; name: string; level?: number; discoveredFrom?: string }): Info {
    // Check if role already exists
    const existing = getByName(input.sessionID, input.name)
    if (existing) return existing

    const id = Identifier.ascending("web_role")
    const now = Date.now()

    Database.use((db) => {
      db.insert(WebRoleTable)
        .values({
          id,
          session_id: input.sessionID,
          name: input.name,
          level: input.level ?? null,
          discovered_from: input.discoveredFrom ?? null,
          time_created: now,
          time_updated: now,
        })
        .run()
    })

    const list = get(input.sessionID)
    Bus.publish(Event.Updated, { sessionID: input.sessionID, roles: list })

    return {
      id,
      session_id: input.sessionID,
      name: input.name,
      level: input.level,
      discovered_from: input.discoveredFrom,
      time: { created: now, updated: now },
    }
  }

  export function get(sessionID: string): Info[] {
    const rows = Database.use((db) =>
      db.select().from(WebRoleTable).where(eq(WebRoleTable.session_id, sessionID)).all(),
    )
    return rows.map((row) => ({
      id: row.id,
      session_id: row.session_id,
      name: row.name,
      level: row.level ?? undefined,
      discovered_from: row.discovered_from ?? undefined,
      time: { created: row.time_created, updated: row.time_updated },
    }))
  }

  export function getById(id: string): Info | undefined {
    const row = Database.use((db) => db.select().from(WebRoleTable).where(eq(WebRoleTable.id, id)).get())
    if (!row) return undefined
    return {
      id: row.id,
      session_id: row.session_id,
      name: row.name,
      level: row.level ?? undefined,
      discovered_from: row.discovered_from ?? undefined,
      time: { created: row.time_created, updated: row.time_updated },
    }
  }

  export function getByName(sessionID: string, name: string): Info | undefined {
    const row = Database.use((db) =>
      db
        .select()
        .from(WebRoleTable)
        .where(and(eq(WebRoleTable.session_id, sessionID), eq(WebRoleTable.name, name)))
        .get(),
    )
    if (!row) return undefined
    return {
      id: row.id,
      session_id: row.session_id,
      name: row.name,
      level: row.level ?? undefined,
      discovered_from: row.discovered_from ?? undefined,
      time: { created: row.time_created, updated: row.time_updated },
    }
  }

  export function exists(sessionID: string, name: string): boolean {
    return !!getByName(sessionID, name)
  }

  export function updateLevel(input: { id: string; level: number }): void {
    const now = Date.now()
    Database.use((db) => {
      const row = db
        .update(WebRoleTable)
        .set({ level: input.level, time_updated: now })
        .where(eq(WebRoleTable.id, input.id))
        .returning()
        .get()
      if (row) {
        const list = get(row.session_id)
        Database.effect(() => Bus.publish(Event.Updated, { sessionID: row.session_id, roles: list }))
      }
    })
  }

  export function remove(id: string): void {
    Database.use((db) => {
      const row = db.select().from(WebRoleTable).where(eq(WebRoleTable.id, id)).get()
      if (row) {
        db.delete(WebRoleTable).where(eq(WebRoleTable.id, id)).run()
        const list = get(row.session_id)
        Database.effect(() => Bus.publish(Event.Updated, { sessionID: row.session_id, roles: list }))
      }
    })
  }
}
