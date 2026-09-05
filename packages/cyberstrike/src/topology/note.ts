import z from "zod"
import { and, asc, eq } from "drizzle-orm"
import { Bus } from "../bus"
import { BusEvent } from "../bus/bus-event"
import { Identifier } from "../id/id"
import { Database } from "../storage/db"
import { TargetNoteTable } from "./topology.sql"

export namespace TargetNote {
  export const Info = z.object({
    id: Identifier.schema("target_note"),
    sessionID: z.string(),
    entityID: z.string(),
    title: z.string(),
    content: z.string(),
    links: z.array(z.string().url()),
    tags: z.array(z.string()),
    author: z.string(),
    time: z.object({
      created: z.number(),
      updated: z.number(),
    }),
  })
  export type Info = z.infer<typeof Info>

  export const Create = z.object({
    entityID: z.string().min(1),
    title: z.string().trim().min(1).max(200),
    content: z.string().trim().min(1).max(20_000),
    links: z.array(z.string().url()).max(20).default([]),
    tags: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
  })

  export const Update = z.object({
    title: z.string().trim().min(1).max(200).optional(),
    content: z.string().trim().min(1).max(20_000).optional(),
    links: z.array(z.string().url()).max(20).optional(),
    tags: z.array(z.string().trim().min(1).max(80)).max(30).optional(),
  })

  export const Event = {
    Updated: BusEvent.define(
      "dossier.note.updated",
      z.object({
        sessionID: z.string(),
        entityID: z.string(),
        count: z.number(),
      }),
    ),
  }

  const map = (row: typeof TargetNoteTable.$inferSelect): Info => ({
    id: row.id,
    sessionID: row.session_id,
    entityID: row.entity_id,
    title: row.title,
    content: row.content,
    links: row.links,
    tags: row.tags,
    author: row.author,
    time: {
      created: row.time_created,
      updated: row.time_updated,
    },
  })

  export function list(sessionID: string, entityID?: string) {
    const rows = Database.use((db) =>
      db
        .select()
        .from(TargetNoteTable)
        .where(
          entityID
            ? and(eq(TargetNoteTable.session_id, sessionID), eq(TargetNoteTable.entity_id, entityID))
            : eq(TargetNoteTable.session_id, sessionID),
        )
        .orderBy(asc(TargetNoteTable.time_created))
        .all(),
    )
    return rows.map(map)
  }

  export function add(sessionID: string, input: z.input<typeof Create>, author = "operator") {
    const data = Create.parse(input)
    const now = Date.now()
    const note: Info = {
      id: Identifier.ascending("target_note"),
      sessionID,
      entityID: data.entityID,
      title: data.title,
      content: data.content,
      links: data.links,
      tags: data.tags,
      author,
      time: { created: now, updated: now },
    }
    Database.use((db) =>
      db
        .insert(TargetNoteTable)
        .values({
          id: note.id,
          session_id: note.sessionID,
          entity_id: note.entityID,
          title: note.title,
          content: note.content,
          links: note.links,
          tags: note.tags,
          author: note.author,
          time_created: now,
          time_updated: now,
        })
        .run(),
    )
    Database.effect(() =>
      Bus.publish(Event.Updated, {
        sessionID,
        entityID: note.entityID,
        count: list(sessionID, note.entityID).length,
      }),
    )
    return note
  }

  export function update(sessionID: string, noteID: string, input: z.input<typeof Update>) {
    const data = Update.parse(input)
    Database.use((db) =>
      db
        .update(TargetNoteTable)
        .set({
          ...data,
          time_updated: Date.now(),
        })
        .where(and(eq(TargetNoteTable.id, noteID), eq(TargetNoteTable.session_id, sessionID)))
        .run(),
    )
    const note = Database.use((db) =>
      db
        .select()
        .from(TargetNoteTable)
        .where(and(eq(TargetNoteTable.id, noteID), eq(TargetNoteTable.session_id, sessionID)))
        .get(),
    )
    if (!note) return
    Database.effect(() =>
      Bus.publish(Event.Updated, {
        sessionID,
        entityID: note.entity_id,
        count: list(sessionID, note.entity_id).length,
      }),
    )
    return map(note)
  }

  export function remove(sessionID: string, noteID: string) {
    const note = Database.use((db) =>
      db
        .select()
        .from(TargetNoteTable)
        .where(and(eq(TargetNoteTable.id, noteID), eq(TargetNoteTable.session_id, sessionID)))
        .get(),
    )
    if (!note) return false
    Database.use((db) =>
      db
        .delete(TargetNoteTable)
        .where(and(eq(TargetNoteTable.id, noteID), eq(TargetNoteTable.session_id, sessionID)))
        .run(),
    )
    Database.effect(() =>
      Bus.publish(Event.Updated, {
        sessionID,
        entityID: note.entity_id,
        count: list(sessionID, note.entity_id).length,
      }),
    )
    return true
  }
}
