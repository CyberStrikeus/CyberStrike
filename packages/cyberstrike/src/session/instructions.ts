import { and, asc, eq } from "drizzle-orm"
import { Database } from "../storage/db"
import { SessionInstructionTable } from "./session-log.sql"
import { SessionLog } from "./log"

// API-managed instruction entries for one session. Each entry is stored in the session's database rows and is
// rendered into the system prompt of every model step, so a change applies from the next step on.
export namespace SessionInstructions {
  const namespace = "api/"

  const hash = (value: unknown) => new Bun.CryptoHasher("sha256").update(JSON.stringify(value)).digest("hex")

  export function list(sessionID: string) {
    return Database.use((db) =>
      db
        .select()
        .from(SessionInstructionTable)
        .where(eq(SessionInstructionTable.session_id, sessionID))
        .orderBy(asc(SessionInstructionTable.key))
        .all(),
    ).map((row) => ({ key: row.key, value: row.value }))
  }

  export function put(input: { sessionID: string; key: string; value: unknown }) {
    const now = Date.now()
    Database.use((db) =>
      db
        .insert(SessionInstructionTable)
        .values({
          session_id: input.sessionID,
          key: input.key,
          value: input.value,
          time_created: now,
          time_updated: now,
        })
        .onConflictDoUpdate({
          target: [SessionInstructionTable.session_id, SessionInstructionTable.key],
          set: { value: input.value, time_updated: now },
        })
        .run(),
    )
    SessionLog.append({
      sessionID: input.sessionID,
      type: "session.instructions.updated",
      version: 2,
      data: { sessionID: input.sessionID, delta: { [namespace + input.key]: hash(input.value) } },
    })
  }

  // Returns false when no entry existed under the key.
  export function remove(input: { sessionID: string; key: string }) {
    const removed = Database.use((db) =>
      db
        .delete(SessionInstructionTable)
        .where(and(eq(SessionInstructionTable.session_id, input.sessionID), eq(SessionInstructionTable.key, input.key)))
        .returning()
        .all(),
    )
    if (removed.length === 0) return false
    SessionLog.append({
      sessionID: input.sessionID,
      type: "session.instructions.updated",
      version: 2,
      data: { sessionID: input.sessionID, delta: { [namespace + input.key]: "removed" } },
    })
    return true
  }

  export function render(sessionID: string) {
    return list(sessionID).map(
      (entry) =>
        `Instructions from: ${namespace}${entry.key}\n${typeof entry.value === "string" ? entry.value : JSON.stringify(entry.value, null, 2)}`,
    )
  }
}
