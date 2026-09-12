import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import z from "zod"
import { Database, eq, and } from "@/storage/db"
import { InspectionQueueTable } from "./schema"
import { Identifier } from "@/id/id"
import type { InspectionTarget, Evidence, EvidencePriority } from "@cyberstrike-io/plugin"

const Priority = z.enum(["high", "medium", "low"])
const Status = z.enum(["pending", "examined"])

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

  static readonly Info = InfoSchema
  static readonly Event = { Updated: UpdatedEvent }

  constructor(sessionID: string, domain: string) {
    this.sessionID = sessionID
    this.domain = domain
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

      if (row.status === "pending") {
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
    const pending = rows.filter((r) => r.status === "pending").length
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

  statusByTargetKey(): Record<string, "pending" | "examined"> {
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
    const out: Record<string, "pending" | "examined"> = {}
    for (const r of rows) out[r.target_key] = r.status as "pending" | "examined"
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
            eq(InspectionQueueTable.status, "pending"),
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
    if (changed) this.publish()
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
    status: row.status as "pending" | "examined",
    priority: row.priority as EvidencePriority,
    evidence: parseMap(row.evidence),
    time: { created: row.time_created, updated: row.time_updated },
  }
}
