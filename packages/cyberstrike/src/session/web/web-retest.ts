import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import z from "zod"
import { Database, eq, and } from "../../storage/db"
import { WebRetestQueueTable, RequestTable } from "../session.sql"
import { Identifier } from "../../id/id"

// The retest queue is a SCENARIO queue keyed by simplified endpoint (key_hash) — ONE entry
// per endpoint, never per request-instance. Each trigger family (a new role / credential /
// object-value / signal discovered) appends its distinct VALUES to that endpoint's flags. So
// the same endpoint is never queued twice; instead its flags accumulate, and the specialist
// that picks it up reads all flags + observations and tests them together (sweeping values,
// swapping credentials). An examined endpoint re-opens only when a genuinely NEW flag value
// appears (one not in its examined snapshot) — a re-seen value is a no-op.
const FlagType = z.enum(["object_value", "role", "signal", "credential"])
export type FlagType = z.infer<typeof FlagType>

const Status = z.enum(["pending", "examined"])
const Priority = z.enum(["high", "medium", "low"])

const Flags = z
  .object({
    object_value: z.array(z.string()).optional(),
    role: z.array(z.string()).optional(),
    signal: z.array(z.string()).optional(),
    credential: z.array(z.string()).optional(),
  })
  .default({})
type Flags = z.infer<typeof Flags>

const priorityOrder = { high: 0, medium: 1, low: 2 } as const

