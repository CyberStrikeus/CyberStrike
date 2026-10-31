import { DatabaseSync } from "node:sqlite";
import { readFile, writeFile } from "node:fs/promises";
import { expect, it as nativeTest, onTestFinished } from "vitest";
import {
  createSqliteApplicationCollationFixture,
  createSqliteLongNameFixture,
  SQLITE_NATIVE_LIMITS_AVAILABLE,
} from "../../fixtures/sqlite/database.js";
import { inspectSqliteDatabaseSnapshot } from "../../../src/sqlite/SqliteDatabaseInspection.js";
import { SqliteInspectionFailure } from "../../../src/sqlite/SqliteDatabaseLimits.js";
import { jsonByteLength } from "../../../src/domain/jsonSerialization.js";
import {
  createTestWorkspace,
  removeTestWorkspace,
} from "../../support/workspace/workspaceFixture.js";

const it = nativeTest.runIf(SQLITE_NATIVE_LIMITS_AVAILABLE);

const createDatabase = async (sql: string): Promise<string> => {
  const workspace = await createTestWorkspace("rea-sqlite-expansion-");
  onTestFinished(() => removeTestWorkspace(workspace.root));
  const path = workspace.path("private.db");
  const producer = new DatabaseSync(path);
  try {
    producer.exec(sql);
  } finally {
    producer.close();
  }
  return path;
};

it("preserves negative-zero REAL values through JSON separately from positive and integer zero", async () => {
  const path = await createDatabase(`
    CREATE TABLE numbers(value);
    INSERT INTO numbers VALUES (-0.0), (0.0), (0), (5e-324), (-5e-324);
  `);
  const result = inspectSqliteDatabaseSnapshot(path, {
    path,
    table: "numbers",
  });
  expect(JSON.parse(JSON.stringify(result.rows))).toMatchObject({
    values: [
      [{ type: "real", value: "-0" }],
      [{ type: "real", value: 0 }],
      [{ type: "integer", value: "0" }],
      [{ type: "real", value: Number.MIN_VALUE }],
      [{ type: "real", value: -Number.MIN_VALUE }],
    ],
  });
});

it.each(["table", "view"] as const)(
  "inspects columns when a %s shadows the table-valued PRAGMA name",
  async (kind) => {
    const path = await createDatabase(`
      CREATE TABLE "selected "" table" ("0" TEXT, "" INTEGER);
      INSERT INTO "selected "" table" VALUES ('retained', 7);
      ${kind === "table" ? "CREATE TABLE pragma_table_xinfo(value TEXT)" : "CREATE VIEW pragma_table_xinfo AS SELECT 1"};
    `);
    const result = inspectSqliteDatabaseSnapshot(path, {
      path,
      table: 'selected " table',
    });
    expect(result.schema.tables).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'selected " table',
          columns: [
            expect.objectContaining({ name: "0", declared_type: "TEXT" }),
            expect.objectContaining({ name: "", declared_type: "INTEGER" }),
          ],
        }),
      ]),
    );
    expect(result.rows).toMatchObject({
      columns: ["0", ""],
      values: [
        [
          { type: "text", value: "retained" },
          { type: "integer", value: "7" },
        ],
      ],
    });
  },
);

it.each([6, 9])(
  "preserves a %i MiB schema statement without expanding its native record",
  async (mebibytes) => {
    const trigger = `CREATE TRIGGER large_definition AFTER INSERT ON records BEGIN /*${"x".repeat(mebibytes * 1024 * 1024)}*/ SELECT 1; END`;
    const path = await createDatabase(`
      CREATE TABLE records(value TEXT);
      ${trigger};
    `);
    const result = inspectSqliteDatabaseSnapshot(path, {
      path,
      schema_scope: "database",
    });
    expect(result.schema.triggers).toEqual([
      { name: "large_definition", table: "records", sql: trigger },
    ]);
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(
      16 * 1024 * 1024,
    );
  },
);

