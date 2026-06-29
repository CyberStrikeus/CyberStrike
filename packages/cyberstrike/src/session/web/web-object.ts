import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import z from "zod"
import { Database, eq, and, desc } from "../../storage/db"
import { WebObjectTable, WebObjectValueTable, RequestTable } from "../session.sql"
import { Identifier } from "../../id/id"

export namespace WebObject {
  export const Info = z
    .object({
      id: z.string(),
      session_id: z.string(),
      name: z.string(),
      fields: z.array(z.string()).optional(),
      sensitive_fields: z.array(z.string()).optional(),
      id_fields: z.array(z.string()).optional(),
      discovered_from: z.string().optional(),
      time: z.object({
        created: z.number(),
        updated: z.number(),
      }),
    })
    .meta({ ref: "WebObject" })
  export type Info = z.infer<typeof Info>

  export const ValueInfo = z
    .object({
      id: z.string(),
      session_id: z.string(),
      object_id: z.string(),
      field_name: z.string(),
      value: z.string(),
      credential_id: z.string().optional(),
      discovered_from: z.string().optional(),
      time: z.object({
        created: z.number(),
        updated: z.number(),
      }),
    })
    .meta({ ref: "WebObjectValue" })
  export type ValueInfo = z.infer<typeof ValueInfo>

  export const Event = {
    Updated: BusEvent.define(
      "web_object.updated",
      z.object({
        sessionID: z.string(),
        objects: z.array(Info),
      }),
    ),
    ValueUpdated: BusEvent.define(
      "web_object_value.updated",
      z.object({
        sessionID: z.string(),
        objectID: z.string(),
        values: z.array(ValueInfo),
      }),
    ),
  }

  export function add(input: {
    sessionID: string
    name: string
    fields?: string[]
    sensitiveFields?: string[]
    idFields?: string[]
    discoveredFrom?: string
  }): Info {
    // Check if object already exists, if so merge fields
    const existing = getByName(input.sessionID, input.name)
    if (existing) {
      return merge(existing.id, {
        fields: input.fields,
        sensitiveFields: input.sensitiveFields,
        idFields: input.idFields,
      })
    }

    const id = Identifier.ascending("web_object")
    const now = Date.now()
    const reqId = currentRequestId(input.sessionID)

    Database.use((db) => {
      db.insert(WebObjectTable)
        .values({
          id,
          session_id: input.sessionID,
          name: input.name,
          fields: input.fields ?? null,
          sensitive_fields: input.sensitiveFields ?? null,
          id_fields: input.idFields ?? null,
          discovered_from: input.discoveredFrom ?? null,
          created_request_id: reqId ?? null,
          updated_request_ids: reqId ? [reqId] : null,
          time_created: now,
          time_updated: now,
        })
        .run()
    })

    const list = get(input.sessionID)
    Bus.publish(Event.Updated, { sessionID: input.sessionID, objects: list })

    return {
      id,
      session_id: input.sessionID,
      name: input.name,
      fields: input.fields,
      sensitive_fields: input.sensitiveFields,
      id_fields: input.idFields,
      discovered_from: input.discoveredFrom,
      time: { created: now, updated: now },
    }
  }

