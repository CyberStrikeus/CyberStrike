import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import z from "zod"
import { Database, eq, and, lt, inArray } from "@/storage/db"
import { InspectionQueueTable } from "./schema"
import { Identifier } from "@/id/id"
import type { InspectionTarget, Evidence, EvidencePriority } from "@cyberstrike-io/plugin"

const Priority = z.enum(["high", "medium", "low"])
// "dispatched" is the in-flight lease state: an item handed to a specialist child-session but not yet
// confirmed examined. It is NOT in `pending()` (so it's never double-dispatched) but IS counted as
// outstanding by `count()` (so the lifecycle never reports "complete" while a specialist is running).
// The lease timestamp is `time_updated` (set on markDispatched); reclaimStale re-opens stale leases.
const Status = z.enum(["pending", "dispatched", "examined"])

type EvidenceMap = Record<string, string[]>

const priorityOrder = { high: 0, medium: 1, low: 2 } as const

const InfoSchema = z
  .object({
    id: z.string(),
    session_id: z.string(),
    domain: z.string(),
    target_key: z.string(),
    target_label: z.string().optional(),
    target_meta: z.record(z.string(), z.unknown()).optional(),
    status: Status,
    priority: Priority,
    evidence: z.record(z.string(), z.array(z.string())).default({}),
    time: z.object({ created: z.number(), updated: z.number() }),
  })
  .meta({ ref: "InspectionQueueItem" })

export type InspectionQueueItem = z.infer<typeof InfoSchema>

const UpdatedEvent = BusEvent.define(
  "inspection.updated",
  z.object({
    sessionID: z.string(),
    domain: z.string(),
    queue: z.array(InfoSchema),
  }),
)

export class InspectionQueue {
  readonly sessionID: string
  readonly domain: string
  // Optional domain hook fired once a target genuinely transitions to "examined" (not on a re-examine
  // no-op). The web domain uses it to advance that endpoint's Vortex signals new → reviewed, so the
  // examination outcome is recorded on the signal. Kept generic (the queue knows nothing about Vortex).
  private readonly onExamined?: (targetKey: string) => void

  static readonly Info = InfoSchema
  static readonly Event = { Updated: UpdatedEvent }

  constructor(sessionID: string, domain: string, onExamined?: (targetKey: string) => void) {
    this.sessionID = sessionID
    this.domain = domain
    this.onExamined = onExamined
  }

  // ── Flag (add evidence) ─────────────────────────────────────────

  flag(target: InspectionTarget, evidence: Evidence): boolean {
    const priority = evidence.priority ?? "medium"
    const now = Date.now()
    const changed = Database.use((db) => {
      const row = db
        .select()
        .from(InspectionQueueTable)
        .where(
          and(
            eq(InspectionQueueTable.session_id, this.sessionID),
            eq(InspectionQueueTable.domain, this.domain),
            eq(InspectionQueueTable.target_key, target.key),
          ),
        )
        .get()

      if (!row) {
        db.insert(InspectionQueueTable)
          .values({
            id: Identifier.ascending("inspection"),
            session_id: this.sessionID,
            domain: this.domain,
            target_key: target.key,
            target_label: target.label,
            target_meta: target.meta,
            status: "pending",
            priority,
            evidence: addValue({}, evidence.type, evidence.value).map,
            examined_evidence: null,
            time_created: now,
            time_updated: now,
          })
          .run()
        return true
      }

      const evMap = parseMap(row.evidence)
      const merged = addValue(evMap, evidence.type, evidence.value)

      if (row.target_label !== target.label || !deepEqualMeta(row.target_meta, target.meta)) {
        db.update(InspectionQueueTable)
          .set({ target_label: target.label, target_meta: target.meta, time_updated: now })
          .where(eq(InspectionQueueTable.id, row.id))
          .run()
      }

      // pending OR dispatched (in-flight): accumulate evidence + bump priority, but keep the status —
      // never reset an in-flight lease back to pending here (that would let it be dispatched a second
      // time concurrently). New evidence on an in-flight item is recorded; if it warrants a re-look the
      // reclaim/complete path re-opens it.
      if (row.status === "pending" || row.status === "dispatched") {
        if (!merged.added && bumpPriority(row.priority, priority) === row.priority) return false
        db.update(InspectionQueueTable)
          .set({
            evidence: merged.map,
            priority: bumpPriority(row.priority, priority),
            time_updated: now,
          })
          .where(eq(InspectionQueueTable.id, row.id))
          .run()
        return merged.added
      }

      // examined — re-open only for genuinely new evidence
      const examined = parseMap(row.examined_evidence)
      const alreadyExamined = (examined[evidence.type] ?? []).includes(evidence.value)
      if (alreadyExamined) return false

      // accumulateOnly evidence is recorded but does NOT re-open the target
      if (evidence.accumulateOnly) {
        if (!merged.added) return false
        db.update(InspectionQueueTable)
          .set({ evidence: merged.map, time_updated: now })
          .where(eq(InspectionQueueTable.id, row.id))
          .run()
        return false
      }

      db.update(InspectionQueueTable)
        .set({
          status: "pending",
          evidence: merged.map,
          priority: bumpPriority(row.priority, priority),
          time_updated: now,
        })
        .where(eq(InspectionQueueTable.id, row.id))
        .run()
      return true
    })
    if (changed) this.publish()
    return changed
  }