it("inspects a large schema identifier without expanding a native sort record", async () => {
  const name = "x".repeat(4 * 1024 * 1024);
  const sql = `CREATE TABLE "${name}" (value TEXT)`;
  const path = await createDatabase(sql);
  const result = inspectSqliteDatabaseSnapshot(path, {
    path,
    schema_scope: "database",
  });
  expect(result.schema.tables).toMatchObject([
    { name, sql, columns: [{ name: "value", declared_type: "TEXT" }] },
  ]);
  expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(
    16 * 1024 * 1024,
  );
});

it("accounts for JSON escape expansion of a stored declaration in the reply limit", async () => {
  const path = await createDatabase(`
    CREATE TABLE records(value TEXT);
    CREATE TRIGGER expanded AFTER INSERT ON records BEGIN /*${"\u0001".repeat(3 * 1024 * 1024)}*/ SELECT 1; END;
  `);
  expect(() =>
    inspectSqliteDatabaseSnapshot(path, { path, schema_scope: "database" }),
  ).toThrowError(expect.objectContaining({ reason: "output-limit" }));
  const inventory = inspectSqliteDatabaseSnapshot(path, { path });
  expect(inventory.schema.triggers).toEqual([
    { name: "expanded", table: "records" },
  ]);
});

it("attributes triggers declared with another ASCII case to the stored table name", async () => {
  const path = await createDatabase(`
    CREATE TABLE Users(id INTEGER PRIMARY KEY, email TEXT);
    CREATE INDEX users_email ON users(email);
    CREATE TRIGGER audit_insert AFTER INSERT ON users BEGIN SELECT 1; END;
    CREATE TRIGGER audit_delete AFTER DELETE ON USERS BEGIN SELECT 1; END;
    CREATE VIEW recent AS SELECT 1;
    CREATE TRIGGER recent_insert INSTEAD OF INSERT ON Recent BEGIN SELECT 1; END;
  `);
  const selected = inspectSqliteDatabaseSnapshot(path, {
    path,
    table: "Users",
  });
  expect(selected.schema).toMatchObject({
    scope: "selected_table",
    completeness: "complete",
    tables: [{ name: "Users" }],
    indexes: [{ name: "users_email", table: "Users" }],
    views: [],
  });
  expect(
    selected.schema.triggers.map(({ name, table }) => ({ name, table })),
  ).toEqual([
    { name: "audit_insert", table: "Users" },
    { name: "audit_delete", table: "Users" },
  ]);
  const inventory = inspectSqliteDatabaseSnapshot(path, { path });
  expect(inventory.schema.triggers).toEqual([
    { name: "audit_insert", table: "Users" },
    { name: "audit_delete", table: "Users" },
    { name: "recent_insert", table: "recent" },
  ]);
});

it.each([
  {
    selection: "a differently cased table",
    schema: "CREATE TABLE Users(id INTEGER PRIMARY KEY)",
    trigger: "AFTER INSERT ON Users",
    table: "users",
  },
  {
    selection: "an exact view",
    schema: "CREATE VIEW Recent AS SELECT 1 AS id",
    trigger: "INSTEAD OF INSERT ON recent",
    table: "Recent",
  },
])(
  "refuses $selection before expanding declarations under another spelling",
  async ({ schema, trigger, table }) => {
    const path = await createDatabase(`
      ${schema};
      CREATE TRIGGER expanded ${trigger} BEGIN /*${"\u0001".repeat(3 * 1024 * 1024)}*/ SELECT 1; END;
    `);
    expect(() =>
      inspectSqliteDatabaseSnapshot(path, { path, table }),
    ).toThrowError(
      expect.objectContaining({
        reason: "selection",
        message: `Selected ordinary table does not exist with that exact name: ${table}`,
      }),
    );
  },
);