  export function merge(
    id: string,
    input: {
      fields?: string[]
      sensitiveFields?: string[]
      idFields?: string[]
    },
  ): Info {
    const now = Date.now()
    const row = Database.use((db) => {
      const existing = db.select().from(WebObjectTable).where(eq(WebObjectTable.id, id)).get()
      if (!existing) throw new Error(`WebObject not found: ${id}`)

      const mergedFields = [...new Set([...(existing.fields ?? []), ...(input.fields ?? [])])]
      const mergedSensitive = [...new Set([...(existing.sensitive_fields ?? []), ...(input.sensitiveFields ?? [])])]
      const mergedIdFields = [...new Set([...(existing.id_fields ?? []), ...(input.idFields ?? [])])]
      // Stamp the request whose analysis touched this object (provenance for scoping).
      const reqId = currentRequestId(existing.session_id)
      const mergedReqIds = reqId
        ? [...new Set([...(existing.updated_request_ids ?? []), reqId])]
        : (existing.updated_request_ids ?? null)

      return db
        .update(WebObjectTable)
        .set({
          fields: mergedFields.length > 0 ? mergedFields : null,
          sensitive_fields: mergedSensitive.length > 0 ? mergedSensitive : null,
          id_fields: mergedIdFields.length > 0 ? mergedIdFields : null,
          updated_request_ids: mergedReqIds,
          time_updated: now,
        })
        .where(eq(WebObjectTable.id, id))
        .returning()
        .get()
    })

    if (!row) throw new Error(`WebObject not found: ${id}`)

    const list = get(row.session_id)
    Bus.publish(Event.Updated, { sessionID: row.session_id, objects: list })

    return {
      id: row.id,
      session_id: row.session_id,
      name: row.name,
      fields: row.fields ?? undefined,
      sensitive_fields: row.sensitive_fields ?? undefined,
      id_fields: row.id_fields ?? undefined,
      discovered_from: row.discovered_from ?? undefined,
      time: { created: row.time_created, updated: row.time_updated },
    }
  }

  export function get(sessionID: string): Info[] {
    const rows = Database.use((db) =>
      db.select().from(WebObjectTable).where(eq(WebObjectTable.session_id, sessionID)).all(),
    )
    return rows.map((row) => ({
      id: row.id,
      session_id: row.session_id,
      name: row.name,
      fields: row.fields ?? undefined,
      sensitive_fields: row.sensitive_fields ?? undefined,
      id_fields: row.id_fields ?? undefined,
      discovered_from: row.discovered_from ?? undefined,
      time: { created: row.time_created, updated: row.time_updated },
    }))
  }

  export function getById(id: string): Info | undefined {
    const row = Database.use((db) => db.select().from(WebObjectTable).where(eq(WebObjectTable.id, id)).get())
    if (!row) return undefined
    return {
      id: row.id,
      session_id: row.session_id,
      name: row.name,
      fields: row.fields ?? undefined,
      sensitive_fields: row.sensitive_fields ?? undefined,
      id_fields: row.id_fields ?? undefined,
      discovered_from: row.discovered_from ?? undefined,
      time: { created: row.time_created, updated: row.time_updated },
    }
  }

  export function getByName(sessionID: string, name: string): Info | undefined {
    const row = Database.use((db) =>
      db
        .select()
        .from(WebObjectTable)
        .where(and(eq(WebObjectTable.session_id, sessionID), eq(WebObjectTable.name, name)))
        .get(),
    )
    if (!row) return undefined
    return {
      id: row.id,
      session_id: row.session_id,
      name: row.name,
      fields: row.fields ?? undefined,
      sensitive_fields: row.sensitive_fields ?? undefined,
      id_fields: row.id_fields ?? undefined,
      discovered_from: row.discovered_from ?? undefined,
      time: { created: row.time_created, updated: row.time_updated },
    }
  }

  export function exists(sessionID: string, name: string): boolean {
    return !!getByName(sessionID, name)
  }

  // Object Value functions
  export function addValue(input: {
    sessionID: string
    objectID: string
    fieldName: string
    value: string
    credentialID?: string
    discoveredFrom?: string
  }): { value: ValueInfo; isNew: boolean } {
    // Check if this value already exists
    const existing = getValueByContent(input.objectID, input.fieldName, input.value)
    if (existing) {
      return { value: existing, isNew: false }
    }

    const id = Identifier.ascending("web_object_value")
    const now = Date.now()

    Database.use((db) => {
      db.insert(WebObjectValueTable)
        .values({
          id,
          session_id: input.sessionID,
          object_id: input.objectID,
          field_name: input.fieldName,
          value: input.value,
          credential_id: input.credentialID ?? null,
          discovered_from: input.discoveredFrom ?? null,
          time_created: now,
          time_updated: now,
        })
        .run()
    })

    const values = getValues(input.objectID)
    Bus.publish(Event.ValueUpdated, {
      sessionID: input.sessionID,
      objectID: input.objectID,
      values,
    })

    return {
      value: {
        id,
        session_id: input.sessionID,
        object_id: input.objectID,
        field_name: input.fieldName,
        value: input.value,
        credential_id: input.credentialID,
        discovered_from: input.discoveredFrom,
        time: { created: now, updated: now },
      },
      isNew: true,
    }
  }

