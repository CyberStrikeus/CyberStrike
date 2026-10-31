import { createHash } from "node:crypto";
import {
  lstat,
  readFile,
  rename,
  stat,
  symlink,
  truncate,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, expect, onTestFinished } from "vitest";
import { z } from "zod";
import {
  expandProviderCapabilities,
  expandToolAvailability,
  providerCapabilitySet,
  toolAvailabilitySummaryInventory,
} from "../../src/contracts/toolOutputSchemaPrimitives.js";

import {
  createSqliteApplicationCollationFixture,
  createSqliteLongNameFixture,
  SQLITE_NATIVE_LIMITS_AVAILABLE,
} from "../fixtures/sqlite/database.js";
import { parseEvidence } from "../../src/domain/evidence.js";
import { sqliteDatabaseSchema } from "../../src/domain/sqlite/sqliteDatabase.js";
import { connectLocalToolsMcp } from "../fixtures/localToolsMcp.js";
import { expectCliMcpEvidenceParity } from "../fixtures/cliMcpEvidenceParity.js";
import { parseMcpToolError } from "../fixtures/mcpToolError.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";
import {
  cliTest,
  createSharedMcpSession,
  runFileCli,
} from "../support/cli/cliFixture.js";

const digest = (bytes: Buffer): string =>
  createHash("sha256").update(bytes).digest("hex");

// These stateless parity cases use the same default admission settings. Keep
// their server file-owned, while lifecycle and configuration cases use fresh
// connections with test-owned cleanup.
const parityMcp = createSharedMcpSession(async (registerCleanup, isClosed) => {
  if (isClosed()) throw new Error("SQLite parity MCP session is closed");
  return (await connectLocalToolsMcp({}, registerCleanup)).call;
});
afterAll(() => parityMcp.close());

cliTest.runIf(SQLITE_NATIVE_LIMITS_AVAILABLE)(
  "unions SQLite cell slices with numeric cell paths",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-sqlite-mixed-filter-");
    const path = join(root, "selected.db");
    const database = new DatabaseSync(path);
    try {
      database.exec(
        "CREATE TABLE selected (first TEXT, second TEXT); INSERT INTO selected VALUES ('left', 'right')",
      );
    } finally {
      database.close();
    }
    const base = "normalized_result.rows.values[0,1]";
    for (const filter of [
      `${base}[0,1].value,${base}.1.value`,
      `${base}.1.value,${base}[0,1].value`,
    ]) {
      const result = await runFileCli(cli, {
        arguments: [
          "inspect-sqlite-database",
          path,
          "--table",
          "selected",
          "--json",
          "--filter-output",
          filter,
        ],
        environment: { REA_LOG_LEVEL: "silent" },
      });
      expect(result.exitCode, result.stdout + result.stderr).toBe(0);
      expect(result.json).toEqual({
        normalized_result: {
          rows: { values: [[{ value: "left" }, { value: "right" }]] },
        },
      });
    }
    const refused = await runFileCli(cli, {
      arguments: [
        "inspect-sqlite-database",
        path,
        "--table",
        "selected",
        "--json",
        "--filter-output",
        `${base}[0,1].value,${base}.length`,
      ],
      environment: { REA_LOG_LEVEL: "silent" },
    });
    expect(refused.exitCode).toBe(1);
    expect(refused.json).toMatchObject({
      code: "invalid_request",
      message: expect.stringContaining("non-index property"),
    });
  },
);

cliTest.runIf(SQLITE_NATIVE_LIMITS_AVAILABLE)(
  "projects selected SQLite matrix cells through consecutive output slices",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-sqlite-matrix-filter-");
    const path = join(root, "selected.db");
    const database = new DatabaseSync(path);
    try {
      database.exec(
        "CREATE TABLE selected (first TEXT, second TEXT); INSERT INTO selected VALUES ('left', 'right')",
      );
    } finally {
      database.close();
    }
    const result = await runFileCli(cli, {
      arguments: [
        "inspect-sqlite-database",
        path,
        "--table",
        "selected",
        "--column",
        "second",
        "--column",
        "first",
        "--json",
        "--filter-output",
        "normalized_result.rows.values[0,1][0,1].value",
      ],
      environment: { REA_LOG_LEVEL: "silent" },
    });
    expect(result.exitCode, result.stdout + result.stderr).toBe(0);
    expect(result.json).toEqual({
      normalized_result: { rows: { values: [[{ value: "right" }]] } },
    });
  },
);

for (const expectedErrno of ["ELOOP", "ENAMETOOLONG"] as const) {
  cliTest.skipIf(expectedErrno === "ELOOP" && process.platform === "win32")(
    `reports an initial ${expectedErrno} path failure through CLI and MCP`,
    async ({ cli }) => {
      const root = await createTestTempDirectory("rea-sqlite-path-failure-");
      const path =
        expectedErrno === "ELOOP"
          ? join(root, "cycle-a", "selected.db")
          : join(root, "a".repeat(300), "selected.db");
      if (expectedErrno === "ELOOP") {
        await symlink("cycle-b", join(root, "cycle-a"));
        await symlink("cycle-a", join(root, "cycle-b"));
      }
      const result = await cli.run({
        arguments: ["inspect-sqlite-database", path, "--json"],
        environment: { REA_LOG_LEVEL: "silent" },
      });
      expect(result.exitCode).toBe(1);
      const expectedError = {
        code: "invalid_request",
        details: {
          issues: [
            {
              path: ["path"],
              reason: "invalid_value",
              message: expect.stringContaining(expectedErrno),
            },
          ],
        },
      };
      expect(result.json).toMatchObject(expectedError);
      const { call } = await connectLocalToolsMcp();
      const response = await call("inspect_sqlite_database", { path });
      expect(parseMcpToolError(response).error).toMatchObject(expectedError);
    },
  );
}

