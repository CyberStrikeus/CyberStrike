import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import z from "zod"
import { Database, eq, and, asc } from "../../storage/db"
import { WebRetestQueueTable, RequestTable } from "../session.sql"
import { Identifier } from "../../id/id"

const TriggerType = z.enum(["new_role", "new_object_value", "new_credential"])
const Status = z.enum(["pending", "processing", "completed"])
const Priority = z.enum(["high", "medium", "low"])

export namespace WebRetest {
  export const Info = z
    .object({
      id: z.string(),
      session_id: z.string(),
      request_id: z.string(),
      trigger_type: TriggerType,
      trigger_source: z.string(),
      status: Status,
      priority: Priority,
      time: z.object({
        created: z.number(),
        updated: z.number(),
      }),
    })
    .meta({ ref: "WebRetest" })
  export type Info = z.infer<typeof Info>

  export const Event = {
    Updated: BusEvent.define(
      "web_retest.updated",
      z.object({
        sessionID: z.string(),
        queue: z.array(Info),
      }),
    ),
  }

  // Priority order for sorting
  const priorityOrder = { high: 0, medium: 1, low: 2 }

  export function enqueue(input: {
    sessionID: string
    requestID: string
    triggerType: z.infer<typeof TriggerType>
    triggerSource: string
    priority: z.infer<typeof Priority>
  }): Info {
    // Check if already queued
    const existing = Database.use((db) =>
      db
        .select()
        .from(WebRetestQueueTable)
        .where(
          and(
            eq(WebRetestQueueTable.session_id, input.sessionID),
            eq(WebRetestQueueTable.request_id, input.requestID),
            eq(WebRetestQueueTable.status, "pending"),
          ),
        )
        .get(),
    )

    if (existing) {
      // If already queued, upgrade priority if new one is higher
      const existingPriority = priorityOrder[existing.priority as keyof typeof priorityOrder]
      const newPriority = priorityOrder[input.priority]
      if (newPriority < existingPriority) {
        return updatePriority(existing.id, input.priority)
      }
      return {
        id: existing.id,
        session_id: existing.session_id,
        request_id: existing.request_id,
        trigger_type: existing.trigger_type as Info["trigger_type"],
        trigger_source: existing.trigger_source,
        status: existing.status as Info["status"],
        priority: existing.priority as Info["priority"],
        time: { created: existing.time_created, updated: existing.time_updated },
      }
    }

    const id = Identifier.ascending("web_retest")
    const now = Date.now()

    Database.use((db) => {
      db.insert(WebRetestQueueTable)
        .values({
          id,
          session_id: input.sessionID,
          request_id: input.requestID,
          trigger_type: input.triggerType,
          trigger_source: input.triggerSource,
          status: "pending",
          priority: input.priority,
          time_created: now,
          time_updated: now,
        })
        .run()
    })

    const queue = getPending(input.sessionID)
    Bus.publish(Event.Updated, { sessionID: input.sessionID, queue })

    return {
      id,
      session_id: input.sessionID,
      request_id: input.requestID,
      trigger_type: input.triggerType,
      trigger_source: input.triggerSource,
      status: "pending",
      priority: input.priority,
      time: { created: now, updated: now },
    }
  }

  export function updatePriority(id: string, priority: z.infer<typeof Priority>): Info {
    const now = Date.now()
    const row = Database.use((db) =>
      db
        .update(WebRetestQueueTable)
        .set({ priority, time_updated: now })
        .where(eq(WebRetestQueueTable.id, id))
        .returning()
        .get(),
    )

    if (!row) throw new Error(`WebRetest not found: ${id}`)

    const queue = getPending(row.session_id)
    Bus.publish(Event.Updated, { sessionID: row.session_id, queue })

    return {
      id: row.id,
      session_id: row.session_id,
      request_id: row.request_id,
      trigger_type: row.trigger_type as Info["trigger_type"],
      trigger_source: row.trigger_source,
      status: row.status as Info["status"],
      priority: row.priority as Info["priority"],
      time: { created: row.time_created, updated: row.time_updated },
    }
  }

  export function updateStatus(id: string, status: z.infer<typeof Status>): void {
    const now = Date.now()
    Database.use((db) => {
      const row = db
        .update(WebRetestQueueTable)
        .set({ status, time_updated: now })
        .where(eq(WebRetestQueueTable.id, id))
        .returning()
        .get()
      if (row) {
        const queue = getPending(row.session_id)
        Database.effect(() => Bus.publish(Event.Updated, { sessionID: row.session_id, queue }))
      }
    })
  }