it.each(["UTF-8", "UTF-16le", "UTF-16be"])(
  "preserves exact %s schema text when decoding native bytes",
  async (encoding) => {
    const sql = 'CREATE TABLE "\uFEFFé𝄞" ("列" TEXT DEFAULT \'\uFEFFvalue\')';
    const path = await createDatabase(`PRAGMA encoding='${encoding}'; ${sql}`);
    const result = inspectSqliteDatabaseSnapshot(path, {
      path,
      schema_scope: "database",
    });
    expect(result.schema.tables).toMatchObject([
      {
        name: "\uFEFFé𝄞",
        sql,
        columns: [{ name: "列", default_sql: "'\uFEFFvalue'" }],
      },
    ]);
  },
);

it("counts schema names once when enforcing the complete reply budget", async () => {
  const names = Array.from(
    { length: 48 },
    (_, index) => `${index}_${"x".repeat(128 * 1024)}`,
  );
  const path = await createDatabase(
    names.map((name) => `CREATE TABLE "${name}" (value TEXT);`).join("\n"),
  );
  const result = inspectSqliteDatabaseSnapshot(path, {
    path,
    schema_scope: "database",
  });
  expect(result.schema.tables).toHaveLength(names.length);
  expect(result.schema.tables.map((table) => table.name)).toEqual(
    expect.arrayContaining(names),
  );
  expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(
    16 * 1024 * 1024,
  );
});

it.each(["UTF-16le", "UTF-16be"] as const)(
  "budgets %s catalog names by returned JSON rather than internal hex identity",
  async (encoding) => {
    const workspace = await createTestWorkspace("rea-sqlite-catalog-names-");
    onTestFinished(() => removeTestWorkspace(workspace.root));
    const { path, names } = createSqliteLongNameFixture(
      workspace.root,
      encoding,
    );
    for (const schema_scope of ["inventory", "database"] as const) {
      const inspection = inspectSqliteDatabaseSnapshot(path, {
        path,
        schema_scope,
      });
      expect(inspection.database_encoding).toBe(encoding);
      expect(inspection.schema).toMatchObject({
        scope: schema_scope,
        completeness: "complete",
      });
      expect(inspection.schema.tables).toHaveLength(names.length);
      expect(inspection.schema.tables.map((table) => table.name)).toEqual(
        expect.arrayContaining(names),
      );
      for (const table of inspection.schema.tables) {
        expect(table.columns_completeness).toBe(
          schema_scope === "inventory" ? "not_requested" : "complete",
        );
        if (schema_scope === "database") {
          expect(table.sql).toBe(`CREATE TABLE "${table.name}"(value TEXT)`);
          expect(table.columns).toMatchObject([
            { name: "value", declared_type: "TEXT" },
          ]);
        } else {
          expect(table.sql).toBeUndefined();
          expect(table.columns).toEqual([]);
        }
      }
      expect(jsonByteLength({ ok: true, inspection })).toBeLessThan(
        16 * 1024 * 1024,
      );
    }
  },
);

it("keeps unrelated catalog names outside the selected-table reply budget", async () => {
  const path = await createDatabase(
    "CREATE TABLE selected(value TEXT); INSERT INTO selected VALUES ('retained');",
  );
  const producer = new DatabaseSync(path);
  try {
    producer.exec("BEGIN");
    for (let index = 0; index < 60; index++) {
      const name = `unrelated_${index}_${"x".repeat(300 * 1024)}`;
      producer.exec(`CREATE TABLE "${name}" (value TEXT)`);
    }
    producer.exec("COMMIT");
  } finally {
    producer.close();
  }
  const selected = inspectSqliteDatabaseSnapshot(path, {
    path,
    table: "selected",
  });
  expect(selected.schema).toMatchObject({
    scope: "selected_table",
    completeness: "complete",
    tables: [{ name: "selected" }],
    indexes: [],
    views: [],
    triggers: [],
  });
  expect(selected.schema.tables).toHaveLength(1);
  expect(selected.rows).toMatchObject({
    returned_rows: 1,
    values: [[{ type: "text", value: "retained" }]],
  });
  expect(() =>
    inspectSqliteDatabaseSnapshot(path, { path, table: "absent" }),
  ).toThrowError(
    expect.objectContaining({
      reason: "selection",
      message:
        "Selected ordinary table does not exist with that exact name: absent",
    }),
  );
  for (const schema_scope of ["inventory", "database"] as const)
    expect(() =>
      inspectSqliteDatabaseSnapshot(path, { path, schema_scope }),
    ).toThrowError(expect.objectContaining({ reason: "output-limit" }));
});