  export function getValues(objectID: string): ValueInfo[] {
    const rows = Database.use((db) =>
      db.select().from(WebObjectValueTable).where(eq(WebObjectValueTable.object_id, objectID)).all(),
    )
    return rows.map((row) => ({
      id: row.id,
      session_id: row.session_id,
      object_id: row.object_id,
      field_name: row.field_name,
      value: row.value,
      credential_id: row.credential_id ?? undefined,
      discovered_from: row.discovered_from ?? undefined,
      time: { created: row.time_created, updated: row.time_updated },
    }))
  }

  export function getAllValues(sessionID: string): ValueInfo[] {
    const rows = Database.use((db) =>
      db.select().from(WebObjectValueTable).where(eq(WebObjectValueTable.session_id, sessionID)).all(),
    )
    return rows.map((row) => ({
      id: row.id,
      session_id: row.session_id,
      object_id: row.object_id,
      field_name: row.field_name,
      value: row.value,
      credential_id: row.credential_id ?? undefined,
      discovered_from: row.discovered_from ?? undefined,
      time: { created: row.time_created, updated: row.time_updated },
    }))
  }

  export function getValueByContent(objectID: string, fieldName: string, value: string): ValueInfo | undefined {
    const row = Database.use((db) =>
      db
        .select()
        .from(WebObjectValueTable)
        .where(
          and(
            eq(WebObjectValueTable.object_id, objectID),
            eq(WebObjectValueTable.field_name, fieldName),
            eq(WebObjectValueTable.value, value),
          ),
        )
        .get(),
    )
    if (!row) return undefined
    return {
      id: row.id,
      session_id: row.session_id,
      object_id: row.object_id,
      field_name: row.field_name,
      value: row.value,
      credential_id: row.credential_id ?? undefined,
      discovered_from: row.discovered_from ?? undefined,
      time: { created: row.time_created, updated: row.time_updated },
    }
  }

  /** The endpoint currently being analyzed for this session — the single request in
   *  'processing' status (the ingest queue is serial per session). Used to stamp object
   *  provenance and to scope context to "objects touched by THIS request". */
  function currentRequestId(sessionID: string): string | undefined {
    const row = Database.use((db) =>
      db
        .select({ id: RequestTable.id })
        .from(RequestTable)
        .where(and(eq(RequestTable.session_id, sessionID), eq(RequestTable.status, "processing")))
        .orderBy(desc(RequestTable.time_created))
        .get(),
    )
    return row?.id
  }

  /** Objects whose analysis was created or touched by the given request — the
   *  relevance-scoping primitive for recent-inline context (no vuln-class interpretation). */
  export function touchedByRequest(sessionID: string, requestId: string): Info[] {
    const rows = Database.use((db) =>
      db.select().from(WebObjectTable).where(eq(WebObjectTable.session_id, sessionID)).all(),
    )
    return rows
      .filter((r) => r.created_request_id === requestId || (r.updated_request_ids ?? []).includes(requestId))
      .map((row) => ({
        id: row.id,
        session_id: row.session_id,
        name: row.name,
        fields: row.fields ?? undefined,
        sensitive_fields: row.sensitive_fields ?? undefined,
        id_fields: row.id_fields ?? undefined,
        discovered_from: row.discovered_from ?? undefined,
        time: { created: row.time_created, updated: row.time_updated },
      }))
  }
}
