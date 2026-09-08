// The traffic store: where every Transaction lands so the rule layer and (soon) HTTPQL can run
// over the whole corpus. This is an INTERFACE first — the in-memory implementation below is the
// default and the test/embedded store; a SQLite/Drizzle-backed one will implement the same shape
// so nothing above the store cares where the bytes live.
import type { Transaction } from "./transaction"

export interface TrafficStore {
  // Insert (or replace by id). Returns the stored transaction.
  add(tx: Transaction): Transaction
  get(id: string): Transaction | undefined
  all(): Transaction[]
  // Every transaction matching a predicate — the escape hatch until HTTPQL lands.
  where(predicate: (tx: Transaction) => boolean): Transaction[]
  size(): number
  clear(): void
}

export class MemoryStore implements TrafficStore {
  private readonly byId = new Map<string, Transaction>()

  add(tx: Transaction): Transaction {
    this.byId.set(tx.id, tx)
    return tx
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
  }
}
