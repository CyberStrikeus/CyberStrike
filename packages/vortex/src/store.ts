// The traffic store: where every Transaction lands so the rule layer and (soon) HTTPQL can run
// over the whole corpus. This is an INTERFACE first — the in-memory implementation below is the
// default and the test/embedded store; a SQLite/Drizzle-backed one will implement the same shape
// so nothing above the store cares where the bytes live.
import type { Transaction } from "./transaction"
import type { Discovered } from "./discovery"

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
}

export class MemoryStore implements TrafficStore {
  private readonly byId = new Map<string, Transaction>()
  private readonly discoveredById = new Map<string, Discovered>()

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
  }
}
