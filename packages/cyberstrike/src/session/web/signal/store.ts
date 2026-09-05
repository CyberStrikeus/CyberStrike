// DB-backed persistence for the signal fabric (plan §07). The pure core
// (detectors, CanaryRegistry, router) has ZERO DB imports; this is the only file
// that touches storage, so the core stays trivially unit-testable and the two
// concerns lift into the package independently.
//
// Both stores are session-bound at construction — the CanaryStore interface stays
// unchanged (add/all), so CanaryRegistry composes a DB store or the in-memory one
// with no branching.
import { Database, eq, and } from "../../../storage/db"
import { Identifier } from "../../../id/id"
import { WebCanaryTable, WebSignalTable } from "./signal.sql"
import type { Canary, CanaryKind, CanaryStore } from "./canary"
import type { Signal, SignalType, SpecialistClass } from "./types"

// ── Canary persistence ─────────────────────────────────────────────────────────

// A DB-backed CanaryStore for one session. Dedup is enforced by the UNIQUE
// (session, token) index via ON CONFLICT DO NOTHING.
export class DbCanaryStore implements CanaryStore {
  constructor(private readonly sessionID: string) {}

  add(c: Canary): boolean {
    const now = c.createdAt || Date.now()
    const inserted = Database.use((db) =>
      db
        .insert(WebCanaryTable)
        .values({
          id: Identifier.ascending("web_canary"),
          session_id: this.sessionID,
          token: c.token,
          kind: c.kind,
          origin_request_id: c.originRequestId,
          endpoint: c.endpoint,
          field: c.field,
          agent: c.agent,
          vuln_class: c.vulnClass,
          time_created: now,
          time_updated: now,
        })
        .onConflictDoNothing({ target: [WebCanaryTable.session_id, WebCanaryTable.token] })
        .returning()
        .all(),
    )
    return inserted.length > 0
  }

  all(): Canary[] {
    const rows = Database.use((db) =>
      db.select().from(WebCanaryTable).where(eq(WebCanaryTable.session_id, this.sessionID)).all(),
    )
    return rows.map((r) => ({
      token: r.token,
      kind: r.kind as CanaryKind,
      originRequestId: r.origin_request_id,
      endpoint: r.endpoint,
      field: r.field,
      agent: r.agent,
      vulnClass: r.vuln_class,
      createdAt: r.time_created,
    }))
  }
}

// ── Signal persistence ──────────────────────────────────────────────────────────

export type SignalStatus = "pending" | "routed" | "confirmed" | "dismissed"

export interface SignalInfo {
  id: string
  session_id: string
  signal_type: SignalType
  owner: SpecialistClass
  request_id: string
  evidence: string
  meta?: Record<string, unknown>
  status: SignalStatus
  time: { created: number; updated: number }
}

function parseMeta(raw: string | null): Record<string, unknown> | undefined {
  if (!raw) return undefined
  try {
    const v = JSON.parse(raw)
    return v && typeof v === "object" ? (v as Record<string, unknown>) : undefined
  } catch {
    return undefined
  }
}

// Durable, deduped store of emitted signals for one session.
export class SignalStore {
  constructor(private readonly sessionID: string) {}

  // Stable dedup identity: the same detector firing on the same request must not
  // pile up. A stored_reflection is unique per canary token, so include it when
  // present — otherwise two different canaries rendering in one page would collapse.
  static dedupKey(s: Signal): string {
    const token = typeof s.meta?.token === "string" ? `:${s.meta.token}` : ""
    return `${s.type}:${s.requestId}${token}`
  }

  /**
   * Persist a signal. Deduped by (session, dedup_key) via ON CONFLICT DO NOTHING.
   * Returns the row id and whether it was a duplicate of an existing signal.
   */
  record(s: Signal): { id: string; deduped: boolean } {
    const id = Identifier.ascending("web_signal")
    const now = Date.now()
    const key = SignalStore.dedupKey(s)
    const inserted = Database.use((db) =>
      db
        .insert(WebSignalTable)
        .values({
          id,
          session_id: this.sessionID,
          signal_type: s.type,
          owner: s.owner,
          request_id: s.requestId,
          evidence: s.evidence,
          meta: s.meta ? JSON.stringify(s.meta) : null,
          status: "pending",
          dedup_key: key,
          time_created: now,
          time_updated: now,
        })
        .onConflictDoNothing({ target: [WebSignalTable.session_id, WebSignalTable.dedup_key] })
        .returning()
        .all(),
    )
    if (inserted.length > 0) return { id, deduped: false }
    // Duplicate — surface the id of the signal already on record.
    const existing = Database.use((db) =>
      db
        .select()
        .from(WebSignalTable)
        .where(and(eq(WebSignalTable.session_id, this.sessionID), eq(WebSignalTable.dedup_key, key)))
        .get(),
    )
    return { id: existing?.id ?? "", deduped: true }
  }

  private map(r: typeof WebSignalTable.$inferSelect): SignalInfo {
    return {
      id: r.id,
      session_id: r.session_id,
      signal_type: r.signal_type as SignalType,
      owner: r.owner as SpecialistClass,
      request_id: r.request_id,
      evidence: r.evidence,
      meta: parseMeta(r.meta),
      status: r.status as SignalStatus,
      time: { created: r.time_created, updated: r.time_updated },
    }
  }

  get(): SignalInfo[] {
    const rows = Database.use((db) =>
      db.select().from(WebSignalTable).where(eq(WebSignalTable.session_id, this.sessionID)).all(),
    )
    return rows.map((r) => this.map(r))
  }

  pending(): SignalInfo[] {
    const rows = Database.use((db) =>
      db
        .select()
        .from(WebSignalTable)
        .where(and(eq(WebSignalTable.session_id, this.sessionID), eq(WebSignalTable.status, "pending")))
        .all(),
    )
    return rows.map((r) => this.map(r))
  }

  updateStatus(id: string, status: SignalStatus): void {
    Database.use((db) =>
      db
        .update(WebSignalTable)
        .set({ status, time_updated: Date.now() })
        .where(and(eq(WebSignalTable.session_id, this.sessionID), eq(WebSignalTable.id, id)))
        .run(),
    )
  }
}