  export function next(sessionID: string): Info | undefined {
    // Get pending items sorted by priority then time
    const rows = Database.use((db) =>
      db
        .select()
        .from(WebRetestQueueTable)
        .where(and(eq(WebRetestQueueTable.session_id, sessionID), eq(WebRetestQueueTable.status, "pending")))
        .orderBy(asc(WebRetestQueueTable.time_created))
        .all(),
    )

    if (rows.length === 0) return undefined

    // Sort by priority (high first)
    rows.sort((a, b) => {
      const aPriority = priorityOrder[a.priority as keyof typeof priorityOrder]
      const bPriority = priorityOrder[b.priority as keyof typeof priorityOrder]
      return aPriority - bPriority
    })

    const row = rows[0]
    return {
      id: row.id,
      session_id: row.session_id,
      request_id: row.request_id,
      trigger_type: row.trigger_type as Info["trigger_type"],
      trigger_source: row.trigger_source,
      status: row.status as Info["status"],
      priority: row.priority as Info["priority"],
      time: { created: row.time_created, updated: row.time_updated },
    }
  }

  export function getPending(sessionID: string): Info[] {
    const rows = Database.use((db) =>
      db
        .select()
        .from(WebRetestQueueTable)
        .where(and(eq(WebRetestQueueTable.session_id, sessionID), eq(WebRetestQueueTable.status, "pending")))
        .all(),
    )

    // Sort by priority
    rows.sort((a, b) => {
      const aPriority = priorityOrder[a.priority as keyof typeof priorityOrder]
      const bPriority = priorityOrder[b.priority as keyof typeof priorityOrder]
      if (aPriority !== bPriority) return aPriority - bPriority
      return a.time_created - b.time_created
    })

    return rows.map((row) => ({
      id: row.id,
      session_id: row.session_id,
      request_id: row.request_id,
      trigger_type: row.trigger_type as Info["trigger_type"],
      trigger_source: row.trigger_source,
      status: row.status as Info["status"],
      priority: row.priority as Info["priority"],
      time: { created: row.time_created, updated: row.time_updated },
    }))
  }

  export function count(sessionID: string): { pending: number; processing: number; completed: number } {
    const rows = Database.use((db) =>
      db.select().from(WebRetestQueueTable).where(eq(WebRetestQueueTable.session_id, sessionID)).all(),
    )

    return {
      pending: rows.filter((r) => r.status === "pending").length,
      processing: rows.filter((r) => r.status === "processing").length,
      completed: rows.filter((r) => r.status === "completed").length,
    }
  }

  /**
   * Check if new discoveries should trigger re-tests
   * Returns list of queued re-tests
   */
  export function checkTriggers(input: {
    sessionID: string
    triggerType: z.infer<typeof TriggerType>
    triggerSource: string
    relatedObjectIDs?: string[]
    maxRetests?: number
  }): Info[] {
    const maxRetests = input.maxRetests ?? 20
    const results: Info[] = []

    // Get all requests in the session
    const requests = Database.use((db) =>
      db.select().from(RequestTable).where(eq(RequestTable.session_id, input.sessionID)).all(),
    )

    // Determine priority based on trigger type and relevance
    let priority: z.infer<typeof Priority> = "medium"
    if (input.triggerType === "new_credential") {
      priority = "high"
    } else if (input.triggerType === "new_object_value" && input.relatedObjectIDs?.length) {
      priority = "high"
    }

    // Queue relevant requests for re-test
    let count = 0
    for (const request of requests) {
      if (count >= maxRetests) break

      // Skip if already processed in this trigger
      const existing = Database.use((db) =>
        db
          .select()
          .from(WebRetestQueueTable)
          .where(
            and(
              eq(WebRetestQueueTable.request_id, request.id),
              eq(WebRetestQueueTable.trigger_source, input.triggerSource),
            ),
          )
          .get(),
      )
      if (existing) continue

      const retest = enqueue({
        sessionID: input.sessionID,
        requestID: request.id,
        triggerType: input.triggerType,
        triggerSource: input.triggerSource,
        priority,
      })

      results.push(retest)
      count++
    }

    return results
  }
}