cliTest(
  "reports the combined database and WAL byte budget through CLI and MCP",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-sqlite-size-budget-");
    const path = join(root, "selected.db");
    const walPath = `${path}-wal`;
    const maximum = 256 * 1024 * 1024;
    const databaseBytes = maximum / 2;
    const walBytes = databaseBytes + 1;
    await writeFile(path, "");
    await writeFile(walPath, "");
    await truncate(path, databaseBytes);
    await truncate(walPath, walBytes);
    const before = await Promise.all(
      [path, walPath].map(async (filePath) => ({
        path: filePath,
        state: await lstat(filePath, { bigint: true }),
      })),
    );
    const cliResult = await cli.run({
      arguments: [
        "inspect-sqlite-database",
        path,
        "--worker-timeout-ms",
        "60000",
        "--json",
      ],
      environment: { REA_LOG_LEVEL: "silent" },
    });
    const { call } = await connectLocalToolsMcp();
    const mcpResponse = await call("inspect_sqlite_database", {
      path,
      worker_timeout_ms: 60000,
    });
    const mcpError = parseMcpToolError(mcpResponse).error;
    const expectedError = {
      code: "resource_constraint",
      category: "resource_constraint",
      retryable: false,
      details: {
        reported_limits: {
          sqlite_snapshot_input_bytes: maximum,
          observed_sqlite_snapshot_input_bytes: String(maximum + 1),
        },
      },
      remediation: {
        action: expect.stringContaining("supported export workflow"),
      },
    };
    expect(cliResult.exitCode).toBe(1);
    expect(cliResult.json).toMatchObject(expectedError);
    expect(mcpError).toMatchObject(expectedError);
    const after = await Promise.all(
      before.map(async ({ path: filePath }) => ({
        path: filePath,
        state: await lstat(filePath, { bigint: true }),
      })),
    );
    for (const [index, original] of before.entries()) {
      const current = after[index];
      expect(current?.state).toMatchObject({
        dev: original.state.dev,
        ino: original.state.ino,
        mode: original.state.mode,
        size: original.state.size,
        mtimeNs: original.state.mtimeNs,
        ctimeNs: original.state.ctimeNs,
      });
    }
  },
);

cliTest.skipIf(process.platform === "win32" || !SQLITE_NATIVE_LIMITS_AVAILABLE)(
  "reports an unavailable capability when a closed database sidecar path is too long",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-sqlite-long-basename-");
    const path = join(root, "x".repeat(255));
    const originalPath = join(root, "selected.db");
    const database = new DatabaseSync(originalPath);
    try {
      database.exec(
        "CREATE TABLE selected(value TEXT); INSERT INTO selected VALUES ('retained');",
      );
    } finally {
      database.close();
    }
    await rename(originalPath, path);
    const selectedBefore = await lstat(path, { bigint: true });
    await expect(lstat(`${path}-wal`)).rejects.toMatchObject({
      code: "ENAMETOOLONG",
    });
    await expect(lstat(`${path}-journal`)).rejects.toMatchObject({
      code: "ENAMETOOLONG",
    });

    const cliResult = await cli.run({
      arguments: ["inspect-sqlite-database", path, "--json"],
      environment: { REA_LOG_LEVEL: "silent" },
    });
    const { call } = await connectLocalToolsMcp();
    const mcpResult = await call("inspect_sqlite_database", { path });
    const expectedError = {
      code: "capability_unavailable",
      category: "unsupported_provider",
      retryable: false,
      message: expect.stringContaining("supported consistent offline export"),
      details: {
        provider_id: "sqlite",
        operation: "inspect_sqlite_database",
        reason: expect.stringContaining("ENAMETOOLONG"),
      },
      remediation: {
        action: expect.stringContaining("supported consistent offline export"),
      },
    };
    expect(cliResult.exitCode).toBe(1);
    expect(cliResult.json).toMatchObject(expectedError);
    expect(parseMcpToolError(mcpResult).error).toMatchObject(expectedError);
    const selectedAfter = await lstat(path, { bigint: true });
    expect(selectedAfter).toMatchObject({
      dev: selectedBefore.dev,
      ino: selectedBefore.ino,
      mode: selectedBefore.mode,
      size: selectedBefore.size,
      mtimeNs: selectedBefore.mtimeNs,
      ctimeNs: selectedBefore.ctimeNs,
    });
  },
);

