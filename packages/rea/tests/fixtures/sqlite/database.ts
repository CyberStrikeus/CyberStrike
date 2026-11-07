import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";

/** Engine-dependent cases require the same native limit capability as the worker. */
export const SQLITE_NATIVE_LIMITS_AVAILABLE = (() => {
  const database = new DatabaseSync(":memory:");
  try {
    return "limits" in database;
  } finally {
    database.close();
  }
})();

/** Exact selected SQLite fixture with committed rows and optional live WAL. */
export interface SqliteDatabaseFixture {
  readonly path: string;
  readonly walPath: string;
  readonly quotedTable: string;
  close(): void;
}

/** Produce schema and lossless SQLite values through the actual SQLite engine. */
export const createSqliteDatabaseFixture = (
  root: string,
  wal = false,
): SqliteDatabaseFixture => {
  const path = join(root, "selected.db");
  const db = new DatabaseSync(path);
  if (wal) db.exec("PRAGMA journal_mode = WAL; PRAGMA wal_autocheckpoint = 0");
  db.exec(`
    CREATE TABLE records (
      id INTEGER PRIMARY KEY,
      integer_value INTEGER,
      blob_value BLOB,
      real_value REAL,
      nullable_value TEXT,
      text_value TEXT,
      generated_value TEXT GENERATED ALWAYS AS (typeof(integer_value)) VIRTUAL
    );
    CREATE INDEX records_text ON records(text_value);
    CREATE VIEW record_names AS SELECT text_value FROM records;
    CREATE TRIGGER records_insert AFTER INSERT ON records BEGIN SELECT 1; END;
    CREATE TABLE "strange""'; DROP TABLE records;--" ("__proto__" TEXT);
    INSERT INTO "strange""'; DROP TABLE records;--" VALUES ('exact selected table');
  `);
  const insert = db.prepare(
    "INSERT INTO records(id, integer_value, blob_value, real_value, nullable_value, text_value) VALUES (?, ?, ?, ?, ?, ?)",
  );
  insert.run(
    1,
    9223372036854775807n,
    Buffer.from([0, 31, 239, 255]),
    Infinity,
    null,
    "first é\0value",
  );
  insert.run(
    2,
    -9223372036854775808n,
    Buffer.alloc(0),
    -Infinity,
    "present",
    "second",
  );
  db.exec(
    "INSERT INTO records(id, integer_value, blob_value, real_value, nullable_value, text_value) VALUES (3, 0, X'FF', 1.25, NULL, CAST(X'FF00C0AF' AS TEXT))",
  );
  return {
    path,
    walPath: `${path}-wal`,
    quotedTable: "strange\"'; DROP TABLE records;--",
    close: () => db.close(),
  };
};

/** A single stored key stays ordered when its declaration names an application collation. */
export const createSqliteApplicationCollationFixture = (
  root: string,
): string => {
  const path = join(root, "application-collation.db");
  const producer = new DatabaseSync(path, { defensive: false });
  try {
    // Node exposes no collation-registration API. Changing only the stored
    // collation name preserves this one-key table's record layout and ordering.
    producer.exec(`
      CREATE TABLE items(
        name TEXT COLLATE NOCASE PRIMARY KEY,
        value INTEGER,
        generated_value TEXT GENERATED ALWAYS AS (upper(name)) VIRTUAL
      ) WITHOUT ROWID;
      INSERT INTO items(name, value) VALUES ('alpha', 1);
      PRAGMA writable_schema = ON;
      UPDATE sqlite_schema
        SET sql = replace(sql, 'COLLATE NOCASE', 'COLLATE APPLICATION_COLLATION')
        WHERE name = 'items';
      PRAGMA writable_schema = OFF;
    `);
  } finally {
    producer.close();
  }
  return path;
};

/** UTF-16 hex lookup keys exceed 16 MiB while both public schema scopes fit. */
export const createSqliteLongNameFixture = (
  root: string,
  encoding: "UTF-8" | "UTF-16le" | "UTF-16be",
): { path: string; names: string[] } => {
  const path = join(root, `large-schema-${encoding}.db`);
  const names = Array.from(
    { length: 34 },
    (_, index) => `${index}_${"x".repeat(128 * 1024)}`,
  );
  const producer = new DatabaseSync(path);
  try {
    producer.exec(`PRAGMA encoding='${encoding}'; BEGIN`);
    for (const name of names)
      producer.exec(`CREATE TABLE "${name}"(value TEXT)`);
    producer.exec("COMMIT");
  } finally {
    producer.close();
  }
  return { path, names };
};
