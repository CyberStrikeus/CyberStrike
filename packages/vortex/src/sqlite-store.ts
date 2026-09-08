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
import type { TrafficStore } from "./store"

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

  clear(): void {
    this.db.run(`DELETE FROM vortex_transaction WHERE session = ?`, [this.session])
  }
}
