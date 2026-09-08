// Lead — the boundary object between Vortex (producer) and an agent (consumer). A bare Signal is
// thin; to act on it an agent would otherwise do 4-5 lookups (endpoint? object/param? role? raw?
// safe to replay?). `lead()` assembles all of that deterministically into ONE self-describing record
// so the agent reads a single object and knows WHAT fired, WHERE (function/object), under WHICH
// role, HOW to reproduce (transactionId → send), and whether replay is safe. No LLM in the assembly.
import type { Transaction } from "./transaction"
import type { Signal } from "./rule"
import type { TrafficStore } from "./store"
import type { Subjects } from "./subjects"
import { subjects } from "./subjects"
import type { RawView } from "./fields"
import { rawView } from "./fields"
import { replaySafety } from "./replay-safety"

export interface Lead {
  signal: Signal
  transactionId: string // → send() with this to reproduce/confirm
  function: Subjects["function"] // method + endpoint + CRUD (BFLA axis)
  objects: Subjects["objects"] // resource ids touched (BOLA/IDOR axis)
  role?: string // principal it ran under (identity, else JWT subject) — RBAC axis
  roles?: string[] // JWT roles/authorities, when present
  scopes?: string[] // JWT/OAuth scopes, when present
  replaySafe: boolean // false ⇒ replaying would burn the live session (see reason) — don't
  reason?: string // why replay is unsafe (present only when !replaySafe)
  raw: RawView // the full raw request (+ response) INLINE, for detailed inspection
}

// Assemble one lead from a transaction and a signal fired on it.
export function lead(tx: Transaction, signal: Signal): Lead {
  const s = subjects(tx)
  const rs = replaySafety(tx)
  return {
    signal,
    transactionId: tx.id,
    function: s.function,
    objects: s.objects,
    role: s.role,
    roles: s.roles,
    scopes: s.scopes,
    replaySafe: rs.safe,
    reason: rs.reason,
    raw: rawView(tx),
  }
}

// Assemble leads for a set of signals against a store (pass a filtered set from store.signals(...),
// or omit to take every persisted signal). A signal whose transaction is no longer in the store is
// skipped.
export function leads(store: TrafficStore, signals?: Signal[]): Lead[] {
  const out: Lead[] = []
  for (const sig of signals ?? store.signals()) {
    const tx = store.get(sig.transactionId)
    if (tx) out.push(lead(tx, sig))
  }
  return out
}
