import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import z from "zod"
import { Database, eq } from "../../storage/db"
import { WebFunctionTable } from "../session.sql"
import { Identifier } from "../../id/id"

const ActionType = z.enum(["create", "read", "update", "delete"])

export namespace WebFunction {
  export const Info = z
    .object({
      id: z.string(),
      session_id: z.string(),
      name: z.string(),
      action_type: ActionType,
      request_id: z.string(),
      role_id: z.string().optional(),
      objects: z.array(z.string()).optional(),
      time: z.object({
        created: z.number(),
        updated: z.number(),
      }),
    })
    .meta({ ref: "WebFunction" })
  export type Info = z.infer<typeof Info>

  export const Event = {
    Updated: BusEvent.define(
      "web_function.updated",
      z.object({
        sessionID: z.string(),
        functions: z.array(Info),
      }),
    ),
  }

  export function add(input: {
    sessionID: string
    name: string
    actionType: z.infer<typeof ActionType>
    requestID: string
    roleID?: string
    objects?: string[]
  }): Info {
    // Check if function already exists for this request
    const existing = getByRequest(input.requestID)
    if (existing) {
      return update(existing.id, {
        name: input.name,
        actionType: input.actionType,
        roleID: input.roleID,
        objects: input.objects,
      })
    }

    const id = Identifier.ascending("web_function")
    const now = Date.now()

    Database.use((db) => {
      db.insert(WebFunctionTable)
        .values({
          id,
          session_id: input.sessionID,
          name: input.name,
          action_type: input.actionType,
          request_id: input.requestID,
          role_id: input.roleID ?? null,
          objects: input.objects ?? null,
          time_created: now,
          time_updated: now,
        })
        .run()
    })

    const list = get(input.sessionID)
    Bus.publish(Event.Updated, { sessionID: input.sessionID, functions: list })

    return {
      id,
      session_id: input.sessionID,
      name: input.name,
      action_type: input.actionType,
      request_id: input.requestID,
      role_id: input.roleID,
      objects: input.objects,
      time: { created: now, updated: now },
    }
  }

  export function update(
    id: string,
    input: {
      name?: string
      actionType?: z.infer<typeof ActionType>
      roleID?: string
      objects?: string[]
    },
  ): Info {
    const now = Date.now()
    const row = Database.use((db) => {
      const existing = db.select().from(WebFunctionTable).where(eq(WebFunctionTable.id, id)).get()
      if (!existing) throw new Error(`WebFunction not found: ${id}`)

      const updates: Record<string, unknown> = { time_updated: now }
      if (input.name !== undefined) updates.name = input.name
      if (input.actionType !== undefined) updates.action_type = input.actionType
      if (input.roleID !== undefined) updates.role_id = input.roleID
      if (input.objects !== undefined) updates.objects = input.objects

      return db.update(WebFunctionTable).set(updates).where(eq(WebFunctionTable.id, id)).returning().get()
    })

    if (!row) throw new Error(`WebFunction not found: ${id}`)

    const list = get(row.session_id)
    Bus.publish(Event.Updated, { sessionID: row.session_id, functions: list })

    return {
      id: row.id,
      session_id: row.session_id,
      name: row.name,
      action_type: row.action_type as Info["action_type"],
      request_id: row.request_id,
      role_id: row.role_id ?? undefined,
      objects: row.objects ?? undefined,
      time: { created: row.time_created, updated: row.time_updated },
    }
  }

  export function get(sessionID: string): Info[] {
    const rows = Database.use((db) =>
      db.select().from(WebFunctionTable).where(eq(WebFunctionTable.session_id, sessionID)).all(),
    )
    return rows.map((row) => ({
      id: row.id,
      session_id: row.session_id,
      name: row.name,
      action_type: row.action_type as Info["action_type"],
      request_id: row.request_id,
      role_id: row.role_id ?? undefined,
      objects: row.objects ?? undefined,
      time: { created: row.time_created, updated: row.time_updated },
    }))
  }

  export function getById(id: string): Info | undefined {
    const row = Database.use((db) => db.select().from(WebFunctionTable).where(eq(WebFunctionTable.id, id)).get())
    if (!row) return undefined
    return {
      id: row.id,
      session_id: row.session_id,
      name: row.name,
      action_type: row.action_type as Info["action_type"],
      request_id: row.request_id,
      role_id: row.role_id ?? undefined,
      objects: row.objects ?? undefined,
      time: { created: row.time_created, updated: row.time_updated },
    }
  }

  export function getByRequest(requestID: string): Info | undefined {
    const row = Database.use((db) =>
      db.select().from(WebFunctionTable).where(eq(WebFunctionTable.request_id, requestID)).get(),
    )
    if (!row) return undefined
    return {
      id: row.id,
      session_id: row.session_id,
      name: row.name,
      action_type: row.action_type as Info["action_type"],
      request_id: row.request_id,
      role_id: row.role_id ?? undefined,
      objects: row.objects ?? undefined,
      time: { created: row.time_created, updated: row.time_updated },
    }
  }

  export function remove(id: string): void {
    Database.use((db) => {
      const row = db.select().from(WebFunctionTable).where(eq(WebFunctionTable.id, id)).get()
      if (row) {
        db.delete(WebFunctionTable).where(eq(WebFunctionTable.id, id)).run()
        const list = get(row.session_id)
        Database.effect(() => Bus.publish(Event.Updated, { sessionID: row.session_id, functions: list }))
      }
    })
  }
}