export namespace WebRetest {
  export const Info = z
    .object({
      id: z.string(),
      session_id: z.string(),
      key_hash: z.string(),
      status: Status,
      priority: Priority,
      flags: Flags,
      // The endpoint this scenario targets (resolved from key_hash) — so the TUI/orchestrator
      // sees WHICH endpoint, not just a hash.
      method: z.string().optional(),
      endpoint: z.string().optional(),
      time: z.object({ created: z.number(), updated: z.number() }),
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

  function parseFlags(raw: unknown): Flags {
    if (!raw || typeof raw !== "object") return {}
    return raw as Flags
  }

  // Merge a value into one flag family (dedup). Returns the new flags + whether it changed.
  function addValue(flags: Flags, type: FlagType, value: string): { flags: Flags; added: boolean } {
    const list = flags[type] ?? []
    if (list.includes(value)) return { flags, added: false }
    return { flags: { ...flags, [type]: [...list, value] }, added: true }
  }

  function bumpPriority(current: string, next: z.infer<typeof Priority>): z.infer<typeof Priority> {
    const cur = current as z.infer<typeof Priority>
    return priorityOrder[next] < priorityOrder[cur] ? next : cur
  }

  function publish(sessionID: string): void {
    const queue = getPending(sessionID)
    Database.effect(() => Bus.publish(Event.Updated, { sessionID, queue }))
  }

  /**
   * Flag ONE endpoint (key_hash) with a discovered value. Upsert semantics:
   *  - endpoint not queued        → create it pending with this flag value
   *  - endpoint pending           → append the value to its flags (no new row)
   *  - endpoint already examined  → re-open (pending) only if the value is genuinely new
   *                                 (absent from the examined snapshot); otherwise no-op
   * Returns true if the queue changed (new row, new value, or re-open).
   */
  export function flag(input: {
    sessionID: string
    keyHash: string
    type: FlagType
    value: string
    priority?: z.infer<typeof Priority>
  }): boolean {
    const priority = input.priority ?? "medium"
    const now = Date.now()
    const changed = Database.use((db) => {
      const row = db
        .select()
        .from(WebRetestQueueTable)
        .where(and(eq(WebRetestQueueTable.session_id, input.sessionID), eq(WebRetestQueueTable.key_hash, input.keyHash)))
        .get()

      if (!row) {
        db.insert(WebRetestQueueTable)
          .values({
            id: Identifier.ascending("web_retest"),
            session_id: input.sessionID,
            key_hash: input.keyHash,
            status: "pending",
            priority,
            flags: addValue({}, input.type, input.value).flags,
            examined_flags: null,
            time_created: now,
            time_updated: now,
          })
          .run()
        return true
      }

      const flags = parseFlags(row.flags)
      const merged = addValue(flags, input.type, input.value)

      if (row.status === "pending") {
        if (!merged.added && bumpPriority(row.priority, priority) === row.priority) return false
        db.update(WebRetestQueueTable)
          .set({ flags: merged.flags, priority: bumpPriority(row.priority, priority), time_updated: now })
          .where(eq(WebRetestQueueTable.id, row.id))
          .run()
        return merged.added
      }

      // examined — re-open only for a genuinely new value (not in the examined snapshot)
      const examined = parseFlags(row.examined_flags)
      const alreadyExamined = (examined[input.type] ?? []).includes(input.value)
      if (alreadyExamined) return false
      db.update(WebRetestQueueTable)
        .set({ status: "pending", flags: merged.flags, priority: bumpPriority(row.priority, priority), time_updated: now })
        .where(eq(WebRetestQueueTable.id, row.id))
        .run()
      return true
    })
    if (changed) publish(input.sessionID)
    return changed
  }

  /**
   * Flag EVERY captured endpoint in the session with a discovered value — for triggers that
   * are session-wide, not endpoint-specific (a new role or credential applies to all
   * endpoints for access-control retesting). Endpoint-specific triggers (a signal, an object
   * value seen on one endpoint) use `flag` with the relevant key_hash instead.
   */
  export function flagAll(input: {
    sessionID: string
    type: FlagType
    value: string
    priority?: z.infer<typeof Priority>
  }): number {
    const keyHashes = Database.use((db) =>
      db
        .selectDistinct({ key_hash: RequestTable.key_hash })
        .from(RequestTable)
        .where(eq(RequestTable.session_id, input.sessionID))
        .all()
        .map((r) => r.key_hash)
        .filter((k): k is string => !!k),
    )
    let changed = 0
    for (const keyHash of keyHashes) {
      if (flag({ sessionID: input.sessionID, keyHash, type: input.type, value: input.value, priority: input.priority }))
        changed++
    }
    return changed
  }

  /** Pending scenarios, highest priority first, with each endpoint's method+path resolved. */
  export function getPending(sessionID: string): Info[] {
    const rows = Database.use((db) =>
      db
        .select()
        .from(WebRetestQueueTable)
        .where(and(eq(WebRetestQueueTable.session_id, sessionID), eq(WebRetestQueueTable.status, "pending")))
        .all(),
    )
    rows.sort((a, b) => {
      const pa = priorityOrder[a.priority as keyof typeof priorityOrder]
      const pb = priorityOrder[b.priority as keyof typeof priorityOrder]
      return pa !== pb ? pa - pb : a.time_created - b.time_created
    })

    // Resolve each endpoint's method+path from one representative request row (key_hash join).
    // The site root (GET /) normalizes to an EMPTY normalized_path, which would leave the endpoint
    // label blank and make the TUI fall back to the raw key_hash — so fall back to canonical_path
    // (always populated, "/" for the root) when normalized_path is empty.
    const keyHashes = [...new Set(rows.map((r) => r.key_hash))]
    const epMap = new Map<string, { method: string; path: string }>()
    if (keyHashes.length) {
      Database.use((db) => {
        for (const req of db
          .select({
            key_hash: RequestTable.key_hash,
            method: RequestTable.method,
            path: RequestTable.normalized_path,
            canonical: RequestTable.canonical_path,
          })
          .from(RequestTable)
          .where(eq(RequestTable.session_id, sessionID))
          .all()) {
          if (req.key_hash && !epMap.has(req.key_hash))
            epMap.set(req.key_hash, { method: req.method, path: req.path || req.canonical || "/" })
        }
      })
    }

    return rows.map((row) => {
      const ep = epMap.get(row.key_hash)
      return {
        id: row.id,
        session_id: row.session_id,
        key_hash: row.key_hash,
        status: row.status as Info["status"],
        priority: row.priority as Info["priority"],
        flags: parseFlags(row.flags),
        method: ep?.method,
        endpoint: ep?.path,
        time: { created: row.time_created, updated: row.time_updated },
      }
    })
  }

  /** Mark an endpoint examined + snapshot its current flags (so only NEW values re-open it). */
  export function markExamined(sessionID: string, keyHash: string): void {
    const now = Date.now()
    const changed = Database.use((db) => {
      const row = db
        .select()
        .from(WebRetestQueueTable)
        .where(
          and(
            eq(WebRetestQueueTable.session_id, sessionID),
            eq(WebRetestQueueTable.key_hash, keyHash),
            eq(WebRetestQueueTable.status, "pending"),
          ),
        )
        .get()
      if (!row) return false
      db.update(WebRetestQueueTable)
        .set({ status: "examined", examined_flags: parseFlags(row.flags), time_updated: now })
        .where(eq(WebRetestQueueTable.id, row.id))
        .run()
      return true
    })
    if (changed) publish(sessionID)
  }

  /**
   * Testing a request's endpoint marks its scenario examined (drains it from the queue). The
   * caller passes a request id (from a coverage note / finding evidence); we resolve it to the
   * endpoint's key_hash. Returns true if a pending scenario was closed.
   */
  export function completeForRequest(sessionID: string, requestID: string): boolean {
    const keyHash = Database.use((db) =>
      db
        .select({ key_hash: RequestTable.key_hash })
        .from(RequestTable)
        .where(and(eq(RequestTable.session_id, sessionID), eq(RequestTable.id, requestID)))
        .get(),
    )?.key_hash
    if (!keyHash) return false
    const before = count(sessionID).pending
    markExamined(sessionID, keyHash)
    return count(sessionID).pending < before
  }

  export function count(sessionID: string): { pending: number; examined: number } {
    const rows = Database.use((db) =>
      db
        .select({ status: WebRetestQueueTable.status })
        .from(WebRetestQueueTable)
        .where(eq(WebRetestQueueTable.session_id, sessionID))
        .all(),
    )
    return {
      pending: rows.filter((r) => r.status === "pending").length,
      examined: rows.filter((r) => r.status === "examined").length,
    }
  }
}