cliTest.runIf(SQLITE_NATIVE_LIMITS_AVAILABLE)(
  "bounds default context and projects exact columns without evaluating unrelated cells",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-sqlite-selective-");
    const path = join(root, "selected.db");
    const database = new DatabaseSync(path);
    try {
      database.exec(`
        CREATE TABLE selected(id INTEGER, "" TEXT, payload BLOB GENERATED ALWAYS AS (zeroblob(72*1024*1024)) VIRTUAL);
        CREATE TABLE unrelated(value TEXT);
        CREATE VIEW unrelated_view AS SELECT value FROM unrelated;
        CREATE INDEX selected_id ON selected(id);
        CREATE TRIGGER selected_trigger AFTER INSERT ON selected BEGIN SELECT 1; END;
        WITH RECURSIVE numbers(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM numbers WHERE n<21)
        INSERT INTO selected(id, "") SELECT n, 'retained' FROM numbers;
      `);
    } finally {
      database.close();
    }
    const before = await readFile(path);
    const { call } = await connectLocalToolsMcp();
    const inventory = await call("inspect_sqlite_database", { path });
    expect(inventory.isError).not.toBe(true);
    const inventoryEvidence = parseEvidence(inventory.structuredContent);
    expect(inventoryEvidence.parameters).not.toHaveProperty(
      "worker_timeout_ms",
    );
    expect(
      sqliteDatabaseSchema.parse(inventoryEvidence.normalized_result)
        .worker_timeout_ms,
    ).toBe(30_000);
    const schema = z
      .object({
        normalized_result: z.object({
          schema: z.object({
            scope: z.literal("inventory"),
            tables: z.array(
              z.object({
                name: z.string(),
                columns: z.array(z.unknown()),
                columns_completeness: z.literal("not_requested"),
              }),
            ),
          }),
        }),
      })
      .parse(inventory.structuredContent).normalized_result.schema;
    expect(schema.tables.map((table) => table.name)).toEqual([
      "selected",
      "unrelated",
    ]);
    expect(schema.tables.every((table) => table.columns.length === 0)).toBe(
      true,
    );
    expect(JSON.stringify(inventory.structuredContent)).not.toContain(
      "zeroblob",
    );
    const selected = await call("inspect_sqlite_database", {
      path,
      table: "selected",
      columns: ["", "id", "id"],
      worker_timeout_ms: 42000,
    });
    expect(selected.isError).not.toBe(true);
    expect(selected.structuredContent).toMatchObject({
      parameters: { worker_timeout_ms: 42000 },
      normalized_result: {
        worker_timeout_ms: 42000,
        schema: {
          scope: "selected_table",
          tables: [{ name: "selected" }],
          views: [],
          indexes: [{ name: "selected_id" }],
          triggers: [{ name: "selected_trigger" }],
        },
        rows: {
          columns: ["", "id", "id"],
          row_limit: 20,
          returned_rows: 20,
          truncated: true,
          values: expect.arrayContaining([
            [
              {
                type: "text",
                value: "retained",
                bytes_hex: "72657461696e6564",
                encoding: "UTF-8",
              },
              { type: "integer", value: "1" },
              { type: "integer", value: "1" },
            ],
          ]),
        },
      },
    });
    const cliResult = await runFileCli(cli, {
      arguments: [
        "inspect-sqlite-database",
        path,
        "--table",
        "selected",
        "--column",
        "id",
        "--column",
        "",
        "--row-limit",
        "1",
        "--worker-timeout-ms",
        "42000",
        "--json",
      ],
      environment: { REA_LOG_LEVEL: "silent" },
    });
    expect(cliResult.exitCode, cliResult.stdout + cliResult.stderr).toBe(0);
    expect(cliResult.json).toMatchObject({
      parameters: { worker_timeout_ms: 42000 },
      normalized_result: {
        worker_timeout_ms: 42000,
        rows: { columns: ["id", ""], returned_rows: 1 },
      },
    });
    for (const { input, issue } of [
      {
        input: { path, columns: ["id"] },
        issue: { path: ["columns"], reason: "invalid_value" },
      },
      {
        input: { path, schema_scope: "selected_table" },
        issue: { path: ["schema_scope"], reason: "invalid_value" },
      },
      {
        input: { path, table: "selected", columns: [] },
        issue: { path: ["columns"], reason: "out_of_range", minimum: 1 },
      },
      {
        input: { path, table: "selected", columns: ["ID"] },
        issue: { path: ["columns"], reason: "invalid_format" },
      },
    ]) {
      const response = await call("inspect_sqlite_database", input);
      expect(parseMcpToolError(response).error).toMatchObject({
        code: "invalid_request",
        details: {
          operation: "inspect_sqlite_database",
          issues: expect.arrayContaining([expect.objectContaining(issue)]),
        },
      });
    }
    expect(Buffer.compare(await readFile(path), before)).toBe(0);
  },
);

cliTest(
  "discovers SQLite runtime availability before inspecting a database through CLI and MCP",
  async ({ cli }) => {
    const result = await cli.run({
      arguments: ["capabilities", "--json"],
      environment: { REA_LOG_LEVEL: "silent" },
    });
    expect(result.exitCode, result.stdout + result.stderr).toBe(0);
    const status = z
      .object({
        open: z.literal(false),
        capabilities: z.array(providerCapabilitySet),
      })
      .parse(result.json);
    expect(expandProviderCapabilities(status.capabilities)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operation: "inspect_sqlite_database",
          available: SQLITE_NATIVE_LIMITS_AVAILABLE,
          reason: SQLITE_NATIVE_LIMITS_AVAILABLE
            ? null
            : expect.stringContaining("Node.js 24.x >=24.15 or 26+"),
          availability_code: SQLITE_NATIVE_LIMITS_AVAILABLE
            ? null
            : "unsupported_version",
          limitations: [expect.stringContaining("DatabaseSync.limits")],
          effects: {
            mutates_artifact: false,
            launches_process: true,
            may_show_ui: false,
            may_access_network: false,
            may_write_filesystem: true,
            changes_permissions: false,
            requires_root: false,
          },
        }),
      ]),
    );
    const { call } = await connectLocalToolsMcp();
    const response = await call("binary_session", {});
    expect(response.isError).not.toBe(true);
    const sessionStatus = z
      .object({
        result: z.object({
          tool_availability: toolAvailabilitySummaryInventory,
        }),
      })
      .parse(response.structuredContent);
    expect(
      expandToolAvailability(sessionStatus.result.tool_availability),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "inspect_sqlite_database",
          available: SQLITE_NATIVE_LIMITS_AVAILABLE,
          remediation: SQLITE_NATIVE_LIMITS_AVAILABLE
            ? null
            : expect.stringContaining("Node.js 24.x >=24.15 or 26+"),
        }),
      ]),
    );
  },
);

cliTest.skipIf(SQLITE_NATIVE_LIMITS_AVAILABLE)(
  "reports the required native SQLite limits capability through CLI and MCP",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-sqlite-unavailable-");
    const path = join(root, "selected.db");
    const database = new DatabaseSync(path);
    try {
      database.exec("CREATE TABLE items(value INTEGER)");
    } finally {
      database.close();
    }
    const result = await cli.run({
      arguments: ["inspect-sqlite-database", path, "--json"],
      environment: { REA_LOG_LEVEL: "silent" },
    });
    expect(result.exitCode).toBe(1);
    expect(result.json).toMatchObject({
      code: "capability_unavailable",
      message: expect.stringContaining("DatabaseSync.limits"),
    });
    const { call } = await connectLocalToolsMcp();
    const response = await call("inspect_sqlite_database", { path });
    expect(response.isError).toBe(true);
    expect(parseMcpToolError(response).error).toMatchObject({
      code: "capability_unavailable",
      message: expect.stringContaining("DatabaseSync.limits"),
    });
  },
);

