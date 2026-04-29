// EndpointTemplate — DB-backed cache of normalization shapes per session.
//
// The Tier 2 cache lives here. Each row records a (sessionID, origin, method,
// template) tuple discovered during normalization, with hit_count incrementing
// every time a sibling path matches. Templates are bucketed for O(log n) lookup
// by (session_id, origin, method, segment_count).
//
// This module owns persistence; the matching/scoring algorithm itself stays
// in session/normalize/tier2.ts. The two are bridged by DBTemplateStore at
// the bottom of this file, which adapts the DAO to the TemplateStore
// interface used by the normalization pipeline.

import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import z from "zod"
import { Database, eq, and } from "../../storage/db"
import { EndpointTemplateTable } from "../session.sql"
import { Identifier } from "../../id/id"
import type { EndpointTemplate as EndpointTemplateInfo, Method } from "../normalize/types"
import type { TemplateStore, TemplateUpsertInput } from "../normalize/tier2"

const Source = z.enum(["tier1", "tier3-llm"])
const Method$ = z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"])

export namespace EndpointTemplate {
  export const Info = z
    .object({
      id: z.string(),
      session_id: z.string(),
      origin: z.string(),
      method: Method$,
      template: z.string(),
      segment_count: z.number().int(),
      source: Source,
      confidence: z.number(),
      hit_count: z.number().int(),
      time: z.object({
        created: z.number(),
        updated: z.number(),
      }),
    })
    .meta({ ref: "EndpointTemplate" })
  export type Info = z.infer<typeof Info>

  export const Event = {
    Updated: BusEvent.define(
      "endpoint_template.updated",
      z.object({
        sessionID: z.string(),
        templates: z.array(Info),
      }),
    ),
  }

  export interface FindKey {
    sessionID: string
    origin: string
    method: Method
    segmentCount: number
  }

  export interface UpsertInput extends FindKey {
    template: string
    source: "tier1" | "tier3-llm"
    confidence: number
  }

  /** All templates for a (sessionID, origin, method, segment_count) bucket. */
  export function find(input: FindKey): Info[] {
    const rows = Database.use((db) =>
      db
        .select()
        .from(EndpointTemplateTable)
        .where(
          and(
            eq(EndpointTemplateTable.session_id, input.sessionID),
            eq(EndpointTemplateTable.origin, input.origin),
            eq(EndpointTemplateTable.method, input.method),
            eq(EndpointTemplateTable.segment_count, input.segmentCount),
          ),
        )
        .all(),
    )
    return rows.map(toInfo)
  }

  /** All templates owned by a session — debug/inspection. */
  export function get(sessionID: string): Info[] {
    const rows = Database.use((db) =>
      db.select().from(EndpointTemplateTable).where(eq(EndpointTemplateTable.session_id, sessionID)).all(),
    )
    return rows.map(toInfo)
  }

  /**
   * Insert a new template, or return the existing one with hit_count++ when a
   * (sessionID, origin, method, template) row already exists. The unique
   * lookup matches the endpoint_template_unique_idx and avoids races without
   * a hard UNIQUE constraint.
   */
  export function upsert(input: UpsertInput): Info {
    const existing = findExact(input)
    if (existing) {
      incrementHit(existing.id)
      return { ...existing, hit_count: existing.hit_count + 1 }
    }

    const id = Identifier.ascending("endpoint_template")
    const now = Date.now()
    Database.use((db) => {
      db.insert(EndpointTemplateTable)
        .values({
          id,
          session_id: input.sessionID,
          origin: input.origin,
          method: input.method,
          template: input.template,
          segment_count: input.segmentCount,
          source: input.source,
          confidence: input.confidence,
          hit_count: 1,
          time_created: now,
          time_updated: now,
        })
        .run()
    })

    publish(input.sessionID)
    return {
      id,
      session_id: input.sessionID,
      origin: input.origin,
      method: input.method,
      template: input.template,
      segment_count: input.segmentCount,
      source: input.source,
      confidence: input.confidence,
      hit_count: 1,
      time: { created: now, updated: now },
    }
  }

  /** Bumps hit_count on a known template. No-op if id is unknown. */
  export function incrementHit(id: string): void {
    const now = Date.now()
    Database.use((db) => {
      // Drizzle SQLite doesn't expose an arithmetic UPDATE shortcut; do a
      // read-then-write within the same transactional context.
      const row = db.select().from(EndpointTemplateTable).where(eq(EndpointTemplateTable.id, id)).get()
      if (!row) return
      db.update(EndpointTemplateTable)
        .set({ hit_count: row.hit_count + 1, time_updated: now })
        .where(eq(EndpointTemplateTable.id, id))
        .run()
    })
  }

  function findExact(input: UpsertInput): Info | undefined {
    const row = Database.use((db) =>
      db
        .select()
        .from(EndpointTemplateTable)
        .where(
          and(
            eq(EndpointTemplateTable.session_id, input.sessionID),
            eq(EndpointTemplateTable.origin, input.origin),
            eq(EndpointTemplateTable.method, input.method),
            eq(EndpointTemplateTable.template, input.template),
          ),
        )
        .get(),
    )
    return row ? toInfo(row) : undefined
  }

  function publish(sessionID: string): void {
    const list = get(sessionID)
    Bus.publish(Event.Updated, { sessionID, templates: list })
  }

  function toInfo(row: typeof EndpointTemplateTable.$inferSelect): Info {
    return {
      id: row.id,
      session_id: row.session_id,
      origin: row.origin,
      method: row.method as Method,
      template: row.template,
      segment_count: row.segment_count,
      source: row.source as "tier1" | "tier3-llm",
      confidence: row.confidence,
      hit_count: row.hit_count,
      time: { created: row.time_created, updated: row.time_updated },
    }
  }
}

// ---------- Adapter: bridges the namespace to the TemplateStore interface ----------
//
// The pipeline's Tier 2 layer (normalize/tier2.ts) talks to TemplateStore so
// it can stay store-agnostic. DBTemplateStore wraps the namespace's CRUD and
// reshapes the Info row into the prototype's EndpointTemplateInfo type.

export class DBTemplateStore implements TemplateStore {
  find(sessionID: string, origin: string, method: Method, segmentCount: number): EndpointTemplateInfo[] {
    return EndpointTemplate.find({ sessionID, origin, method, segmentCount }).map(toPipelineShape)
  }

  upsert(input: TemplateUpsertInput): EndpointTemplateInfo {
    const row = EndpointTemplate.upsert({
      sessionID: input.sessionID,
      origin: input.origin,
      method: input.method,
      segmentCount: input.segmentCount,
      template: input.template,
      source: input.source,
      confidence: input.confidence,
    })
    return toPipelineShape(row)
  }

  incrementHit(id: string): void {
    EndpointTemplate.incrementHit(id)
  }
}

function toPipelineShape(row: EndpointTemplate.Info): EndpointTemplateInfo {
  return {
    id: row.id,
    sessionID: row.session_id,
    origin: row.origin,
    method: row.method,
    template: row.template,
    segments: row.template.split("/"),
    segmentCount: row.segment_count,
    source: row.source,
    confidence: row.confidence,
    hitCount: row.hit_count,
    createdAt: row.time.created,
    updatedAt: row.time.updated,
  }
}
