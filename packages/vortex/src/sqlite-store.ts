// A durable TrafficStore backed by bun:sqlite — so a body of traffic survives a restart and the
// "DB-kayıtlı" requirement is real, not just an in-memory map. Same interface as MemoryStore, so
// nothing above the store changes. An instance is SESSION-SCOPED: every op is bounded to one
// assessment, so a shared database file can hold many sessions without them bleeding together.
//
// The full Transaction is stored as JSON in `data`; the columns that get queried a lot (session,
// host, method, status) are lifted out and indexed. When the host embeds Vortex on its own DB
// (Drizzle), it provides an adapter implementing TrafficStore instead of using this.
import { Database } from "bun:sqlite"
import type { Transaction } from "./transaction"
import { signalKey, type TrafficStore } from "./store"
import type { Discovered } from "./discovery"
import type { Signal } from "./rule"

interface Row {
  data: string
}

export class SqliteStore implements TrafficStore {
  private readonly db: Database
  private readonly session: string

  // `db` is a bun:sqlite Database (a path string opens/creates a file, ":memory:" for ephemeral).
  // `session` scopes every operation to one assessment.
  constructor(db: Database | string, session: string) {
    this.db = typeof db === "string" ? new Database(db) : db
    this.session = session
    this.db.run(
      `CREATE TABLE IF NOT EXISTS vortex_transaction (
         id TEXT PRIMARY KEY,
         session TEXT NOT NULL,
         host TEXT,
         method TEXT,
         status INTEGER,
         data TEXT NOT NULL
       )`,
    )
    this.db.run(`CREATE INDEX IF NOT EXISTS vortex_transaction_session ON vortex_transaction(session)`)
    this.db.run(
      `CREATE TABLE IF NOT EXISTS vortex_discovered (
         session TEXT NOT NULL,
         id TEXT NOT NULL,
         kind TEXT NOT NULL,
         data TEXT NOT NULL,
         PRIMARY KEY (session, id)
       )`,
    )
    this.db.run(
      `CREATE TABLE IF NOT EXISTS vortex_signal (
         session TEXT NOT NULL,
         key TEXT NOT NULL,
         rule_id TEXT,
         severity TEXT,
         category TEXT,
         transaction_id TEXT,
         data TEXT NOT NULL,
         PRIMARY KEY (session, key)
       )`,
    )
  }

  add(tx: Transaction): Transaction {
    const row: Transaction = { ...tx, session: this.session }
    this.db.run(`INSERT OR REPLACE INTO vortex_transaction (id, session, host, method, status, data) VALUES (?, ?, ?, ?, ?, ?)`, [
      row.id,
      this.session,
      row.host,
      row.request.method,
      row.response?.status ?? null,
      JSON.stringify(row),
    ])
    return row
  }

  get(id: string): Transaction | undefined {
    const row = this.db
      .query<Row, [string, string]>(`SELECT data FROM vortex_transaction WHERE id = ? AND session = ?`)
      .get(id, this.session)
    return row ? (JSON.parse(row.data) as Transaction) : undefined
  }

  all(): Transaction[] {
    const rows = this.db.query<Row, [string]>(`SELECT data FROM vortex_transaction WHERE session = ?`).all(this.session)
    return rows.map((r) => JSON.parse(r.data) as Transaction)
  }

  where(predicate: (tx: Transaction) => boolean): Transaction[] {
    return this.all().filter(predicate)
  }

  size(): number {
    const row = this.db
      .query<{ n: number }, [string]>(`SELECT COUNT(*) AS n FROM vortex_transaction WHERE session = ?`)
      .get(this.session)
    return row?.n ?? 0
  }

  addDiscovered(items: Discovered[]): number {
    let added = 0
    const exists = this.db.query<{ n: number }, [string, string]>(`SELECT COUNT(*) AS n FROM vortex_discovered WHERE session = ? AND id = ?`)
    for (const it of items) {
      const had = (exists.get(this.session, it.id)?.n ?? 0) > 0
      this.db.run(`INSERT OR REPLACE INTO vortex_discovered (session, id, kind, data) VALUES (?, ?, ?, ?)`, [this.session, it.id, it.kind, JSON.stringify(it)])
      if (!had) added++
    }
    return added
  }

  discovered(kind?: Discovered["kind"]): Discovered[] {
    const rows = kind
      ? this.db.query<Row, [string, string]>(`SELECT data FROM vortex_discovered WHERE session = ? AND kind = ?`).all(this.session, kind)
      : this.db.query<Row, [string]>(`SELECT data FROM vortex_discovered WHERE session = ?`).all(this.session)
    return rows.map((r) => JSON.parse(r.data) as Discovered)
  }

  addSignals(signals: Signal[]): number {
    let added = 0
    const exists = this.db.query<{ n: number }, [string, string]>(`SELECT COUNT(*) AS n FROM vortex_signal WHERE session = ? AND key = ?`)
    for (const s of signals) {
      const key = signalKey(s)
      const had = (exists.get(this.session, key)?.n ?? 0) > 0
      this.db.run(`INSERT OR REPLACE INTO vortex_signal (session, key, rule_id, severity, category, transaction_id, data) VALUES (?, ?, ?, ?, ?, ?, ?)`, [
        this.session,
        key,
        s.ruleId,
        s.severity,
        s.category,
        s.transactionId,
        JSON.stringify(s),
      ])
      if (!had) added++
    }
    return added
  }

  signals(filter?: { ruleId?: string; severity?: Signal["severity"]; transactionId?: string; category?: string }): Signal[] {
    const clauses = ["session = ?"]
    const args: string[] = [this.session]
    if (filter?.ruleId) (clauses.push("rule_id = ?"), args.push(filter.ruleId))
    if (filter?.severity) (clauses.push("severity = ?"), args.push(filter.severity))
    if (filter?.transactionId) (clauses.push("transaction_id = ?"), args.push(filter.transactionId))
    if (filter?.category) (clauses.push("category = ?"), args.push(filter.category))
    const rows = this.db.query<Row, string[]>(`SELECT data FROM vortex_signal WHERE ${clauses.join(" AND ")}`).all(...args)
    return rows.map((r) => JSON.parse(r.data) as Signal)
  }

  clear(): void {
    this.db.run(`DELETE FROM vortex_transaction WHERE session = ?`, [this.session])
    this.db.run(`DELETE FROM vortex_discovered WHERE session = ?`, [this.session])
    this.db.run(`DELETE FROM vortex_signal WHERE session = ?`, [this.session])
  }
}