cliTest.runIf(SQLITE_NATIVE_LIMITS_AVAILABLE)(
  "accepts small samples above 1000 rows within the real resource budgets",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-sqlite-row-budget-");
    const path = join(root, "rows.db");
    const database = new DatabaseSync(path);
    try {
      database.exec(`CREATE TABLE items(value INTEGER);
      WITH RECURSIVE numbers(value) AS (SELECT 1 UNION ALL SELECT value + 1 FROM numbers WHERE value < 1002)
      INSERT INTO items SELECT value FROM numbers;`);
    } finally {
      database.close();
    }
    const { call } = await connectLocalToolsMcp();
    for (const limit of [1001, Number.MAX_SAFE_INTEGER]) {
      const result = await runFileCli(cli, {
        arguments: [
          "inspect-sqlite-database",
          path,
          "--table",
          "items",
          "--row-limit",
          String(limit),
          "--json",
        ],
        environment: { REA_LOG_LEVEL: "silent" },
      });
      expect(result.exitCode, result.stdout + result.stderr).toBe(0);
      expect(result.json).toMatchObject({
        normalized_result: {
          rows: {
            row_limit: limit,
            returned_rows: Math.min(limit, 1002),
            truncated: limit < 1002,
          },
        },
      });
      const response = await call("inspect_sqlite_database", {
        path,
        table: "items",
        row_limit: limit,
      });
      expect(response.isError, JSON.stringify(response)).not.toBe(true);
      expectCliMcpEvidenceParity(result.json, response.structuredContent, path);
    }
  },
);

const sourceState = async (path: string) => {
  const bytes = await readFile(path);
  const metadata = await stat(path, { bigint: true });
  return {
    bytes,
    device: metadata.dev,
    inode: metadata.ino,
    size: metadata.size,
    modified: metadata.mtimeNs,
    changed: metadata.ctimeNs,
  };
};

const createLosslessSnapshot = (path: string, journalMode: string): void => {
  const database = new DatabaseSync(path);
  try {
    database.exec(`PRAGMA journal_mode=${journalMode}`);
    database.exec(`
      CREATE TABLE "odd "" table" (
        id INTEGER PRIMARY KEY,
        payload BLOB,
        amount REAL,
        missing TEXT,
        text_value TEXT,
        negative_zero,
        generated TEXT GENERATED ALWAYS AS (hex(payload)) VIRTUAL
      );
      CREATE UNIQUE INDEX "quoted "" index" ON "odd "" table"(payload, id);
      CREATE VIEW readable AS SELECT id FROM "odd "" table";
      CREATE TRIGGER observed AFTER INSERT ON "odd "" table" BEGIN SELECT 1; END;
      CREATE TABLE keyed(k TEXT PRIMARY KEY) WITHOUT ROWID, STRICT;
    `);
    const insert = database.prepare(
      'INSERT INTO "odd "" table"(id,payload,amount,missing,text_value,negative_zero) VALUES(?,?,?,NULL,CAST(X\'80ff\' AS TEXT),?)',
    );
    insert.setReadBigInts(true);
    expect(
      insert.run(
        9007199254740993n,
        Buffer.from("deadbeef", "hex"),
        Infinity,
        -0,
      ).lastInsertRowid,
    ).toBe(9007199254740993n);
    insert.run(9007199254740994n, Buffer.from("deadbeef", "hex"), Infinity, -0);
  } finally {
    database.close();
  }
};

cliTest
  .runIf(SQLITE_NATIVE_LIMITS_AVAILABLE)
  .for(["DELETE", "PERSIST", "TRUNCATE"])(
  "inspects a real %s SQLite schema and lossless selected records identically through CLI and MCP",
  async (journalMode, { cli }) => {
    const root = await createTestTempDirectory("rea-sqlite-public-");
    const path = join(root, "selected.db");
    createLosslessSnapshot(path, journalMode);
    const original = await readFile(path);
    const result = await cli.run({
      arguments: [
        "inspect-sqlite-database",
        "selected.db",
        "--schema-scope",
        "database",
        "--table",
        'odd " table',
        "--row-limit",
        "1",
        "--json",
      ],
      cwd: root,
      environment: {
        REA_LOG_LEVEL: "silent",
        REA_ANALYSIS_PROVIDER: "ghidra",
        REA_GHIDRA_HOME: "/unconfigured/ghidra",
      },
    });
    expect(result.exitCode, result.stdout + result.stderr).toBe(0);
    expect(result.json).toMatchObject({
      operation: "inspect_sqlite_database",
      confidence: "observed",
      subject: { local_path: path, digest: { sha256: digest(original) } },
      normalized_result: {
        artifact: { path, sha256: digest(original), bytes: original.length },
        wal: null,
        schema: {
          completeness: "complete",
          tables: expect.arrayContaining([
            expect.objectContaining({
              name: 'odd " table',
              columns: expect.arrayContaining([
                expect.objectContaining({
                  name: "id",
                  primary_key_position: 1,
                }),
                expect.objectContaining({ name: "generated", hidden: 2 }),
              ]),
            }),
            expect.objectContaining({
              name: "keyed",
              without_rowid: true,
              strict: true,
            }),
          ]),
          indexes: expect.arrayContaining([
            expect.objectContaining({
              name: 'quoted " index',
              table: 'odd " table',
            }),
          ]),
          views: [
            { name: "readable", sql: expect.stringContaining("SELECT id") },
          ],
          triggers: [
            {
              name: "observed",
              table: 'odd " table',
              sql: expect.stringContaining("AFTER INSERT"),
            },
          ],
        },
        rows: {
          table: 'odd " table',
          columns: [
            "id",
            "payload",
            "amount",
            "missing",
            "text_value",
            "negative_zero",
            "generated",
          ],
          returned_rows: 1,
          row_limit: 1,
          truncated: true,
          values: [
            [
              {
                type: "integer",
                value: expect.stringMatching(/^900719925474099[34]$/),
              },
              { type: "blob", hex: "deadbeef" },
              { type: "real", value: "Infinity" },
              { type: "null" },
              { type: "text", value: "\ufffd\ufffd", bytes_hex: "80ff" },
              { type: "real", value: "-0" },
              {
                type: "text",
                value: "DEADBEEF",
                bytes_hex: "4445414442454546",
              },
            ],
          ],
        },
      },
    });
    const call = await parityMcp.session.call();
    const response = await call("inspect_sqlite_database", {
      path,
      table: 'odd " table',
      schema_scope: "database",
      row_limit: 1,
    });
    expect(response.isError, JSON.stringify(response)).not.toBe(true);
    expectCliMcpEvidenceParity(
      result.json,
      response.structuredContent,
      "selected.db",
    );
    expect(Buffer.compare(await readFile(path), original)).toBe(0);
  },
);