it.each(["inventory", "selected_table", "database"] as const)(
  "reads sqlite_schema rows using PRAGMA row-source facts in %s scope",
  async (schema_scope) => {
    const path = await createDatabase(
      "CREATE TABLE records(id INTEGER); INSERT INTO records VALUES (1);",
    );
    const result = inspectSqliteDatabaseSnapshot(path, {
      path,
      table: "sqlite_schema",
      columns: ["name", "type"],
      schema_scope,
    });

    expect(result.rows).toMatchObject({
      table: "sqlite_schema",
      columns: ["name", "type"],
      values: [
        [
          { type: "text", value: "records" },
          { type: "text", value: "table" },
        ],
      ],
    });
    expect(result.schema.tables).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "sqlite_schema" }),
      ]),
    );
  },
);

it("rejects malformed schema bytes instead of returning replacement text", async () => {
  const path = await createDatabase(
    "CREATE TABLE records(value TEXT /*schema-marker*/)",
  );
  const bytes = await readFile(path);
  const marker = bytes.indexOf(Buffer.from("schema-marker"));
  if (marker < 0) throw new Error("Schema marker missing");
  bytes[marker] = 0xff;
  await writeFile(path, bytes);
  expect(() =>
    inspectSqliteDatabaseSnapshot(path, { path, schema_scope: "database" }),
  ).toThrow(/schema sql contains malformed UTF-8 text/);
});

it("refuses possible shadow tables when their virtual module is unavailable", async () => {
  const path = await createDatabase(`
    CREATE VIRTUAL TABLE "SeArCh_É" USING fts5(body);
    INSERT INTO "SeArCh_É" VALUES ('retained');
    CREATE TABLE "search_É_manual" (value TEXT);
    CREATE TABLE "search_é_manual" (value TEXT);
    INSERT INTO "search_é_manual" VALUES ('distinct Unicode name');
    CREATE TABLE "SeArCh_Élite" (value TEXT);
  `);
  const bytes = await readFile(path);
  const declaration = bytes.indexOf(Buffer.from("USING fts5"));
  if (declaration < 0) throw new Error("Virtual declaration missing");
  bytes.write("zzzz", declaration + Buffer.byteLength("USING "), "utf8");
  await writeFile(path, bytes);

  for (const table of ["SeArCh_É_data", "search_É_manual"])
    expect(() => inspectSqliteDatabaseSnapshot(path, { path, table })).toThrow(
      /cannot determine.*shadow table/i,
    );
  const result = inspectSqliteDatabaseSnapshot(path, {
    path,
    table: "search_é_manual",
    schema_scope: "database",
  });
  expect(result.schema.tables).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ name: "SeArCh_É", kind: "virtual" }),
      expect.objectContaining({ name: "SeArCh_É_data", kind: "unknown" }),
      expect.objectContaining({ name: "search_É_manual", kind: "unknown" }),
      expect.objectContaining({ name: "search_é_manual", kind: "table" }),
      expect.objectContaining({ name: "SeArCh_Élite", kind: "table" }),
    ]),
  );
  expect(result.rows).toMatchObject({
    values: [[{ type: "text", value: "distinct Unicode name" }]],
  });
  expect(result.limitations.join("\n")).toMatch(/shadow table/i);
});

it("rejects an oversized generated cell through SQLite's native value limit", async () => {
  const path = await createDatabase(`
    CREATE TABLE records (
      id INTEGER,
      payload BLOB GENERATED ALWAYS AS (zeroblob(72 * 1024 * 1024)) VIRTUAL
    );
    INSERT INTO records(id) VALUES (1);
  `);
  try {
    inspectSqliteDatabaseSnapshot(path, {
      path,
      table: "records",
      row_limit: 1,
    });
    throw new Error("An oversized generated cell must not be projected");
  } catch (cause: unknown) {
    expect(cause).toMatchObject({
      code: "ERR_SQLITE_ERROR",
      errcode: 18,
    });
  }
});

