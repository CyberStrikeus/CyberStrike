import { Database } from "../storage/db"
import { RequestObservationTable } from "./session.sql"
import { Identifier } from "../id/id"
import { eq, and } from "../storage/db"

// Per-credential observed-value accumulation (Faz 3).
//
// Each ingested request — whether it creates a new endpoint row or is a dedup
// skip — records WHICH concrete values WHICH credential used on this operation.
// This is the deterministic, LLM-free substrate for access-control testing:
// horizontal/IDOR (same op, different identity's object id), vertical/BFLA (op
// reached only by a privileged credential), mass-assignment (extra body shape per
// credential). The actual differential test is the tester-agent's job later; here
// we only accumulate evidence, cheaply and append-only.
export namespace Observation {
  export interface Slot {
    loc: string
    name: string
    value: string
    retained?: boolean
  }

  // No extractable values ⇒ still record reachability (which credential hit this
  // shape) under a sentinel value-set, so BFLA "only admin reached it" is visible.
  const EMPTY_VALUE_SET = "none"

  /**
   * Append-only upsert. One row per (session, key_hash, credential, value_hash);
   * the unique index drops exact repeats (ON CONFLICT DO NOTHING), so concurrent
   * bursts and re-hits are idempotent with no read-modify-write race. Returns true
   * when a NEW observation was recorded (new value-set or new credential).
   */
  export function observe(input: {
    sessionID: string
    keyHash: string
    opGroupHash: string
    requestID?: string
    credentialID?: string
    valueHash?: string
    slots?: Slot[]
  }): boolean {
    const id = Identifier.ascending("request_observation")
    const now = Date.now()
    const inserted = Database.use((db) =>
      db
        .insert(RequestObservationTable)
        .values({
          id,
          session_id: input.sessionID,
          op_group_hash: input.opGroupHash,
          key_hash: input.keyHash,
          request_id: input.requestID ?? null,
          credential_id: input.credentialID ?? null,
          value_hash: input.valueHash ?? EMPTY_VALUE_SET,
          slots: input.slots ?? null,
          time_created: now,
          time_updated: now,
        })
        .onConflictDoNothing({
          target: [
            RequestObservationTable.session_id,
            RequestObservationTable.key_hash,
            RequestObservationTable.credential_id,
            RequestObservationTable.value_hash,
          ],
        })
        .returning({ id: RequestObservationTable.id })
        .all(),
    )
    return inserted.length > 0
  }

  /** All observations for an endpoint shape (key_hash) — used by tests/aggregation. */
  export function listByKeyHash(sessionID: string, keyHash: string) {
    return Database.use((db) =>
      db
        .select()
        .from(RequestObservationTable)
        .where(and(eq(RequestObservationTable.session_id, sessionID), eq(RequestObservationTable.key_hash, keyHash)))
        .all(),
    )
  }

  /** All observations in a session — used by tests. */
  export function listBySession(sessionID: string) {
    return Database.use((db) =>
      db.select().from(RequestObservationTable).where(eq(RequestObservationTable.session_id, sessionID)).all(),
    )
  }

  export interface EndpointTree {
    keyHash: string
    credentials: (string | null)[] // distinct credential_ids that hit this endpoint shape
    params: {
      name: string
      loc: string
      byCredential: { credentialID: string | null; values: string[]; redacted: boolean }[]
    }[]
  }

  /**
   * Per-endpoint observed values, aggregated for the UI tree: which credential used
   * which concrete values for each param. RAW FACTS ONLY — no idLike/reference/owner
   * judgment (the agent does that). Redacted values surface as a `redacted` flag with
   * no concrete value.
   */
  export function endpointTree(sessionID: string, keyHash: string): EndpointTree {
    const obs = listByKeyHash(sessionID, keyHash)
    const credentials = [...new Set(obs.map((o) => o.credential_id))]
    const byParam = new Map<string, { loc: string; byCred: Map<string | null, { values: Set<string>; redacted: boolean }> }>()
    for (const o of obs) {
      const slots = (o.slots ?? []) as { loc: string; name: string; value: string; retained?: boolean }[]
      for (const s of slots) {
        const p = byParam.get(s.name) ?? { loc: s.loc, byCred: new Map() }
        const cred = p.byCred.get(o.credential_id) ?? { values: new Set<string>(), redacted: false }
        if (s.retained === false) cred.redacted = true
        else if (s.value) cred.values.add(s.value)
        p.byCred.set(o.credential_id, cred)
        byParam.set(s.name, p)
      }
    }
    const params = [...byParam.entries()].map(([name, p]) => ({
      name,
      loc: p.loc,
      byCredential: [...p.byCred.entries()].map(([credentialID, v]) => ({
        credentialID,
        values: [...v.values],
        redacted: v.redacted,
      })),
    }))
    return { keyHash, credentials, params }
  }
}