cliTest.runIf(SQLITE_NATIVE_LIMITS_AVAILABLE)(
  "includes uncheckpointed committed WAL data without modifying the source database or sidecars",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-sqlite-wal-public-");
    const path = join(root, "wal.db");
    const database = new DatabaseSync(path);
    onTestFinished(() => database.close());
    database.exec(
      "PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE committed(value TEXT); INSERT INTO committed VALUES('only in WAL');",
    );
    const files = [path, `${path}-wal`, `${path}-shm`];
    const before = await Promise.all(files.map(sourceState));
    const db = before[0];
    const wal = before[1];
    expect(db).toBeDefined();
    expect(wal).toBeDefined();
    const result = await runFileCli(cli, {
      arguments: [
        "inspect-sqlite-database",
        path,
        "--table",
        "committed",
        "--json",
      ],
      environment: { REA_LOG_LEVEL: "silent" },
    });
    expect(result.exitCode, result.stdout + result.stderr).toBe(0);
    expect(result.json).toMatchObject({
      normalized_result: {
        artifact: { sha256: db === undefined ? "missing" : digest(db.bytes) },
        wal: {
          path: `${path}-wal`,
          sha256: wal === undefined ? "missing" : digest(wal.bytes),
        },
        rows: {
          values: [
            [
              {
                type: "text",
                value: "only in WAL",
                bytes_hex: Buffer.from("only in WAL").toString("hex"),
              },
            ],
          ],
          returned_rows: 1,
          truncated: false,
        },
      },
    });
    const { call } = await connectLocalToolsMcp();
    const response = await call("inspect_sqlite_database", {
      path,
      table: "committed",
    });
    expect(response.isError, JSON.stringify(response)).not.toBe(true);
    expectCliMcpEvidenceParity(result.json, response.structuredContent, path);
    const after = await Promise.all(files.map(sourceState));
    expect(after).toEqual(before);
  },
);

cliTest.runIf(SQLITE_NATIVE_LIMITS_AVAILABLE)(
  "returns actionable public errors for corrupt input, unknown or ambiguous tables and invalid record choices",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-sqlite-errors-public-");
    const path = join(root, "invalid.db");
    const { call } = await connectLocalToolsMcp();
    // Distinct malformed selections each name their own selected path.
    for (const selected of [path, join(root, "other-invalid.db")]) {
      await writeFile(selected, "not a SQLite database");
      const expectedError = {
        code: "invalid_request",
        details: {
          issues: [
            {
              path: ["path"],
              reason: "invalid_format",
              message: `Selected SQLite database is invalid (file is not a database): ${selected}`,
            },
          ],
        },
      };
      const corrupt = await runFileCli(cli, {
        arguments: ["inspect-sqlite-database", selected, "--json"],
        environment: { REA_LOG_LEVEL: "silent" },
      });
      expect(corrupt.exitCode).toBe(1);
      expect(corrupt.json).toMatchObject(expectedError);
      const response = await call("inspect_sqlite_database", {
        path: selected,
      });
      expect(parseMcpToolError(response).error).toMatchObject(expectedError);
    }
    const valid = join(root, "valid.db");
    const database = new DatabaseSync(valid);
    try {
      database.exec(
        "CREATE TABLE present(value TEXT); CREATE VIRTUAL TABLE search USING fts5(body);",
      );
    } finally {
      database.close();
    }
    const bytes = await readFile(valid);
    const declaration = bytes.indexOf(Buffer.from("USING fts5"));
    if (declaration < 0) throw new Error("Virtual declaration missing");
    bytes.write("zzzz", declaration + Buffer.byteLength("USING "), "utf8");
    await writeFile(valid, bytes);
    const schema = await call("inspect_sqlite_database", { path: valid });
    expect(schema.isError).not.toBe(true);
    expect(schema.structuredContent).toMatchObject({
      normalized_result: {
        schema: {
          tables: expect.arrayContaining([
            expect.objectContaining({ name: "search_data", kind: "unknown" }),
          ]),
        },
      },
    });
    const ambiguous = await runFileCli(cli, {
      arguments: [
        "inspect-sqlite-database",
        valid,
        "--table",
        "search_data",
        "--json",
      ],
      environment: { REA_LOG_LEVEL: "silent" },
    });
    expect(ambiguous.exitCode).toBe(1);
    expect(ambiguous.stdout).toContain("shadow table");
    expect(
      (
        await call("inspect_sqlite_database", {
          path: valid,
          table: "search_data",
        })
      ).isError,
    ).toBe(true);
    const missing = await runFileCli(cli, {
      arguments: [
        "inspect-sqlite-database",
        valid,
        "--table",
        "absent",
        "--json",
      ],
      environment: { REA_LOG_LEVEL: "silent" },
    });
    expect(missing.exitCode).toBe(1);
    expect(missing.stdout).toContain("absent");
    expect(
      (await call("inspect_sqlite_database", { path: valid, table: "absent" }))
        .isError,
    ).toBe(true);
    for (const input of [
      { path: valid, row_limit: 1 },
      { path: valid, table: "present", row_limit: 0 },
      { path: valid, query: "DELETE FROM present" },
    ]) {
      expect(
        (await call("inspect_sqlite_database", input)).isError,
        JSON.stringify(input),
      ).toBe(true);
    }
  },
);