it("reports additional rows without expanding an unselected generated cell", async () => {
  const path = await createDatabase(`
    CREATE TABLE records (
      id INTEGER,
      payload BLOB GENERATED ALWAYS AS (
        CASE WHEN id = 2 THEN zeroblob(72 * 1024 * 1024) ELSE X'01' END
      ) VIRTUAL
    );
    INSERT INTO records(id) VALUES (1), (2);
  `);
  const result = inspectSqliteDatabaseSnapshot(path, {
    path,
    table: "records",
    row_limit: 1,
  });
  expect(result.rows).toMatchObject({
    columns: ["id", "payload"],
    values: [
      [
        { type: "integer", value: "1" },
        { type: "blob", hex: "01" },
      ],
    ],
    returned_rows: 1,
    truncated: true,
  });
});

it("rejects the combined representation of individually small generated cells", async () => {
  const columns = Array.from(
    { length: 6 },
    (_, index) =>
      `payload_${String(index)} BLOB GENERATED ALWAYS AS (zeroblob(2 * 1024 * 1024)) VIRTUAL`,
  );
  const path = await createDatabase(`
    CREATE TABLE records (id INTEGER, ${columns.join(", ")});
    INSERT INTO records(id) VALUES (1);
  `);
  try {
    inspectSqliteDatabaseSnapshot(path, {
      path,
      table: "records",
      row_limit: 1,
    });
    throw new Error(
      "Aggregate row expansion must be rejected before projection",
    );
  } catch (cause: unknown) {
    expect(cause).toBeInstanceOf(SqliteInspectionFailure);
    expect(cause).toMatchObject({ reason: "output-limit" });
  }
});

it("attributes compile and row evaluation errors to each failing generated column", async () => {
  const workspace = await createTestWorkspace("rea-sqlite-evaluation-");
  onTestFinished(() => removeTestWorkspace(workspace.root));
  const path = workspace.path("private.db");
  // Writable schema plants an expression that fails only for the second
  // stored row; virtual cells are not stored, so record layout is unchanged.
  const producer = new DatabaseSync(path, { defensive: false });
  try {
    producer.function("application_digest", { deterministic: true }, (value) =>
      String(value),
    );
    producer.exec(`
      CREATE TABLE t(
        id INTEGER,
        payload TEXT,
        digest TEXT GENERATED ALWAYS AS (application_digest(payload)) VIRTUAL,
        stored_digest TEXT GENERATED ALWAYS AS (application_digest(payload)) STORED,
        field GENERATED ALWAYS AS (payload) VIRTUAL,
        upper_payload GENERATED ALWAYS AS (upper(payload)) VIRTUAL
      );
      INSERT INTO t(id, payload) VALUES (1, '{"k":1}'), (2, 'not json');
      PRAGMA writable_schema = ON;
      UPDATE sqlite_schema
        SET sql = replace(sql, 'field GENERATED ALWAYS AS (payload)', 'field GENERATED ALWAYS AS (json_extract(payload, ''$.k''))')
        WHERE name = 't';
      PRAGMA writable_schema = OFF;
    `);
  } finally {
    producer.close();
  }
  const failure = (input: { columns?: string[]; row_limit?: number }) => {
    try {
      inspectSqliteDatabaseSnapshot(path, { path, table: "t", ...input });
    } catch (cause: unknown) {
      return cause;
    }
    throw new Error("Expected a generated-column evaluation failure");
  };
  const prefix = `SQLite cannot evaluate selected column(s) of table "t" on REA's read-only connection: `;
  expect(failure({})).toMatchObject({
    reason: "column-evaluation",
    message: `${prefix}"digest": unknown function: application_digest(); "field": malformed JSON`,
    readableColumns: ["id", "payload", "stored_digest", "upper_payload"],
  });
  expect(failure({ columns: ["field", "id", "field"] })).toMatchObject({
    message: `${prefix}"field": malformed JSON`,
    readableColumns: ["id"],
  });
  // With no readable selection left, stored columns remain available without evaluation.
  expect(failure({ columns: ["digest"] })).toMatchObject({
    message: `${prefix}"digest": unknown function: application_digest()`,
    readableColumns: ["id", "payload", "stored_digest"],
  });
  // Only sampled rows are evaluated, and stored or built-in generated cells are read.
  expect(
    inspectSqliteDatabaseSnapshot(path, {
      path,
      table: "t",
      columns: ["field", "stored_digest", "upper_payload"],
      row_limit: 1,
    }).rows,
  ).toMatchObject({
    values: [
      [
        { type: "integer", value: "1" },
        { type: "text", value: '{"k":1}' },
        { type: "text", value: '{"K":1}' },
      ],
    ],
    truncated: true,
  });
});

