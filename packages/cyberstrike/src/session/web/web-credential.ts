import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import z from "zod"
import { Database, eq, and } from "../../storage/db"
import { WebCredentialTable } from "../session.sql"
import { Identifier } from "../../id/id"

// Common auth headers to track
export const COMMON_AUTH_HEADERS = [
  "authorization",
  "cookie",
  "x-auth-token",
  "x-api-key",
  "x-access-token",
  "x-session-token",
  "x-csrf-token",
]

export namespace WebCredential {
  export const Info = z
    .object({
      id: z.string(),
      session_id: z.string(),
      label: z.string(),
      headers: z.record(z.string(), z.string()),
      container_id: z.string().optional(),
      role_id: z.string().optional(),
      time: z.object({
        created: z.number(),
        updated: z.number(),
      }),
    })
    .meta({ ref: "WebCredential" })
  export type Info = z.infer<typeof Info>

  export const Event = {
    Updated: BusEvent.define(
      "web_credential.updated",
      z.object({
        sessionID: z.string(),
        credentials: z.array(Info),
      }),
    ),
  }

  export function add(input: {
    sessionID: string
    label: string
    headers?: Record<string, string>
    containerID?: string
    roleID?: string
  }): Info {
    const id = Identifier.ascending("web_credential")
    const now = Date.now()

    Database.use((db) => {
      db.insert(WebCredentialTable)
        .values({
          id,
          session_id: input.sessionID,
          label: input.label,
          headers: input.headers ?? {},
          container_id: input.containerID ?? null,
          role_id: input.roleID ?? null,
          time_created: now,
          time_updated: now,
        })
        .run()
    })

    const list = get(input.sessionID)
    Bus.publish(Event.Updated, { sessionID: input.sessionID, credentials: list })

    return {
      id,
      session_id: input.sessionID,
      label: input.label,
      headers: input.headers ?? {},
      container_id: input.containerID,
      role_id: input.roleID,
      time: { created: now, updated: now },
    }
  }

  export function get(sessionID: string): Info[] {
    const rows = Database.use((db) =>
      db.select().from(WebCredentialTable).where(eq(WebCredentialTable.session_id, sessionID)).all(),
    )
    return rows.map((row) => ({
      id: row.id,
      session_id: row.session_id,
      label: row.label,
      headers: (row.headers as Record<string, string>) ?? {},
      container_id: row.container_id ?? undefined,
      role_id: row.role_id ?? undefined,
      time: { created: row.time_created, updated: row.time_updated },
    }))
  }

  export function getById(id: string): Info | undefined {
    const row = Database.use((db) => db.select().from(WebCredentialTable).where(eq(WebCredentialTable.id, id)).get())
    if (!row) return undefined
    return {
      id: row.id,
      session_id: row.session_id,
      label: row.label,
      headers: (row.headers as Record<string, string>) ?? {},
      container_id: row.container_id ?? undefined,
      role_id: row.role_id ?? undefined,
      time: { created: row.time_created, updated: row.time_updated },
    }
  }

  export function getByContainer(sessionID: string, containerID: string): Info | undefined {
    const row = Database.use((db) =>
      db
        .select()
        .from(WebCredentialTable)
        .where(and(eq(WebCredentialTable.session_id, sessionID), eq(WebCredentialTable.container_id, containerID)))
        .get(),
    )
    if (!row) return undefined
    return {
      id: row.id,
      session_id: row.session_id,
      label: row.label,
      headers: (row.headers as Record<string, string>) ?? {},
      container_id: row.container_id ?? undefined,
      role_id: row.role_id ?? undefined,
      time: { created: row.time_created, updated: row.time_updated },
    }
  }

  export function link(input: { id: string; roleID: string }): void {
    const now = Date.now()
    Database.use((db) => {
      const row = db
        .update(WebCredentialTable)
        .set({ role_id: input.roleID, time_updated: now })
        .where(eq(WebCredentialTable.id, input.id))
        .returning()
        .get()
      if (row) {
        const list = get(row.session_id)
        Database.effect(() => Bus.publish(Event.Updated, { sessionID: row.session_id, credentials: list }))
      }
    })
  }

  export function remove(id: string): void {
    Database.use((db) => {
      const row = db.select().from(WebCredentialTable).where(eq(WebCredentialTable.id, id)).get()
      if (row) {
        db.delete(WebCredentialTable).where(eq(WebCredentialTable.id, id)).run()
        const list = get(row.session_id)
        Database.effect(() => Bus.publish(Event.Updated, { sessionID: row.session_id, credentials: list }))
      }
    })
  }

  export function update(input: {
    id: string
    sessionID: string
    headers?: Record<string, string>
    label?: string
    containerID?: string
    roleID?: string
  }): Info | undefined {
    const now = Date.now()

    return Database.use((db) => {
      const existing = db.select().from(WebCredentialTable).where(eq(WebCredentialTable.id, input.id)).get()
      if (!existing) return undefined

      // Session kontrolü
      if (existing.session_id !== input.sessionID) {
        throw new Error(`Credential ${input.id} does not belong to session ${input.sessionID}`)
      }

      const updates: Record<string, unknown> = { time_updated: now }

      if (input.headers !== undefined) {
        updates.headers = input.headers
      }

      if (input.label !== undefined) {
        updates.label = input.label
      }

      if (input.containerID !== undefined) {
        updates.container_id = input.containerID
      }

      if (input.roleID !== undefined) {
        updates.role_id = input.roleID
      }

      db.update(WebCredentialTable).set(updates).where(eq(WebCredentialTable.id, input.id)).run()

      const row = db.select().from(WebCredentialTable).where(eq(WebCredentialTable.id, input.id)).get()
      if (!row) return undefined

      const list = get(row.session_id)
      Database.effect(() => Bus.publish(Event.Updated, { sessionID: row.session_id, credentials: list }))

      return {
        id: row.id,
        session_id: row.session_id,
        label: row.label,
        headers: (row.headers as Record<string, string>) ?? {},
        container_id: row.container_id ?? undefined,
        role_id: row.role_id ?? undefined,
        time: { created: row.time_created, updated: row.time_updated },
      }
    })
  }

  export function exists(sessionID: string, label: string): boolean {
    const rows = Database.use((db) =>
      db.select().from(WebCredentialTable).where(eq(WebCredentialTable.session_id, sessionID)).all(),
    )
    return rows.some((r) => r.label === label)
  }

  export function existsByContainer(sessionID: string, containerID: string): boolean {
    const row = Database.use((db) =>
      db
        .select({ id: WebCredentialTable.id })
        .from(WebCredentialTable)
        .where(and(eq(WebCredentialTable.session_id, sessionID), eq(WebCredentialTable.container_id, containerID)))
        .get(),
    )
    return !!row
  }

  // Helper: JWT token'dan claims çıkar (Authorization header'dan)
  export function extractJWTClaims(headers: Record<string, string>): Record<string, unknown> | undefined {
    const auth = headers["Authorization"] || headers["authorization"]
    if (!auth) return undefined

    const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : auth.trim()

    try {
      const parts = token.split(".")
      if (parts.length !== 3) return undefined

      const payload = parts[1]
      const decoded = Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8")
      return JSON.parse(decoded)
    } catch {
      return undefined
    }
  }
}