cliTest.runIf(SQLITE_NATIVE_LIMITS_AVAILABLE)(
  "reports inventory projections beyond SQLite bind capacity through CLI and MCP",
  async ({ cli }) => {
    const root = await createTestTempDirectory(
      "rea-sqlite-inventory-capacity-",
    );
    const path = join(root, "selected.db");
    const producer = new DatabaseSync(path);
    let selectedColumns: number;
    let engineColumnLimit: number;
    try {
      producer.exec(
        "CREATE TABLE records(value TEXT); INSERT INTO records VALUES ('retained');",
      );
      engineColumnLimit = producer.limits.column;
      selectedColumns =
        Math.max(producer.limits.variableNumber, engineColumnLimit) + 1;
    } finally {
      producer.close();
    }
    const before = await sourceState(path);
    const control = await runFileCli(cli, {
      arguments: [
        "inspect-sqlite-database",
        path,
        "--schema-scope",
        "inventory",
        "--table",
        "records",
        "--column",
        "value",
        "--row-limit",
        "1",
        "--json",
      ],
      environment: { REA_LOG_LEVEL: "silent" },
    });
    expect(control.exitCode, control.stdout + control.stderr).toBe(0);
    expect(control.json).toMatchObject({
      normalized_result: {
        schema: { scope: "inventory" },
        rows: {
          columns: ["value"],
          returned_rows: 1,
          values: [[{ type: "text", value: "retained" }]],
        },
      },
    });
    const columns = Array.from({ length: selectedColumns }, () => "value");
    // The framed fixture executes the compiled public CLI without the host's
    // process-argument ceiling rejecting this many repeated flags first.
    const result = await runFileCli(cli, {
      arguments: [
        "inspect-sqlite-database",
        path,
        "--schema-scope",
        "inventory",
        "--table",
        "records",
        ...columns.flatMap((column) => ["--column", column]),
        "--row-limit",
        "1",
        "--json",
      ],
      environment: { REA_LOG_LEVEL: "silent" },
    });
    const input = {
      path,
      schema_scope: "inventory",
      table: "records",
      columns,
      row_limit: 1,
    };
    // Admit this fixture's array elements and root members so the test still
    // reaches SQLite's own capacity boundary rather than transport admission.
    const { call } = await connectLocalToolsMcp({
      REA_MCP_MAX_INPUT_ELEMENTS: String(
        columns.length + Object.keys(input).length,
      ),
    });
    const response = await call("inspect_sqlite_database", input);
    const expectedError = {
      code: "resource_constraint",
      category: "resource_constraint",
      retryable: false,
      details: {
        resource: "capacity",
        diagnostics: { selected_path: path },
        reported_limits: {
          selected_result_columns: selectedColumns,
          engine_result_column_limit: engineColumnLimit,
        },
      },
    };
    expect(result.exitCode, result.stdout + result.stderr).toBe(1);
    expect(result.json).toMatchObject(expectedError);
    expect(parseMcpToolError(response).error).toMatchObject(expectedError);
    expect(await sourceState(path)).toEqual(before);
  },
);

cliTest.runIf(SQLITE_NATIVE_LIMITS_AVAILABLE)(
  "reports unavailable application-collation rows with schema-only recovery through CLI and MCP",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-sqlite-collation-public-");
    const path = createSqliteApplicationCollationFixture(root);
    const before = await sourceState(path);
    const { call } = await connectLocalToolsMcp();
    const schema = await runFileCli(cli, {
      arguments: [
        "inspect-sqlite-database",
        path,
        "--schema-scope",
        "database",
        "--json",
      ],
      environment: { REA_LOG_LEVEL: "silent" },
    });
    const schemaResponse = await call("inspect_sqlite_database", {
      path,
      schema_scope: "database",
    });
    const expectedSchema = {
      subject: { local_path: path, digest: { sha256: digest(before.bytes) } },
      normalized_result: {
        rows: null,
        schema: {
          tables: [
            {
              name: "items",
              without_rowid: true,
              sql: expect.stringContaining("COLLATE APPLICATION_COLLATION"),
              columns: [
                { name: "name", hidden: 0 },
                { name: "value", hidden: 0 },
                { name: "generated_value", hidden: 2 },
              ],
            },
          ],
        },
      },
    };
    expect(schema.exitCode, schema.stdout + schema.stderr).toBe(0);
    expect(schema.json).toMatchObject(expectedSchema);
    expect(schemaResponse.isError).not.toBe(true);
    expect(schemaResponse.structuredContent).toMatchObject(expectedSchema);

    const result = await runFileCli(cli, {
      arguments: [
        "inspect-sqlite-database",
        path,
        "--table",
        "items",
        "--json",
      ],
      environment: { REA_LOG_LEVEL: "silent" },
    });
    const response = await call("inspect_sqlite_database", {
      path,
      table: "items",
    });
    const expectedError = {
      code: "capability_unavailable",
      retryable: false,
      message: expect.stringMatching(
        /rows of table "items".*(?:no query solution|no such collation sequence)/,
      ),
      details: {
        provider_id: "sqlite",
        operation: "inspect_sqlite_database",
        diagnostics: { selected_path: path },
      },
      remediation: {
        action: expect.stringContaining("schema_scope: database"),
      },
    };
    expect(result.exitCode, result.stdout + result.stderr).toBe(1);
    expect(result.json).toMatchObject(expectedError);
    const error = parseMcpToolError(response).error;
    expect(error).toMatchObject(expectedError);
    expect(error.remediation.action).not.toContain(
      "Select columns whose values were read",
    );
    expect(await sourceState(path)).toEqual(before);
  },
);