const createApplicationDatabase = async (
  sql: string,
  edit?: (bytes: Buffer) => void,
): Promise<string> => {
  const workspace = await createTestWorkspace("rea-sqlite-evaluation-");
  onTestFinished(() => removeTestWorkspace(workspace.root));
  const path = workspace.path("private.db");
  const producer = new DatabaseSync(path);
  try {
    // The producing application supplies a function REA's connection lacks.
    producer.function("application_digest", { deterministic: true }, (value) =>
      String(value),
    );
    producer.exec(sql);
  } finally {
    producer.close();
  }
  if (edit !== undefined) {
    const bytes = await readFile(path);
    edit(bytes);
    await writeFile(path, bytes);
  }
  return path;
};

it("never recommends a selected column whose own probe fails for another reason", async () => {
  const path = await createApplicationDatabase(`
    CREATE TABLE t(
      id INTEGER,
      digest TEXT GENERATED ALWAYS AS (application_digest(id)) VIRTUAL,
      payload BLOB GENERATED ALWAYS AS (zeroblob(72 * 1024 * 1024)) VIRTUAL
    );
    INSERT INTO t(id) VALUES (1);
  `);
  expect(() =>
    inspectSqliteDatabaseSnapshot(path, {
      path,
      table: "t",
      columns: ["payload", "digest", "id"],
    }),
  ).toThrow(
    expect.objectContaining({
      reason: "column-evaluation",
      message: `SQLite cannot evaluate selected column(s) of table "t" on REA's read-only connection: "payload": string or blob too big; "digest": unknown function: application_digest()`,
      readableColumns: ["id"],
    }),
  );
});

it("recommends stored columns outside an inventory-scope selection without decoding malformed names", async () => {
  const path = await createApplicationDatabase(
    `
    CREATE TABLE t(
      id INTEGER,
      "col" TEXT,
      payload TEXT,
      digest TEXT GENERATED ALWAYS AS (application_digest(payload)) VIRTUAL
    );
    INSERT INTO t(id, "col", payload) VALUES (1, 'kept', 'value');
  `,
    (bytes) => {
      const marker = Buffer.from('"col"');
      const offset = bytes.indexOf(marker);
      if (offset < 0 || bytes.indexOf(marker, offset + 1) !== -1)
        throw new Error("Expected unique authored column marker");
      bytes[offset + 1] = 0xff;
    },
  );
  expect(() =>
    inspectSqliteDatabaseSnapshot(path, {
      path,
      table: "t",
      schema_scope: "inventory",
      columns: ["digest"],
    }),
  ).toThrow(
    expect.objectContaining({
      reason: "column-evaluation",
      message: `SQLite cannot evaluate selected column(s) of table "t" on REA's read-only connection: "digest": unknown function: application_digest()`,
      readableColumns: ["id", "payload"],
    }),
  );
  // The recommended stored columns are themselves selectable in the same scope.
  expect(
    inspectSqliteDatabaseSnapshot(path, {
      path,
      table: "t",
      schema_scope: "inventory",
      columns: ["id", "payload"],
    }).rows,
  ).toMatchObject({
    values: [
      [
        { type: "integer", value: "1" },
        { type: "text", value: "value" },
      ],
    ],
  });
});