  // ── Flag matching (session-wide triggers) ────────────────────────

  flagMatching(
    evidence: Evidence,
    match: (target: InspectionTarget) => boolean,
  ): number {
    const targets = this.allTargets()
    let changed = 0
    for (const t of targets) {
      if (!match(t)) continue
      if (this.flag(t, evidence)) changed++
    }
    return changed
  }

  // ── Read ────────────────────────────────────────────────────────

  pending(): InspectionQueue.Info[] {
    const rows = Database.use((db) =>
      db
        .select()
        .from(InspectionQueueTable)
        .where(
          and(
            eq(InspectionQueueTable.session_id, this.sessionID),
            eq(InspectionQueueTable.domain, this.domain),
            eq(InspectionQueueTable.status, "pending"),
          ),
        )
        .all(),
    )
    rows.sort((a, b) => {
      const pa = priorityOrder[a.priority as keyof typeof priorityOrder]
      const pb = priorityOrder[b.priority as keyof typeof priorityOrder]
      return pa !== pb ? pa - pb : a.time_created - b.time_created
    })
    return rows.map((row) => toInfo(row))
  }

  count(): { pending: number; examined: number; total: number } {
    const rows = Database.use((db) =>
      db
        .select({ status: InspectionQueueTable.status })
        .from(InspectionQueueTable)
        .where(
          and(
            eq(InspectionQueueTable.session_id, this.sessionID),
            eq(InspectionQueueTable.domain, this.domain),
          ),
        )
        .all(),
    )
    // `dispatched` (in-flight) counts as OUTSTANDING alongside pending, so the lifecycle stays
    // "inspecting"/"draining" — never "complete" — while a specialist is still running or its lease is
    // unreclaimed. `pending()` (the drain list) still excludes dispatched, so this never re-dispatches.
    const pending = rows.filter((r) => r.status === "pending" || r.status === "dispatched").length
    const examined = rows.filter((r) => r.status === "examined").length
    return { pending, examined, total: pending + examined }
  }

  isEmpty(): boolean {
    return this.count().pending === 0
  }

  evidenceFor(targetKey: string): Evidence[] {
    const row = Database.use((db) =>
      db
        .select({ evidence: InspectionQueueTable.evidence })
        .from(InspectionQueueTable)
        .where(
          and(
            eq(InspectionQueueTable.session_id, this.sessionID),
            eq(InspectionQueueTable.domain, this.domain),
            eq(InspectionQueueTable.target_key, targetKey),
          ),
        )
        .get(),
    )
    if (!row) return []
    const evMap = parseMap(row.evidence)
    const out: Evidence[] = []
    for (const [type, values] of Object.entries(evMap)) {
      for (const value of values) out.push({ type, value, priority: "medium" })
    }
    return out
  }

  statusByTargetKey(): Record<string, "pending" | "dispatched" | "examined"> {
    const rows = Database.use((db) =>
      db
        .select({
          target_key: InspectionQueueTable.target_key,
          status: InspectionQueueTable.status,
        })
        .from(InspectionQueueTable)
        .where(
          and(
            eq(InspectionQueueTable.session_id, this.sessionID),
            eq(InspectionQueueTable.domain, this.domain),
          ),
        )
        .all(),
    )
    const out: Record<string, "pending" | "dispatched" | "examined"> = {}
    for (const r of rows) out[r.target_key] = r.status as "pending" | "dispatched" | "examined"
    return out
  }

  // ── Examine ─────────────────────────────────────────────────────

  markExamined(targetKey: string): void {
    const now = Date.now()
    const changed = Database.use((db) => {
      const row = db
        .select()
        .from(InspectionQueueTable)
        .where(
          and(
            eq(InspectionQueueTable.session_id, this.sessionID),
            eq(InspectionQueueTable.domain, this.domain),
            eq(InspectionQueueTable.target_key, targetKey),
            // pending (drained at triage / direct) OR dispatched (a specialist finished) → examined.
            // Already-examined items are skipped so re-examine is a no-op (no redundant publish).
            inArray(InspectionQueueTable.status, ["pending", "dispatched"]),
          ),
        )
        .get()
      if (!row) return false
      db.update(InspectionQueueTable)
        .set({
          status: "examined",
          examined_evidence: parseMap(row.evidence),
          time_updated: now,
        })
        .where(eq(InspectionQueueTable.id, row.id))
        .run()
      return true
    })
    if (changed) {
      this.publish()
      try {
        this.onExamined?.(targetKey)
      } catch {
        // domain hook must never break the queue's examined transition
      }
    }
  }

  // ── Lease (in-flight recovery, issue #38) ───────────────────────

  // pending → dispatched: claim the item as in-flight before handing it to a specialist. Excluded
  // from pending() so it isn't dispatched again; time_updated becomes the lease start.
  markDispatched(targetKey: string): void {
    if (this.transition(targetKey, "pending", "dispatched")) this.publish()
  }