cliTest.runIf(SQLITE_NATIVE_LIMITS_AVAILABLE)(
  "attributes an unevaluable generated column to its selection, not the readable database path",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-sqlite-generated-");
    const path = join(root, "hashes.db");
    const producer = new DatabaseSync(path);
    try {
      // The producing application supplies a function REA's connection lacks.
      producer.function(
        "application_digest",
        { deterministic: true },
        (value) => (typeof value === "string" ? `digest:${value}` : null),
      );
      producer.exec(`
        CREATE TABLE t(a TEXT, b TEXT GENERATED ALWAYS AS (application_digest(a)) VIRTUAL);
        INSERT INTO t(a) VALUES ('hello'), ('world');
      `);
    } finally {
      producer.close();
    }
    const before = await readFile(path);
    const { call } = await connectLocalToolsMcp();
    const message = `SQLite cannot evaluate selected column(s) of table "t" on REA's read-only connection: "b": unknown function: application_digest()`;
    const expectedError = {
      code: "capability_unavailable",
      retryable: false,
      message,
      details: { provider_id: "sqlite", reason: message },
      remediation: {
        action: expect.stringContaining(
          'Select columns whose values were read: columns: ["a"] (CLI: one --column per name)',
        ),
      },
    };
    for (const columns of [["b", "a"], undefined]) {
      const result = await runFileCli(cli, {
        arguments: [
          "inspect-sqlite-database",
          path,
          "--table",
          "t",
          ...(columns ?? []).flatMap((column) => ["--column", column]),
          "--json",
        ],
        environment: { REA_LOG_LEVEL: "silent" },
      });
      expect(result.exitCode, result.stdout + result.stderr).toBe(1);
      expect(result.json).toMatchObject(expectedError);
      expect(result.stdout).not.toContain("invalid_format");
      const response = await call("inspect_sqlite_database", {
        path,
        table: "t",
        ...(columns === undefined ? {} : { columns }),
      });
      expect(parseMcpToolError(response).error).toMatchObject(expectedError);
    }
    const base = await runFileCli(cli, {
      arguments: [
        "inspect-sqlite-database",
        path,
        "--table",
        "t",
        "--column",
        "a",
        "--json",
      ],
      environment: { REA_LOG_LEVEL: "silent" },
    });
    expect(base.exitCode, base.stdout + base.stderr).toBe(0);
    expect(base.json).toMatchObject({
      normalized_result: { rows: { columns: ["a"], returned_rows: 2 } },
    });
    const schema = await call("inspect_sqlite_database", {
      path,
      schema_scope: "database",
    });
    expect(schema.isError).not.toBe(true);
    expect(schema.structuredContent).toMatchObject({
      normalized_result: {
        rows: null,
        schema: {
          tables: [
            {
              name: "t",
              sql: expect.stringContaining("application_digest(a)"),
              columns: [{ name: "a" }, { name: "b", hidden: 2 }],
            },
          ],
        },
      },
    });
    expect(Buffer.compare(await readFile(path), before)).toBe(0);
  },
);

cliTest.runIf(SQLITE_NATIVE_LIMITS_AVAILABLE)(
  "reads sqlite_schema rows through CLI and MCP in every schema scope",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-sqlite-schema-table-");
    const path = join(root, "selected.db");
    const writer = new DatabaseSync(path);
    try {
      writer.exec("CREATE TABLE records(id INTEGER)");
    } finally {
      writer.close();
    }
    const original = await readFile(path);
    const call = await parityMcp.session.call();
    for (const schema_scope of [
      "inventory",
      "selected_table",
      "database",
    ] as const) {
      const result = await runFileCli(cli, {
        arguments: [
          "inspect-sqlite-database",
          path,
          "--table",
          "sqlite_schema",
          "--column",
          "name",
          "--column",
          "type",
          "--schema-scope",
          schema_scope,
          "--json",
        ],
      });
      expect(result.exitCode, result.stdout + result.stderr).toBe(0);
      expect(result.json).toMatchObject({
        normalized_result: {
          schema: { scope: schema_scope },
          rows: {
            table: "sqlite_schema",
            columns: ["name", "type"],
            values: [
              [
                { type: "text", value: "records" },
                { type: "text", value: "table" },
              ],
            ],
          },
        },
      });
      const response = await call("inspect_sqlite_database", {
        path,
        table: "sqlite_schema",
        columns: ["name", "type"],
        schema_scope,
      });
      expect(response.isError, JSON.stringify(response)).not.toBe(true);
      expectCliMcpEvidenceParity(result.json, response.structuredContent, path);
    }
    expect(Buffer.compare(await readFile(path), original)).toBe(0);
  },
);