it("samples above 1000 rows and safe integer limits within the byte budget", async () => {
  const path = await createDatabase(`CREATE TABLE items(value INTEGER);
    WITH RECURSIVE numbers(value) AS (SELECT 1 UNION ALL SELECT value + 1 FROM numbers WHERE value < 1002)
    INSERT INTO items SELECT value FROM numbers;`);
  for (const row_limit of [1001, Number.MAX_SAFE_INTEGER]) {
    const result = inspectSqliteDatabaseSnapshot(path, {
      path,
      table: "items",
      row_limit,
    });
    expect(result.rows).toMatchObject({
      row_limit,
      returned_rows: Math.min(row_limit, 1002),
      truncated: row_limit < 1002,
    });
  }
});

nativeTest.skipIf(SQLITE_NATIVE_LIMITS_AVAILABLE)(
  "rejects a runtime without native limits before querying the snapshot",
  async () => {
    const path = await createDatabase("CREATE TABLE items(value INTEGER)");
    expect(() =>
      inspectSqliteDatabaseSnapshot(path, { path, schema_scope: "database" }),
    ).toThrow("DatabaseSync.limits");
  },
);

it("classifies SQLite's result-column capacity refusal without blaming the database", async () => {
  const path = await createDatabase(
    "CREATE TABLE records(email TEXT); INSERT INTO records VALUES ('sample');",
  );
  const reader = new DatabaseSync(path, { readOnly: true });
  const engineColumnLimit = (() => {
    try {
      return reader.limits.column;
    } finally {
      reader.close();
    }
  })();
  const columns = (count: number): string[] =>
    Array.from({ length: count }, () => "email");
  const atLimit = inspectSqliteDatabaseSnapshot(path, {
    path,
    table: "records",
    columns: columns(engineColumnLimit),
  });
  expect(atLimit.rows).toMatchObject({
    columns: columns(engineColumnLimit),
    returned_rows: 1,
  });
  expect(() =>
    inspectSqliteDatabaseSnapshot(path, {
      path,
      table: "records",
      columns: columns(engineColumnLimit + 1),
    }),
  ).toThrow(
    expect.objectContaining({
      reason: "column-limit",
      selectedColumns: engineColumnLimit + 1,
      engineColumnLimit,
      message: expect.stringContaining("too many columns in result set"),
    }),
  );
});

it.each(["inventory", "selected_table", "database"] as const)(
  "keeps unavailable row sources separate from generated expressions in %s scope",
  async (schema_scope) => {
    const workspace = await createTestWorkspace("rea-sqlite-collation-");
    onTestFinished(() => removeTestWorkspace(workspace.root));
    const path = createSqliteApplicationCollationFixture(workspace.root);
    const before = await readFile(path);
    const schema = inspectSqliteDatabaseSnapshot(path, {
      path,
      schema_scope: "database",
    });
    expect(schema.rows).toBeNull();
    expect(schema.schema.tables[0]).toMatchObject({
      name: "items",
      without_rowid: true,
      sql: expect.stringContaining("COLLATE APPLICATION_COLLATION"),
      columns: [
        expect.objectContaining({ name: "name", hidden: 0 }),
        expect.objectContaining({ name: "value", hidden: 0 }),
        expect.objectContaining({ name: "generated_value", hidden: 2 }),
      ],
    });
    for (const columns of [undefined, ["value"], ["generated_value"]])
      expect(() =>
        inspectSqliteDatabaseSnapshot(path, {
          path,
          table: "items",
          schema_scope,
          ...(columns === undefined ? {} : { columns }),
        }),
      ).toThrow(
        expect.objectContaining({
          reason: "row-evaluation",
          message: expect.stringMatching(
            /rows of table "items".*(?:no query solution|no such collation sequence)/,
          ),
        }),
      );
    expect(Buffer.compare(await readFile(path), before)).toBe(0);
  },
);
