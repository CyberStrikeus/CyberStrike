import { expect, it } from "vitest";
import { SqliteDatabaseService } from "./SqliteDatabaseService.js";
import { AnalysisCapabilityUnavailableError } from "../../domain/analysisErrorCore.js";
import { err, ok } from "../../domain/result.js";
import { createAnalysisExecution } from "../AnalysisProvider.js";
import { sqliteDatabaseSchema } from "../../domain/sqlite/sqliteDatabase.js";

const fixture = () => ({
  artifact: { path: "/selected.db", sha256: "a".repeat(64), bytes: 4096 },
  wal: null,
  engine: { name: "SQLite", version: "3.50.2" },
  worker_timeout_ms: 30_000,
  database_encoding: "UTF-8",
  schema: {
    scope: "inventory",
    completeness: "complete",
    tables: [],
    indexes: [],
    views: [],
    triggers: [],
  },
  rows: null,
  limitations: [],
});

const execution = (value: unknown) =>
  createAnalysisExecution(
    value,
    { id: "sqlite", name: "SQLite", version: "3.50.2" },
    {
      subject: { path: "/selected.db", sha256: "a".repeat(64), format: "file" },
      locations: [{ kind: "artifact-path", path: "/selected.db" }],
    },
  );

it.each([
  { path: "relative.db" },
  { path: "/selected.db", approval: true },
  { path: "/selected.db", row_limit: 1 },
  { path: "/selected.db", table: 1 },
  { path: "/selected.db", table: "data", row_limit: 0 },
  {
    path: "/selected.db",
    table: "data",
    row_limit: Number.MAX_SAFE_INTEGER + 1,
  },
  ...[0, -1, 1.5, 2_147_483_648, "1000", null].map((worker_timeout_ms) => ({
    path: "/selected.db",
    worker_timeout_ms,
  })),
])(
  "rejects invalid SQLite selection before provider effects: %j",
  async (input) => {
    const service = new SqliteDatabaseService({
      inspect: () => {
        throw new Error("Invalid selection must not read a database");
      },
    });
    expect(await service.inspect(input)).toMatchObject({
      ok: false,
      error: { _tag: "AnalysisInputError" },
    });
  },
);

it.each([
  { selected: undefined, reported: undefined },
  { selected: undefined, reported: 1234 },
  { selected: 1234, reported: undefined },
  { selected: 1234, reported: 30_000 },
])(
  "rejects a missing or changed fresh producer budget: %j",
  async ({ selected, reported }) => {
    const { worker_timeout_ms: _default, ...report } = fixture();
    const service = new SqliteDatabaseService({
      inspect: async () =>
        ok(
          execution({
            ...report,
            ...(reported === undefined ? {} : { worker_timeout_ms: reported }),
          }),
        ),
    });
    expect(
      await service.inspect({
        path: "/selected.db",
        ...(selected === undefined ? {} : { worker_timeout_ms: selected }),
      }),
    ).toMatchObject({ ok: false, error: { _tag: "AnalysisOutputError" } });
  },
);

it("accepts sqlite_schema rows without requiring a fabricated declaration", async () => {
  const report = {
    ...fixture(),
    schema: {
      ...fixture().schema,
      scope: "selected_table",
      tables: [],
    },
    rows: {
      table: "sqlite_schema",
      columns: ["name", "type"],
      values: [
        [
          {
            type: "text",
            value: "records",
            bytes_hex: "7265636f726473",
            encoding: "UTF-8",
          },
          {
            type: "text",
            value: "table",
            bytes_hex: "7461626c65",
            encoding: "UTF-8",
          },
        ],
      ],
      row_limit: 20,
      returned_rows: 1,
      truncated: false,
      order: "unspecified",
    },
  };
  const service = new SqliteDatabaseService({
    inspect: async () => ok(execution(report)),
  });
  const result = await service.inspect({
    path: "/selected.db",
    table: "sqlite_schema",
    columns: ["name", "type"],
    schema_scope: "selected_table",
  });
  expect(result.ok).toBe(true);

  const foreign = {
    ...report,
    schema: {
      ...report.schema,
      tables: [
        {
          name: "records",
          root_page: 2,
          kind: "table",
          without_rowid: false,
          strict: false,
          column_count: 0,
          columns_completeness: "complete",
          columns: [],
        },
      ],
    },
  };
  const foreignService = new SqliteDatabaseService({
    inspect: async () => ok(execution(foreign)),
  });
  expect(
    await foreignService.inspect({
      path: "/selected.db",
      table: "sqlite_schema",
      columns: ["name", "type"],
      schema_scope: "selected_table",
    }),
  ).toMatchObject({ ok: false, error: { _tag: "AnalysisOutputError" } });

  expect(
    await service.inspect({
      path: "/selected.db",
      table: "missing",
      columns: ["name", "type"],
      schema_scope: "selected_table",
    }),
  ).toMatchObject({ ok: false, error: { _tag: "AnalysisOutputError" } });
});

