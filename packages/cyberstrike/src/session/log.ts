import { and, asc, desc, eq, gt, max } from "drizzle-orm"
import { Schema } from "effect"
import { SessionEvent } from "@opencode/schema/session-event"
import { Identifier } from "../id/id"
import { Database } from "../storage/db"
import { SessionLogTable } from "./session-log.sql"

export namespace SessionLog {
  type Row = typeof SessionLogTable.$inferSelect

  // Upstream's wire shape for one durable event. Stored rows are encoded this way on the way out.
  const encode = (row: Row) => ({
    id: row.id,
    created: row.time_created,
    type: row.type,
    durable: { aggregateID: row.session_id, seq: row.seq, version: row.version },
    data: row.data,
  })

  const decode = Schema.decodeUnknownSync(SessionEvent.Durable)

  // Appends one durable event with the next sequence number of the session. The event is checked against
  // upstream's SessionEvent.Durable before it is stored, so a bad producer fails here rather than in a reader.
  export function append(input: { sessionID: string; type: string; version?: number; data: Record<string, unknown> }) {
    return Database.use((db) => {
      const last = db
        .select({ seq: max(SessionLogTable.seq) })
        .from(SessionLogTable)
        .where(eq(SessionLogTable.session_id, input.sessionID))
        .get()
      const row: Row = {
        id: Identifier.ascending("session_event"),
        session_id: input.sessionID,
        seq: (last?.seq ?? 0) + 1,
        type: input.type,
        version: input.version ?? 1,
        data: input.data,
        time_created: Date.now(),
      }
      const event = encode(row)
      decode(event)
      db.insert(SessionLogTable).values(row).run()
      return event
    })
  }

  // Events after an exclusive sequence, oldest first.
  export function read(input: { sessionID: string; after: number }) {
    return Database.use((db) =>
      db
        .select()
        .from(SessionLogTable)
        .where(and(eq(SessionLogTable.session_id, input.sessionID), gt(SessionLogTable.seq, input.after)))
        .orderBy(asc(SessionLogTable.seq))
        .all(),
    ).map(encode)
  }

  export function latest(sessionID: string) {
    const row = Database.use((db) =>
      db
        .select({ seq: max(SessionLogTable.seq) })
        .from(SessionLogTable)
        .where(eq(SessionLogTable.session_id, sessionID))
        .get(),
    )
    return row?.seq ?? 0
  }

  // The idle watermark of the newest session.viewed event, if the session was ever viewed.
  export function viewed(sessionID: string) {
    const row = Database.use((db) =>
      db
        .select()
        .from(SessionLogTable)
        .where(and(eq(SessionLogTable.session_id, sessionID), eq(SessionLogTable.type, "session.viewed")))
        .orderBy(desc(SessionLogTable.seq))
        .limit(1)
        .get(),
    )
    const idle = row?.data.idle
    return typeof idle === "number" ? idle : undefined
  }
}