cliTest.runIf(SQLITE_NATIVE_LIMITS_AVAILABLE)(
  "returns complete UTF-16 schemas through the worker and public CLI when JSON fits",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-sqlite-large-catalog-");
    for (const [encoding, scope] of [
      ["UTF-16le", "inventory"],
      ["UTF-16be", "database"],
    ] as const) {
      const { path, names } = createSqliteLongNameFixture(root, encoding);
      const response = await runFileCli(cli, {
        arguments: [
          "inspect-sqlite-database",
          path,
          "--schema-scope",
          scope,
          "--json",
        ],
        environment: { REA_LOG_LEVEL: "silent" },
      });
      expect(response.exitCode, response.stderr).toBe(0);
      const evidence = parseEvidence(response.json);
      const report = sqliteDatabaseSchema.parse(evidence.normalized_result);
      expect(evidence.parameters.schema_scope).toBe(scope);
      expect(report.database_encoding).toBe(encoding);
      expect(report.schema).toMatchObject({ scope, completeness: "complete" });
      expect(report.schema.tables).toHaveLength(names.length);
      expect(report.schema.tables.map((table) => table.name)).toEqual(
        expect.arrayContaining(names),
      );
      expect(
        report.schema.tables.every(
          (table) =>
            table.columns_completeness ===
            (scope === "inventory" ? "not_requested" : "complete"),
        ),
      ).toBe(true);
      expect(report.rows).toBeNull();
    }
  },
);

cliTest.runIf(SQLITE_NATIVE_LIMITS_AVAILABLE)(
  "keeps selected table metadata tied to exact schema-name bytes through CLI and MCP",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-sqlite-invalid-name-");
    const path = join(root, "selected.db");
    const producer = new DatabaseSync(path);
    try {
      producer.exec(`
        CREATE TABLE "col"(id INTEGER PRIMARY KEY, value TEXT) WITHOUT ROWID, STRICT;
        INSERT INTO "col" VALUES(1, 'unrelated');
        CREATE TABLE "�ol"(value TEXT);
        INSERT INTO "�ol" VALUES('selected');
      `);
    } finally {
      producer.close();
    }
    const bytes = await readFile(path);
    let corruptedNameOccurrences = 0;
    for (let index = 0; index < bytes.length - 3; index += 1) {
      if (bytes.subarray(index, index + 3).equals(Buffer.from("col"))) {
        bytes[index] = 0xff;
        corruptedNameOccurrences += 1;
      }
    }
    expect(corruptedNameOccurrences).toBeGreaterThanOrEqual(2);
    await writeFile(path, bytes);

    const native = new DatabaseSync(path, {
      readOnly: true,
      readBigInts: true,
    });
    try {
      expect(native.prepare("PRAGMA integrity_check").get()).toEqual({
        integrity_check: "ok",
      });
      const nativeTables = native
        .prepare(
          "SELECT hex(CAST(name AS BLOB)) AS name_hex, ncol, wr, strict FROM temp.pragma_table_list WHERE schema = 'main'",
        )
        .all();
      expect(nativeTables).toEqual(
        expect.arrayContaining([
          {
            name_hex: "EFBFBD6F6C",
            ncol: 1n,
            wr: 0n,
            strict: 0n,
          },
          {
            name_hex: "FF6F6C",
            ncol: 2n,
            wr: 1n,
            strict: 1n,
          },
        ]),
      );
    } finally {
      native.close();
    }

    const cliResult = await runFileCli(cli, {
      arguments: [
        "inspect-sqlite-database",
        path,
        "--table",
        "�ol",
        "--row-limit",
        "1",
        "--json",
      ],
      environment: { REA_LOG_LEVEL: "silent" },
    });
    const { call } = await connectLocalToolsMcp();
    const mcpResult = await call("inspect_sqlite_database", {
      path,
      table: "�ol",
      row_limit: 1,
    });
    expect(cliResult.exitCode, cliResult.stdout + cliResult.stderr).toBe(0);
    expect(cliResult.json).toMatchObject({
      normalized_result: {
        schema: {
          tables: [
            expect.objectContaining({
              name: "�ol",
              without_rowid: false,
              strict: false,
              column_count: 1,
              columns_completeness: "complete",
            }),
          ],
        },
        rows: {
          table: "�ol",
          values: [[{ type: "text", value: "selected" }]],
        },
      },
    });
    expect(mcpResult.isError).not.toBe(true);
    expect(mcpResult.structuredContent).toMatchObject({
      normalized_result: {
        schema: {
          tables: [
            expect.objectContaining({
              name: "�ol",
              without_rowid: false,
              strict: false,
              column_count: 1,
              columns_completeness: "complete",
            }),
          ],
        },
        rows: {
          table: "�ol",
          values: [[{ type: "text", value: "selected" }]],
        },
      },
    });
  },
);

cliTest.runIf(SQLITE_NATIVE_LIMITS_AVAILABLE)(
  "folds ASCII trigger spelling without merging non-ASCII UTF-16 table names",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-sqlite-utf16-identity-");
    const call = await parityMcp.session.call();
    for (const encoding of ["UTF-16le", "UTF-16be"]) {
      const path = join(root, `${encoding}.db`);
      const producer = new DatabaseSync(path);
      try {
        producer.exec(`PRAGMA encoding = '${encoding}';
          CREATE TABLE "Ł_table"(id INTEGER);
          CREATE TABLE "š_table"(id INTEGER);
          CREATE TRIGGER first_trigger AFTER INSERT ON "Ł_TABLE" BEGIN SELECT 1; END;
          CREATE TRIGGER second_trigger AFTER INSERT ON "š_TABLE" BEGIN SELECT 1; END;`);
      } finally {
        producer.close();
      }
      const original = await readFile(path);
      const result = await runFileCli(cli, {
        arguments: ["inspect-sqlite-database", path, "--json"],
        environment: { REA_LOG_LEVEL: "silent" },
      });
      expect(result.exitCode, result.stderr).toBe(0);
      expect(result.json).toMatchObject({
        normalized_result: {
          schema: {
            triggers: [
              { name: "first_trigger", table: "Ł_table" },
              { name: "second_trigger", table: "š_table" },
            ],
          },
        },
      });
      const response = await call("inspect_sqlite_database", { path });
      expect(response.isError, JSON.stringify(response)).not.toBe(true);
      expectCliMcpEvidenceParity(result.json, response.structuredContent, path);
      expect(Buffer.compare(await readFile(path), original)).toBe(0);
    }
  },
);