it("parses historical report omissions as unknown without supplying a default", () => {
  const { worker_timeout_ms: _default, ...historical } = fixture();
  const parsed = sqliteDatabaseSchema.parse(historical);
  expect(parsed).not.toHaveProperty("worker_timeout_ms");
});

it("preserves producer failures and rejects pre-cancelled requests before effects", async () => {
  const failure = new AnalysisCapabilityUnavailableError(
    "rea-sqlite",
    "inspect_sqlite_database",
    "Selected worker could not start",
  );
  const service = new SqliteDatabaseService({
    inspect: () => Promise.resolve(err(failure)),
  });
  expect(await service.inspect({ path: "/selected.db" })).toEqual(err(failure));
  const signal = AbortSignal.abort();
  const untouched = new SqliteDatabaseService({
    inspect: () => {
      throw new Error("Cancelled selection must not read a database");
    },
  });
  expect(
    await untouched.inspect({ path: "/selected.db" }, { signal }),
  ).toMatchObject({
    ok: false,
    error: { _tag: "AnalysisCancelledError" },
  });
});

it.each(["path", "digest", "subject", "wal", "table"])(
  "rejects producer results with changed caller binding: %s",
  async (problem) => {
    const value = fixture();
    if (problem === "path") value.artifact.path = "/other.db";
    if (problem === "digest") value.artifact.sha256 = "b".repeat(64);
    const observed = execution({
      ...value,
      ...(problem === "wal"
        ? { wal: { path: "/other.db-wal", sha256: "b".repeat(64), bytes: 32 } }
        : {}),
    });
    const service = new SqliteDatabaseService({
      inspect: () =>
        Promise.resolve(
          ok({
            ...observed,
            ...(problem === "subject" ? { subject: null } : {}),
          }),
        ),
    });
    expect(
      await service.inspect({
        path: "/selected.db",
        ...(problem === "table" ? { table: "selected" } : {}),
      }),
    ).toMatchObject({ ok: false, error: { _tag: "AnalysisOutputError" } });
  },
);

it("preserves completed observed evidence when cancellation arrives after provider completion", async () => {
  const value = fixture();
  const service = new SqliteDatabaseService({
    inspect: () => Promise.resolve(ok(execution(value))),
  });
  expect(await service.inspect({ path: "/selected.db" })).toMatchObject({
    ok: true,
    value: {
      confidence: "observed",
      subject: {
        local_path: "/selected.db",
        digest: { sha256: "a".repeat(64) },
      },
      normalized_result: value,
    },
  });
  const controller = new AbortController();
  const cancelled = new SqliteDatabaseService({
    inspect: () => {
      controller.abort();
      return Promise.resolve(ok(execution(value)));
    },
  });
  expect(
    await cancelled.inspect(
      { path: "/selected.db" },
      { signal: controller.signal },
    ),
  ).toMatchObject({
    ok: true,
    value: { normalized_result: value },
  });
});

it("preserves the exact caller reason when inspection is already aborted", async () => {
  const reason = Object.freeze({ requested: "stop" });
  const controller = new AbortController();
  controller.abort(reason);
  let calls = 0;
  const service = new SqliteDatabaseService({
    inspect: () => {
      calls += 1;
      return Promise.reject(new Error("provider must not run"));
    },
  });
  const result = await service.inspect(
    { path: "/selected.db" },
    { signal: controller.signal },
  );
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error._tag).toBe("AnalysisCancelledError");
  expect(result.error.cause).toBe(reason);
  expect(calls).toBe(0);
});
