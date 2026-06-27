import { Database, eq, and } from "../storage/db"
import { CoverageNoteTable } from "./session.sql"
import { Identifier } from "../id/id"

// Append-only coverage memory for the agentic-pentest test loop.
//
// A tester agent, after testing a vuln CLASS at some SCOPE, declares it here via the
// `record_coverage_note` tool. Both `asset` (the scope id) and `class` are LLM-declared
// generic TEXT — origin/keyHash for web, ARN for cloud, host:port for network — so one
// table serves every lane. The orchestrator reads these notes before dispatch and skips
// re-testing a covered (asset, class) cell; that is the cost win (e.g. app-wide JWT
// crypto tested ONCE per origin instead of per endpoint).
//
// A note's EXISTENCE = "this cell was tested". There is NO status column: the verdict
// (vulnerable / clean) lives in intel_entry + vulnerability, not here. This is RAW
// process memory — append-only, cheap, judgment stays with the agents.
export namespace CoverageNote {
  export interface Info {
    id: string
    sessionID: string
    asset: string
    class: string
    note: string
    testedBy?: string
    requestID?: string
    timeCreated: number
    timeUpdated: number
  }

  /**
   * Append a coverage note. One row per declaration (append-only — multiple notes per
   * cell are allowed and form its history). The presence of any row for (asset, class)
   * is what marks the cell tested.
   */
  export function record(input: {
    sessionID: string
    asset: string
    class: string
    note: string
    testedBy?: string
    requestID?: string
  }): Info {
    const id = Identifier.ascending("coverage_note")
    const now = Date.now()
    Database.use((db) =>
      db
        .insert(CoverageNoteTable)
        .values({
          id,
          session_id: input.sessionID,
          asset: input.asset,
          class: input.class,
          note: input.note,
          tested_by: input.testedBy ?? null,
          request_id: input.requestID ?? null,
          time_created: now,
          time_updated: now,
        })
        .run(),
    )
    return {
      id,
      sessionID: input.sessionID,
      asset: input.asset,
      class: input.class,
      note: input.note,
      testedBy: input.testedBy,
      requestID: input.requestID,
      timeCreated: now,
      timeUpdated: now,
    }
  }

  function rowToInfo(row: typeof CoverageNoteTable.$inferSelect): Info {
    return {
      id: row.id,
      sessionID: row.session_id,
      asset: row.asset,
      class: row.class,
      note: row.note,
      testedBy: row.tested_by ?? undefined,
      requestID: row.request_id ?? undefined,
      timeCreated: row.time_created,
      timeUpdated: row.time_updated,
    }
  }

  /** All coverage notes for the session — orchestrator visibility / context injection. */
  export function listBySession(sessionID: string): Info[] {
    return Database.use((db) =>
      db.select().from(CoverageNoteTable).where(eq(CoverageNoteTable.session_id, sessionID)).all(),
    ).map(rowToInfo)
  }

  /** All notes for one asset (scope) — surfaced to a tester dispatched on that scope. */
  export function listByAsset(sessionID: string, asset: string): Info[] {
    return Database.use((db) =>
      db
        .select()
        .from(CoverageNoteTable)
        .where(and(eq(CoverageNoteTable.session_id, sessionID), eq(CoverageNoteTable.asset, asset)))
        .all(),
    ).map(rowToInfo)
  }

  /** Latest note for an (asset, class) cell, or undefined. Existence = tested. */
  export function getByCell(sessionID: string, asset: string, cls: string): Info | undefined {
    const row = Database.use((db) =>
      db
        .select()
        .from(CoverageNoteTable)
        .where(
          and(
            eq(CoverageNoteTable.session_id, sessionID),
            eq(CoverageNoteTable.asset, asset),
            eq(CoverageNoteTable.class, cls),
          ),
        )
        .get(),
    )
    return row ? rowToInfo(row) : undefined
  }
}
