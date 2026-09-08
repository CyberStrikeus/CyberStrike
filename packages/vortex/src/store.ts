// The traffic store: where every Transaction lands so the rule layer and (soon) HTTPQL can run
// over the whole corpus. This is an INTERFACE first — the in-memory implementation below is the
// default and the test/embedded store; a SQLite/Drizzle-backed one will implement the same shape
// so nothing above the store cares where the bytes live.
import type { Transaction } from "./transaction"
import type { Discovered } from "./discovery"
import type { Signal } from "./rule"

export interface TrafficStore {
  // Insert (or replace by id). Returns the stored transaction.
  add(tx: Transaction): Transaction
  get(id: string): Transaction | undefined
  all(): Transaction[]
  // Every transaction matching a predicate — the escape hatch until HTTPQL lands.
  where(predicate: (tx: Transaction) => boolean): Transaction[]
  size(): number
  clear(): void
  // Discovery inventory — endpoints/JS URLs an extractor learned about (see discovery.ts). Upsert
  // by id; returns how many were NEW. `discovered(kind?)` lists them.
  addDiscovered(items: Discovered[]): number
  discovered(kind?: Discovered["kind"]): Discovered[]
  // Signal store — what the rules caught, persisted (a first-class model entity, "flags" on the
  // traffic). Deduped by signal identity; returns how many were NEW. `signals(filter?)` reads them.
  addSignals(signals: Signal[]): number
  signals(filter?: { ruleId?: string; severity?: Signal["severity"]; transactionId?: string; category?: string }): Signal[]
}

// The dedup identity of a signal — its dedupKey, else per (rule, transaction, title). Shared by the
// stores so the same finding never persists twice.
export function signalKey(s: Signal): string {
  return s.dedupKey ?? `${s.ruleId}:${s.transactionId}:${s.title}`
}

export class MemoryStore implements TrafficStore {
  private readonly byId = new Map<string, Transaction>()
  private readonly discoveredById = new Map<string, Discovered>()
  private readonly signalByKey = new Map<string, Signal>()

  addSignals(signals: Signal[]): number {
    let added = 0
    for (const s of signals) {
      const key = signalKey(s)
      if (!this.signalByKey.has(key)) added++
      this.signalByKey.set(key, s)
    }
    return added
  }
  signals(filter?: { ruleId?: string; severity?: Signal["severity"]; transactionId?: string; category?: string }): Signal[] {
    let out = [...this.signalByKey.values()]
    if (filter?.ruleId) out = out.filter((s) => s.ruleId === filter.ruleId)
    if (filter?.severity) out = out.filter((s) => s.severity === filter.severity)
    if (filter?.transactionId) out = out.filter((s) => s.transactionId === filter.transactionId)
    if (filter?.category) out = out.filter((s) => s.category === filter.category)
    return out
  }

  add(tx: Transaction): Transaction {
    this.byId.set(tx.id, tx)
    return tx
  }
  addDiscovered(items: Discovered[]): number {
    let added = 0
    for (const it of items) {
      if (!this.discoveredById.has(it.id)) added++
      this.discoveredById.set(it.id, it)
    }
    return added
  }
  discovered(kind?: Discovered["kind"]): Discovered[] {
    const all = [...this.discoveredById.values()]
    return kind ? all.filter((d) => d.kind === kind) : all
  }
  get(id: string): Transaction | undefined {
    return this.byId.get(id)
  }
  all(): Transaction[] {
    return [...this.byId.values()]
  }
  where(predicate: (tx: Transaction) => boolean): Transaction[] {
    return this.all().filter(predicate)
  }
  size(): number {
    return this.byId.size
  }
  clear(): void {
    this.byId.clear()
    this.discoveredById.clear()
    this.signalByKey.clear()
  }
}