  // dispatched → pending: the dispatch failed (or all specialists errored/timed out) — re-open the item
  // for another drain pass so its inspection is NOT skipped.
  resetToPending(targetKey: string): void {
    if (this.transition(targetKey, "dispatched", "pending")) this.publish()
  }

  // Atomic status transition guarded on the current status (select-then-update in one Database.use).
  // Returns whether a row actually moved, so callers only publish on a real change.
  private transition(targetKey: string, from: string, to: string): boolean {
    const now = Date.now()
    return Database.use((db) => {
      const row = db
        .select({ id: InspectionQueueTable.id })
        .from(InspectionQueueTable)
        .where(
          and(
            eq(InspectionQueueTable.session_id, this.sessionID),
            eq(InspectionQueueTable.domain, this.domain),
            eq(InspectionQueueTable.target_key, targetKey),
            eq(InspectionQueueTable.status, from),
          ),
        )
        .get()
      if (!row) return false
      db.update(InspectionQueueTable).set({ status: to, time_updated: now }).where(eq(InspectionQueueTable.id, row.id)).run()
      return true
    })
  }

  // Re-open every dispatched item whose lease is older than `leaseMs` — the dispatcher crashed or was
  // restarted mid-flight, leaving the item stuck "dispatched". Returns how many were reclaimed.
  reclaimStale(leaseMs: number): number {
    const now = Date.now()
    const cutoff = now - Math.max(0, leaseMs)
    const reclaimed = Database.use((db) => {
      const stale = db
        .select({ id: InspectionQueueTable.id })
        .from(InspectionQueueTable)
        .where(
          and(
            eq(InspectionQueueTable.session_id, this.sessionID),
            eq(InspectionQueueTable.domain, this.domain),
            eq(InspectionQueueTable.status, "dispatched"),
            lt(InspectionQueueTable.time_updated, cutoff),
          ),
        )
        .all()
      for (const row of stale) {
        db.update(InspectionQueueTable)
          .set({ status: "pending", time_updated: now })
          .where(eq(InspectionQueueTable.id, row.id))
          .run()
      }
      return stale.length
    })
    if (reclaimed > 0) this.publish()
    return reclaimed
  }

  // ── Internal ────────────────────────────────────────────────────

  private publish(): void {
    const queue = this.pending()
    Database.effect(() =>
      Bus.publish(InspectionQueue.Event.Updated, {
        sessionID: this.sessionID,
        domain: this.domain,
        queue,
      }),
    )
  }

  private allTargets(): InspectionTarget[] {
    const rows = Database.use((db) =>
      db
        .select({
          target_key: InspectionQueueTable.target_key,
          target_label: InspectionQueueTable.target_label,
          target_meta: InspectionQueueTable.target_meta,
        })
        .from(InspectionQueueTable)
        .where(
          and(
            eq(InspectionQueueTable.session_id, this.sessionID),
            eq(InspectionQueueTable.domain, this.domain),
          ),
        )
        .all(),
    )
    const seen = new Set<string>()
    const out: InspectionTarget[] = []
    for (const r of rows) {
      if (seen.has(r.target_key)) continue
      seen.add(r.target_key)
      out.push({
        key: r.target_key,
        label: r.target_label ?? r.target_key,
        meta: (r.target_meta as Record<string, unknown>) ?? {},
      })
    }
    return out
  }
}

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace InspectionQueue {
  export type Info = InspectionQueueItem
}

// ── Helpers ──────────────────────────────────────────────────────

function parseMap(raw: unknown): EvidenceMap {
  if (!raw || typeof raw !== "object") return {}
  return raw as EvidenceMap
}

function addValue(
  map: EvidenceMap,
  type: string,
  value: string,
): { map: EvidenceMap; added: boolean } {
  const list = map[type] ?? []
  if (list.includes(value)) return { map, added: false }
  return { map: { ...map, [type]: [...list, value] }, added: true }
}

function bumpPriority(
  current: string,
  next: EvidencePriority,
): EvidencePriority {
  const cur = current as EvidencePriority
  return priorityOrder[next] < priorityOrder[cur] ? next : cur
}

function deepEqualMeta(
  a: unknown,
  b: Record<string, unknown>,
): boolean {
  if (!a) return Object.keys(b).length === 0
  return JSON.stringify(a) === JSON.stringify(b)
}

function toInfo(row: {
  id: string
  session_id: string
  domain: string
  target_key: string
  target_label: string | null
  target_meta: unknown
  status: string
  priority: string
  evidence: unknown
  time_created: number
  time_updated: number
}): InspectionQueue.Info {
  return {
    id: row.id,
    session_id: row.session_id,
    domain: row.domain,
    target_key: row.target_key,
    target_label: row.target_label ?? undefined,
    target_meta: (row.target_meta as Record<string, unknown>) ?? undefined,
    status: row.status as "pending" | "dispatched" | "examined",
    priority: row.priority as EvidencePriority,
    evidence: parseMap(row.evidence),
    time: { created: row.time_created, updated: row.time_updated },
  }
}
