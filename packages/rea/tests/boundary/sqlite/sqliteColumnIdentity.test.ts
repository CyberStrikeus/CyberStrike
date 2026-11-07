import { DatabaseSync } from "node:sqlite";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { inspectSqliteDatabaseSnapshot } from "../../../src/sqlite/SqliteDatabaseInspection.js";
import { SQLITE_NATIVE_LIMITS_AVAILABLE } from "../../fixtures/sqlite/database.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

const sample = async (encoding: string, malformed = false) => {
  const root = await createTestTempDirectory("rea-sqlite-column-identity-");
  const path = join(root, "Columns.sqlite");
  const db = new DatabaseSync(path);
  try {
    db.exec(`PRAGMA encoding='${encoding}';
      CREATE TABLE t("col" TEXT, "�ol" TEXT);
      INSERT INTO t VALUES ('first-column','replacement-column');
      CREATE TABLE json_each(value TEXT);`);
  } finally {
    db.close();
  }
  if (malformed) {
    const bytes = await readFile(path);
    const marker = Buffer.from('"col"');
    const offset = bytes.indexOf(marker);
    if (offset < 0 || bytes.indexOf(marker, offset + 1) !== -1)
      throw new Error("Expected unique authored column marker");
    bytes[offset + 1] = 0xff;
    await writeFile(path, bytes);
  }
  return path;
};

it
  .runIf(SQLITE_NATIVE_LIMITS_AVAILABLE)
  .each(["UTF-8", "UTF-16le", "UTF-16be"])(
  "preserves exact column selection in %s with literal U+FFFD",
  async (encoding) => {
    const path = await sample(encoding);
    const result = inspectSqliteDatabaseSnapshot(path, {
      path,
      table: "t",
      schema_scope: "inventory",
      columns: ["�ol", "col", "�ol"],
    });
    expect(result.schema.tables[0]).toMatchObject({
      columns: [],
      columns_completeness: "not_requested",
    });
    expect(result.rows?.columns).toEqual(["�ol", "col", "�ol"]);
    expect(
      result.rows?.values[0]?.map((cell) =>
        cell.type === "text" ? cell.value : null,
      ),
    ).toEqual(["replacement-column", "first-column", "replacement-column"]);
  },
);

it.runIf(SQLITE_NATIVE_LIMITS_AVAILABLE)(
  "refuses automatic sampling before malformed column bytes can alias a valid name",
  async () => {
    const path = await sample("UTF-8", true);
    expect(() =>
      inspectSqliteDatabaseSnapshot(path, {
        path,
        table: "t",
        schema_scope: "inventory",
      }),
    ).toThrow(
      expect.objectContaining({
        reason: "format",
        message: expect.stringContaining(
          "column name contains malformed UTF-8",
        ),
      }),
    );
  },
);

it.runIf(SQLITE_NATIVE_LIMITS_AVAILABLE)(
  "selects the exact valid subset without decoding an unrelated malformed column",
  async () => {
    const path = await sample("UTF-8", true);
    const result = inspectSqliteDatabaseSnapshot(path, {
      path,
      table: "t",
      schema_scope: "inventory",
      columns: ["�ol"],
    });
    expect(result.rows?.columns).toEqual(["�ol"]);
    expect(result.rows?.values[0]?.[0]).toMatchObject({
      type: "text",
      value: "replacement-column",
    });
    expect(result.schema.tables[0]).toMatchObject({
      columns: [],
      columns_completeness: "not_requested",
    });
    expect(() =>
      inspectSqliteDatabaseSnapshot(path, {
        path,
        table: "t",
        schema_scope: "inventory",
        columns: ["col"],
      }),
    ).toThrow(expect.objectContaining({ reason: "column-selection" }));
    expect(() =>
      inspectSqliteDatabaseSnapshot(path, {
        path,
        table: "t",
        schema_scope: "selected_table",
        columns: ["�ol"],
      }),
    ).toThrow(expect.objectContaining({ reason: "format" }));
  },
);
