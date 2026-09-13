import { describe, expect, test } from "bun:test"
import type { Transaction } from "../src/index"
import { compileRules, databaseRules } from "../src/index"

const rules = compileRules(databaseRules)
function tx(over: { body?: string; respHeaders?: [string, string][] }): Transaction {
  return {
    id: "t",
    source: "browser",
    host: "app.test",
    request: { method: "GET", url: "https://app.test/", headers: [] },
    response: { status: 200, headers: (over.respHeaders ?? []).map(([n, v]) => ({ name: n, value: v })), body: over.body ?? "" },
  }
}
const fired = (t: Transaction) => rules.flatMap((r) => r.evaluate(t)).map((s) => s.ruleId)

describe("database fingerprint rules", () => {
  test("MySQL via error message", () => {
    expect(fired(tx({ body: "You have an error in your SQL syntax; check the manual" }))).toContain("tech-db-mysql")
  })

  test("MySQL via PHP function", () => {
    expect(fired(tx({ body: "Warning: mysqli_query() expects parameter 1" }))).toContain("tech-db-mysql")
  })

  test("Firebase via SDK script", () => {
    expect(fired(tx({ body: '<script src="https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js"></script>' }))).toContain("tech-db-firebase")
  })

  test("Firebase via initializeApp", () => {
    expect(fired(tx({ body: "firebase.initializeApp({ apiKey: 'abc', projectId: 'demo' })" }))).toContain("tech-db-firebase")
  })

  test("Firebase via firebaseio.com", () => {
    expect(fired(tx({ body: '<script>const db = "https://myapp.firebaseio.com";</script>' }))).toContain("tech-db-firebase")
  })

  test("PostgreSQL via error message", () => {
    expect(fired(tx({ body: 'ERROR:  relation "users" does not exist' }))).toContain("tech-db-postgresql")
  })

  test("PostgreSQL via Npgsql exception", () => {
    expect(fired(tx({ body: "Npgsql.PostgresException: 42P01" }))).toContain("tech-db-postgresql")
  })

  test("MariaDB via body", () => {
    expect(fired(tx({ body: "Powered by MariaDB 10.11" }))).toContain("tech-db-mariadb")
  })

  test("MariaDB via server header", () => {
    expect(fired(tx({ respHeaders: [["server", "MariaDB"]] }))).toContain("tech-db-mariadb")
  })

  test("MongoDB via error", () => {
    expect(fired(tx({ body: "MongoError: E11000 duplicate key error" }))).toContain("tech-db-mongodb")
  })

  test("MongoDB via client reference", () => {
    expect(fired(tx({ body: "mongoose.connect('mongodb://localhost/mydb')" }))).toContain("tech-db-mongodb")
  })

  test("Redis via error", () => {
    expect(fired(tx({ body: "WRONGTYPE Operation against a key holding the wrong kind" }))).toContain("tech-db-redis")
  })

  test("Redis via client", () => {
    expect(fired(tx({ body: "redis.createClient({ host: 'localhost' })" }))).toContain("tech-db-redis")
  })

  test("Dimensions AI via body", () => {
    expect(fired(tx({ body: '<script src="https://badge.dimensions.ai/badge.js"></script>' }))).toContain("tech-db-dimensions-ai")
  })

  test("PouchDB via body", () => {
    expect(fired(tx({ body: "var db = new PouchDB('mydb');" }))).toContain("tech-db-pouchdb")
  })

  test("Lucene via body", () => {
    expect(fired(tx({ body: "Powered by Apache Lucene 9.8" }))).toContain("tech-db-lucene")
  })

  test("Solr via body", () => {
    expect(fired(tx({ body: '<a href="/solr/admin/">Apache Solr Admin</a>' }))).toContain("tech-db-solr")
  })

  test("Solr via server header", () => {
    expect(fired(tx({ respHeaders: [["server", "Solr/9.4"]] }))).toContain("tech-db-solr")
  })

  test("Claris FileMaker via body", () => {
    expect(fired(tx({ body: "FileMaker Server 21.0" }))).toContain("tech-db-filemaker")
  })

  test("Claris FileMaker via server header", () => {
    expect(fired(tx({ respHeaders: [["server", "FileMaker"]] }))).toContain("tech-db-filemaker")
  })

  test("Virtuoso via body", () => {
    expect(fired(tx({ body: "OpenLink Virtuoso Universal Server" }))).toContain("tech-db-virtuoso")
  })

  test("Virtuoso via server header", () => {
    expect(fired(tx({ respHeaders: [["server", "Virtuoso/08.03"]] }))).toContain("tech-db-virtuoso")
  })

  test("SQLite via error", () => {
    expect(fired(tx({ body: "sqlite3.OperationalError: no such table: users" }))).toContain("tech-db-sqlite")
  })

  test("SQLite via SQLITE_ERROR", () => {
    expect(fired(tx({ body: "SQLITE_ERROR: near 'SELECT': syntax error" }))).toContain("tech-db-sqlite")
  })

  // --- Structural ---
  test("a plain page triggers no database rules", () => {
    expect(fired(tx({ body: "<html><body>Hello</body></html>" }))).toHaveLength(0)
  })

  test("all rule IDs start with tech-db-", () => {
    for (const r of databaseRules) expect(r.id).toMatch(/^tech-db-/)
  })

  test("all rules have database tag", () => {
    for (const r of databaseRules) expect(r.tags).toContain("database")
  })

  test("rule count is 13", () => {
    expect(databaseRules.length).toBe(13)
  })
})
