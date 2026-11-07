import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { access, lstat, readFile, symlink, writeFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { expect, it as nativeTest, onTestFinished, vi } from "vitest";
import { ZodError } from "zod";
import { projectAnalysisError } from "../../../src/domain/analysisErrorProjection.js";
import { ProviderCleanupError } from "../../../src/domain/providerCleanupError.js";
import { SQLITE_DATABASE_LIMITS } from "../../../src/sqlite/SqliteDatabaseLimits.js";
import { SqliteDatabaseProvider } from "../../../src/sqlite/SqliteDatabaseProvider.js";
import { inspectSqliteDatabaseSnapshot } from "../../../src/sqlite/SqliteDatabaseInspection.js";
import { cleanupOwnedProcessGroup } from "../../../src/process/ProcessOwnership.js";
import { spawnOwnedProviderProcess } from "../../../src/process/ProviderProcess.js";
import { PrivateRuntimeRoot } from "../../../src/process/PrivateRuntimeRoot.js";
import { waitForProviderProcessReady } from "../../fixtures/providerProcess.js";
import {
  createSqliteDatabaseFixture,
  createSqliteApplicationCollationFixture,
  SQLITE_NATIVE_LIMITS_AVAILABLE,
} from "../../fixtures/sqlite/database.js";
import {
  createTestWorkspace,
  removeTestWorkspace,
} from "../../support/workspace/workspaceFixture.js";

const it = nativeTest.runIf(SQLITE_NATIVE_LIMITS_AVAILABLE);

const workerUrl = new URL(
  "../../../dist/sqlite/SqliteDatabaseWorker.js",
  import.meta.url,
);
const createProvider = () =>
  new SqliteDatabaseProvider(process.env, (spawn) =>
    spawnOwnedProviderProcess({
      ...spawn,
      arguments: spawn.arguments.map((argument, index) =>
        index === 1 ? fileURLToPath(workerUrl) : argument,
      ),
    }),
  );

const createFixture = async (wal = false) => {
  const workspace = await createTestWorkspace("rea-sqlite-boundary-");
  const database = createSqliteDatabaseFixture(workspace.root, wal);
  if (!wal) database.close();
  onTestFinished(async () => {
    if (wal) database.close();
    await removeTestWorkspace(workspace.root);
  });
  return { workspace, database };
};

const expectPrivateRootRemoved = (path: string) =>
  expect(access(path)).rejects.toMatchObject({ code: "ENOENT" });

nativeTest.each([
  { input: { path: "relative.db" }, field: "path" },
  {
    input: { path: "/selected.db", table: "records", row_limit: 0 },
    field: "row_limit",
  },
  { input: { path: "/selected.db", columns: ["id"] }, field: "columns" },
])(
  "attributes invalid provider input to its argument before allocating resources: %j",
  async ({ input, field }) => {
    const createRuntime = vi.fn(async () => {
      throw new Error("Invalid input must not allocate a SQLite runtime");
    });
    const provider = new SqliteDatabaseProvider({}, undefined, createRuntime);
    onTestFinished(() => provider.close());
    const result = await provider.inspect({ ...input });
    if (result.ok) throw new Error("Expected an input rejection");
    expect(result.error.cause).toBeInstanceOf(ZodError);
    expect(projectAnalysisError(result.error)).toMatchObject({
      code: "invalid_request",
      details: { issues: [{ path: [field] }] },
    });
    expect(createRuntime).not.toHaveBeenCalled();
  },
);

it("enforces a selected worker budget and completes the corrected same-database retry", async () => {
  const { database } = await createFixture();
  const original = await readFile(database.path);
  let first = true;
  let root = "";
  const provider = new SqliteDatabaseProvider(process.env, (spawn) => {
    root = spawn.cwd ?? "";
    if (first) {
      first = false;
      return spawnOwnedProviderProcess({
        ...spawn,
        arguments: [
          spawn.arguments[0] ?? "--max-old-space-size=256",
          "-e",
          `process.argv[2]=process.argv[1];setTimeout(()=>import(${JSON.stringify(workerUrl.href)}),250)`,
          spawn.arguments[2] ?? "",
        ],
      });
    }
    return spawnOwnedProviderProcess({
      ...spawn,
      arguments: spawn.arguments.map((arg, index) =>
        index === 1 ? fileURLToPath(workerUrl) : arg,
      ),
    });
  });
  onTestFinished(() => provider.close());
  const failed = await provider.inspect({
    path: database.path,
    worker_timeout_ms: 50,
  });
  if (failed.ok) throw new Error("Worker deadline was ignored");
  expect(projectAnalysisError(failed.error)).toMatchObject({
    code: "provider_timeout",
    details: { timeout_ms: 50 },
  });
  expect(failed.error.cleanupIncomplete).toBe(false);
  await expectPrivateRootRemoved(root);
  const corrected = await provider.inspect({
    path: database.path,
    worker_timeout_ms: 2000,
  });
  if (!corrected.ok) throw corrected.error;
  expect(corrected.value.result).toMatchObject({
    worker_timeout_ms: 2000,
    schema: { completeness: "complete" },
  });
  await expectPrivateRootRemoved(root);
  expect(Buffer.compare(await readFile(database.path), original)).toBe(0);
});

nativeTest(
  "retains a timed-out worker's budget and one output copy through owned cleanup retry",
  async () => {
    const { database } = await createFixture();
    const original = await readFile(database.path);
    let cleanupAllowed = false;
    let launches = 0;
    let root = "";
    const provider = new SqliteDatabaseProvider(process.env, async (spawn) => {
      launches += 1;
      root = spawn.cwd ?? "";
      const launched = await spawnOwnedProviderProcess({
        ...spawn,
        arguments: [
          "-e",
          "process.stdout.write('ready\\n');setTimeout(()=>process.stdout.write('sqlite-timeout-marker'),100);setInterval(()=>{},1000)",
        ],
      });
      return {
        ...launched,
        cleanup: async () =>
          cleanupAllowed
            ? await (launched.cleanup?.() ??
                cleanupOwnedProcessGroup(launched.ownership))
            : { cleaned: false, reason: "owned timeout cleanup denied" },
      };
    });
    onTestFinished(async () => {
      cleanupAllowed = true;
      await provider.close();
    });
    const result = await provider.inspect({
      path: database.path,
      worker_timeout_ms: 3000,
    });
    if (result.ok) throw new Error("Expected timeout with unresolved cleanup");
    const projected = projectAnalysisError(result.error);
    expect(projected).toMatchObject({
      code: "cleanup_incomplete",
      retryable: false,
      details: {
        resources: expect.arrayContaining([root]),
        diagnostics: {
          previous_error: {
            code: "provider_timeout",
            details: { timeout_ms: 3000 },
            remediation: {
              action: expect.stringContaining("worker_timeout_ms"),
            },
          },
        },
      },
    });
    expect(
      JSON.stringify(projected).split("sqlite-timeout-marker"),
    ).toHaveLength(2);
    await expect(access(root)).resolves.toBeUndefined();
    expect(await provider.inspect({ path: database.path })).toMatchObject({
      ok: false,
      error: { cleanupIncomplete: true },
    });
    expect(launches).toBe(1);
    cleanupAllowed = true;
    await provider.close();
    const resolved = projectAnalysisError(result.error);
    expect(resolved).toMatchObject({
      code: "provider_timeout",
      details: { timeout_ms: 3000 },
    });
    expect(
      JSON.stringify(resolved).split("sqlite-timeout-marker"),
    ).toHaveLength(2);
    expect(result.error.cleanupResources).toEqual([]);
    await expectPrivateRootRemoved(root);
    expect(Buffer.compare(await readFile(database.path), original)).toBe(0);
  },
);

it.each(["completed reply", "malformed reply"] as const)(
  "preserves the primary result for a %s while retaining unconfirmed cleanup ownership",
  async (replyKind) => {
    const { workspace, database } = await createFixture();
    let cleanupAttempts = 0;
    let cleanupAllowed = false;
    let ownedRoot = "";
    const provider = new SqliteDatabaseProvider(process.env, async (spawn) => {
      ownedRoot = spawn.cwd ?? "";
      const requestPath = spawn.arguments[2];
      if (requestPath === undefined)
        throw new Error("SQLite request path missing");
      const request = JSON.parse(await readFile(requestPath, "utf8")) as {
        snapshot_path: string;
        reply_path: string;
        input: Parameters<typeof inspectSqliteDatabaseSnapshot>[1];
      };
      const inspection =
        replyKind === "completed reply"
          ? inspectSqliteDatabaseSnapshot(request.snapshot_path, request.input)
          : undefined;
      await writeFile(
        request.reply_path,
        inspection === undefined
          ? "{ malformed reply"
          : JSON.stringify({ ok: true, inspection }),
        { flag: "wx", mode: 0o600 },
      );
      const launched = await spawnOwnedProviderProcess({
        ...spawn,
        arguments: ["-e", "process.exit(0)"],
      });
      return {
        ...launched,
        cleanup: async () => {
          cleanupAttempts += 1;
          return cleanupAllowed
            ? { cleaned: true, signaled: false }
            : { cleaned: false, reason: "fixture cleanup denial" };
        },
      };
    });
    onTestFinished(async () => {
      cleanupAllowed = true;
      await provider.close();
      await removeTestWorkspace(workspace.root);
    });

    const result = await provider.inspect({
      path: database.path,
      table: "records",
      columns: ["id"],
      row_limit: 1,
    });
    expect(result).toMatchObject({
      ok: false,
      error: {
        cleanupIncomplete: true,
        cleanupResources: expect.arrayContaining([ownedRoot]),
        diagnostics: {
          reason: "fixture cleanup denial",
          previous_error:
            replyKind === "malformed reply" ? expect.any(Object) : null,
        },
        ...(replyKind === "completed reply"
          ? {
              partialObservation: {
                operation: "inspect_sqlite_database",
                confidence: "observed",
                normalized_result: {
                  schema: { tables: expect.any(Array) },
                  rows: { returned_rows: 1 },
                },
              },
            }
          : { partialObservation: undefined }),
      },
    });
    expect(cleanupAttempts).toBe(1);
    await expect(access(`${ownedRoot}/reply.json`)).resolves.toBeUndefined();
    let closeFailure: unknown;
    try {
      await provider.close();
    } catch (cause) {
      closeFailure = cause;
    }
    expect(closeFailure).toMatchObject({
      cleanupIncomplete: true,
      cleanupResources: expect.arrayContaining([ownedRoot]),
      ...(replyKind === "completed reply"
        ? {
            partialObservation: {
              operation: "inspect_sqlite_database",
              confidence: "observed",
              normalized_result: {
                schema: { tables: expect.any(Array) },
                rows: { returned_rows: 1 },
              },
            },
          }
        : {}),
    });
    expect(result).toMatchObject({
      ok: false,
      error: {
        cleanupIncomplete: true,
        cleanupResources: expect.arrayContaining([ownedRoot]),
        ...(replyKind === "completed reply"
          ? { partialObservation: { operation: "inspect_sqlite_database" } }
          : {}),
      },
    });
    cleanupAllowed = true;
    await provider.close();
    expect(cleanupAttempts).toBe(3);
    expect(result).toMatchObject({
      ok: false,
      error: { cleanupIncomplete: false, cleanupResources: [] },
    });
    expect(closeFailure).toMatchObject({
      cleanupIncomplete: false,
      cleanupResources: [],
    });
    await expectPrivateRootRemoved(ownedRoot);
  },
);

nativeTest(
  "retains a typed worker output failure after exact runtime-root cleanup retry",
  async () => {
    const { workspace, database } = await createFixture();
    let root: PrivateRuntimeRoot | undefined;
    let rootCloseAttempts = 0;
    const provider = new SqliteDatabaseProvider(
      process.env,
      async (spawn) => {
        const requestPath = spawn.arguments[2];
        if (requestPath === undefined)
          throw new Error("SQLite request path missing");
        const request = JSON.parse(await readFile(requestPath, "utf8")) as {
          reply_path: string;
        };
        await writeFile(
          request.reply_path,
          JSON.stringify({ ok: true, inspection: {} }),
          { flag: "wx", mode: 0o600 },
        );
        return spawnOwnedProviderProcess({
          ...spawn,
          arguments: ["-e", "process.exit(0)"],
        });
      },
      async () => {
        root = await PrivateRuntimeRoot.create({ parent: workspace.root });
        const acquired = root;
        return {
          path: acquired.path,
          close: async () => {
            rootCloseAttempts += 1;
            if (rootCloseAttempts === 1)
              throw new Error("runtime root removal denied once");
            await acquired.close();
          },
        };
      },
    );
    onTestFinished(async () => {
      await provider.close();
      await root?.close();
      await removeTestWorkspace(workspace.root);
    });

    const result = await provider.inspect({ path: database.path });
    if (result.ok) throw new Error("Expected malformed worker output");
    expect(result.error).toMatchObject({
      _tag: "ProviderAdapterError",
      cleanupIncomplete: true,
      diagnostics: {
        previous_error: {
          code: "unreadable_output",
        },
      },
    });
    await provider.close();

    expect(rootCloseAttempts).toBe(2);
    expect(result.error.cleanupIncomplete).toBe(false);
    expect(result.error.cleanupResources).toEqual([]);
    if (root === undefined) throw new Error("Runtime root was not acquired");
    await expectPrivateRootRemoved(root.path);
    expect(projectAnalysisError(result.error)).toMatchObject({
      code: "unreadable_output",
    });
    expect(result.error.cleanupPrimary).toMatchObject({
      _tag: "AnalysisOutputError",
      capturedOutput: { stdout: "", stderr: "", truncated: false },
    });
  },
);

it.each(["late-cancellation", "cleanup-failure", "cancelled cleanup-failure"])(
  "preserves completed native-worker observations across %s",
  async (scenario) => {
    const { workspace, database } = await createFixture();
    const original = await readFile(database.path);
    const controller = new AbortController();
    const cancellationReason = {
      requested: "cancel during final root cleanup",
    };
    let cleanupAllowed = false;
    let root: PrivateRuntimeRoot | undefined;
    const provider = new SqliteDatabaseProvider(
      process.env,
      (spawn) =>
        spawnOwnedProviderProcess({
          ...spawn,
          arguments: spawn.arguments.map((argument, index) =>
            index === 1 ? fileURLToPath(workerUrl) : argument,
          ),
        }),
      async () => {
        root = await PrivateRuntimeRoot.create({ parent: workspace.root });
        const acquired = root;
        return {
          path: acquired.path,
          close: async () => {
            if (scenario !== "cleanup-failure")
              controller.abort(cancellationReason);
            if (scenario !== "late-cancellation" && !cleanupAllowed)
              throw new Error("Completed snapshot cleanup denied");
            await acquired.close();
          },
        };
      },
    );
    onTestFinished(async () => {
      cleanupAllowed = true;
      await provider.close();
    });
    const result = await provider.inspect(
      {
        path: database.path,
        table: "records",
        columns: ["id"],
        row_limit: 1,
        worker_timeout_ms: 42000,
      },
      { signal: controller.signal },
    );
    if (scenario === "late-cancellation") {
      expect(controller.signal.aborted).toBe(true);
      expect(result).toMatchObject({
        ok: false,
        error: {
          _tag: "AnalysisCancelledError",
          cause: cancellationReason,
          partialObservation: {
            operation: "inspect_sqlite_database",
            confidence: "observed",
            subject: {
              local_path: database.path,
              digest: { sha256: digestForTest(original) },
            },
            parameters: {
              path: database.path,
              table: "records",
              columns: ["id"],
              row_limit: 1,
              worker_timeout_ms: 42000,
            },
            normalized_result: {
              worker_timeout_ms: 42000,
              rows: { columns: ["id"], returned_rows: 1 },
            },
          },
        },
      });
      if (result.ok || result.error._tag !== "AnalysisCancelledError")
        throw new Error("Expected cancellation after final root cleanup");
      expect(result.error.cause).toBe(cancellationReason);
      if (root === undefined) throw new Error("Missing acquired root");
      await expectPrivateRootRemoved(root.path);
    } else {
      // Incomplete cleanup stays primary over a cancellation observed during it.
      expect(controller.signal.aborted).toBe(
        scenario === "cancelled cleanup-failure",
      );
      expect(result.ok ? undefined : result.error).toBeInstanceOf(
        ProviderCleanupError,
      );
      expect(result).toMatchObject({
        ok: false,
        error: {
          cleanupIncomplete: true,
          partialObservation: {
            operation: "inspect_sqlite_database",
            confidence: "observed",
            subject: {
              local_path: database.path,
              digest: { sha256: digestForTest(original) },
            },
            parameters: {
              path: database.path,
              table: "records",
              columns: ["id"],
              row_limit: 1,
              worker_timeout_ms: 42000,
            },
            normalized_result: {
              worker_timeout_ms: 42000,
              rows: { columns: ["id"], returned_rows: 1 },
            },
          },
        },
      });
      if (root === undefined) throw new Error("Missing retained root");
      await expect(access(root.path)).resolves.toBeUndefined();
      cleanupAllowed = true;
      await provider.close();
      await expectPrivateRootRemoved(root.path);
    }
    expect(Buffer.compare(await readFile(database.path), original)).toBe(0);
  },
);

const digestForTest = (bytes: Buffer): string =>
  createHash("sha256").update(bytes).digest("hex");

it("inspects committed WAL schema and rows while preserving every source artifact", async () => {
  const { database } = await createFixture(true);
  const paths = [database.path, database.walPath, `${database.path}-shm`];
  const original = await Promise.all(
    paths.map(async (path) => ({
      path,
      bytes: await readFile(path),
      stat: await lstat(path),
    })),
  );
  const result = await createProvider().inspect({
    path: database.path,
    table: "records",
    schema_scope: "database",
    row_limit: 1,
  });
  if (!result.ok) throw result.error;
  const main = original[0];
  const wal = original[1];
  if (main === undefined || wal === undefined)
    throw new Error("Missing fixture identity");
  expect(result.value.result).toMatchObject({
    artifact: {
      path: database.path,
      bytes: main.bytes.length,
      sha256: createHash("sha256").update(main.bytes).digest("hex"),
    },
    wal: {
      path: database.walPath,
      bytes: wal.bytes.length,
      sha256: createHash("sha256").update(wal.bytes).digest("hex"),
    },
    schema: {
      completeness: "complete",
      tables: expect.arrayContaining([
        {
          name: "records",
          sql: expect.stringContaining("CREATE TABLE"),
          root_page: expect.any(Number),
          kind: "table",
          without_rowid: false,
          strict: false,
          column_count: 7,
          columns_completeness: "complete",
          columns: expect.arrayContaining([
            expect.objectContaining({ name: "generated_value", hidden: 2 }),
          ]),
        },
      ]),
      indexes: [
        expect.objectContaining({ name: "records_text", table: "records" }),
      ],
      views: [
        {
          name: "record_names",
          sql: expect.stringContaining("SELECT text_value"),
        },
      ],
      triggers: [
        {
          name: "records_insert",
          table: "records",
          sql: expect.stringContaining("AFTER INSERT"),
        },
      ],
    },
    rows: {
      table: "records",
      returned_rows: 1,
      truncated: true,
      row_limit: 1,
      order: "unspecified",
    },
  });
  for (const artifact of original) {
    expect(Buffer.compare(await readFile(artifact.path), artifact.bytes)).toBe(
      0,
    );
    const after = await lstat(artifact.path);
    expect({
      ino: after.ino,
      size: after.size,
      mtimeMs: after.mtimeMs,
      ctimeMs: after.ctimeMs,
    }).toEqual({
      ino: artifact.stat.ino,
      size: artifact.stat.size,
      mtimeMs: artifact.stat.mtimeMs,
      ctimeMs: artifact.stat.ctimeMs,
    });
  }
});

it("preserves SQLite integer, binary, nonfinite, null, and text byte values", async () => {
  const { database } = await createFixture();
  const result = await createProvider().inspect({
    path: database.path,
    table: "records",
    row_limit: 10,
  });
  if (!result.ok) throw result.error;
  expect(result.value.result).toMatchObject({
    wal: null,
    rows: {
      columns: [
        "id",
        "integer_value",
        "blob_value",
        "real_value",
        "nullable_value",
        "text_value",
        "generated_value",
      ],
      returned_rows: 3,
      truncated: false,
      values: [
        [
          { type: "integer", value: "1" },
          { type: "integer", value: "9223372036854775807" },
          { type: "blob", hex: "001fefff" },
          { type: "real", value: "Infinity" },
          { type: "null" },
          {
            type: "text",
            value: "first é\0value",
            bytes_hex: Buffer.from("first é\0value").toString("hex"),
          },
          {
            type: "text",
            value: "integer",
            bytes_hex: Buffer.from("integer").toString("hex"),
          },
        ],
        [
          { type: "integer", value: "2" },
          { type: "integer", value: "-9223372036854775808" },
          { type: "blob", hex: "" },
          { type: "real", value: "-Infinity" },
          {
            type: "text",
            value: "present",
            bytes_hex: Buffer.from("present").toString("hex"),
          },
          {
            type: "text",
            value: "second",
            bytes_hex: Buffer.from("second").toString("hex"),
          },
          {
            type: "text",
            value: "integer",
            bytes_hex: Buffer.from("integer").toString("hex"),
          },
        ],
        [
          { type: "integer", value: "3" },
          { type: "integer", value: "0" },
          { type: "blob", hex: "ff" },
          { type: "real", value: 1.25 },
          { type: "null" },
          { type: "text", bytes_hex: "ff00c0af" },
          {
            type: "text",
            value: "integer",
            bytes_hex: Buffer.from("integer").toString("hex"),
          },
        ],
      ],
    },
  });
  expect(() => JSON.stringify(result.value.result)).not.toThrow();
});

it("selects an exact quoted table and refuses to execute table input as SQL", async () => {
  const { database } = await createFixture();
  const provider = createProvider();
  const selected = await provider.inspect({
    path: database.path,
    table: database.quotedTable,
    row_limit: 1,
  });
  if (!selected.ok) throw selected.error;
  expect(selected.value.result).toMatchObject({
    rows: {
      table: database.quotedTable,
      columns: ["__proto__"],
      values: [
        [
          {
            type: "text",
            value: "exact selected table",
            bytes_hex: Buffer.from("exact selected table").toString("hex"),
          },
        ],
      ],
      returned_rows: 1,
      truncated: false,
    },
  });
  const unknown = await provider.inspect({
    path: database.path,
    table: 'records"; DROP TABLE records;--',
    row_limit: 1,
  });
  expect(unknown).toMatchObject({
    ok: false,
    error: { _tag: "AnalysisInputError" },
  });
  const after = await provider.inspect({
    path: database.path,
    table: "records",
    row_limit: 10,
  });
  if (!after.ok) throw after.error;
  expect(after.value.result).toMatchObject({ rows: { returned_rows: 3 } });
});

it("does not execute views when selecting rows", async () => {
  const { database } = await createFixture();
  const result = await createProvider().inspect({
    path: database.path,
    table: "record_names",
    row_limit: 1,
  });
  expect(result).toMatchObject({
    ok: false,
    error: { _tag: "AnalysisInputError" },
  });
});

nativeTest.each(["absent.db", "absent-parent/absent.db"])(
  "classifies a missing %s as an invalid value",
  async (name) => {
    const workspace = await createTestWorkspace("rea-sqlite-missing-");
    onTestFinished(() => removeTestWorkspace(workspace.root));
    const path = workspace.path(name);
    const provider = createProvider();
    onTestFinished(() => provider.close());
    const result = await provider.inspect({ path });
    if (result.ok) throw new Error("Expected a missing database rejection");
    expect(projectAnalysisError(result.error)).toMatchObject({
      details: {
        issues: [
          {
            path: ["path"],
            reason: "invalid_value",
            message: `Selected SQLite database does not exist: ${path}`,
          },
        ],
      },
    });
  },
);

it("attributes table and column selection failures to their own arguments", async () => {
  const { database } = await createFixture();
  const provider = createProvider();
  onTestFinished(() => provider.close());
  const projection = async (selection: {
    table: string;
    columns?: string[];
  }) => {
    const result = await provider.inspect({
      path: database.path,
      row_limit: 1,
      ...selection,
    });
    if (result.ok) throw new Error("Expected a rejected selection");
    return projectAnalysisError(result.error);
  };
  expect(
    await projection({ table: "records", columns: ["nope"] }),
  ).toMatchObject({
    details: {
      issues: [
        {
          path: ["columns"],
          reason: "invalid_format",
          message:
            "Selected column does not exist with that exact name in table records: nope",
        },
      ],
    },
  });
  expect(await projection({ table: "absent" })).toMatchObject({
    details: { issues: [{ path: ["table"] }] },
  });
  const selected = await provider.inspect({
    path: database.path,
    table: "records",
    columns: ["id"],
    row_limit: 1,
  });
  if (!selected.ok) throw selected.error;
  expect(selected.value.result).toMatchObject({ rows: { columns: ["id"] } });
});

it("reports a projection above SQLite's result-column capacity as capacity, not invalid input", async () => {
  const { database } = await createFixture();
  const reader = new DatabaseSync(database.path, { readOnly: true });
  const engineColumnLimit = (() => {
    try {
      return reader.limits.column;
    } finally {
      reader.close();
    }
  })();
  const provider = createProvider();
  onTestFinished(() => provider.close());
  const columns = (count: number): string[] =>
    Array.from({ length: count }, () => "text_value");
  const atLimit = await provider.inspect({
    path: database.path,
    table: "records",
    columns: columns(engineColumnLimit),
    row_limit: 1,
  });
  if (!atLimit.ok) throw atLimit.error;
  expect(atLimit.value.result).toMatchObject({
    rows: { columns: columns(engineColumnLimit), returned_rows: 1 },
  });

  const overLimit = await provider.inspect({
    path: database.path,
    table: "records",
    columns: columns(engineColumnLimit + 1),
    row_limit: 1,
  });
  if (overLimit.ok) throw new Error("Expected a rejected projection");
  const projection = projectAnalysisError(overLimit.error);
  expect(projection).toMatchObject({
    code: "resource_constraint",
    details: {
      resource: "capacity",
      reported_limits: {
        selected_result_columns: engineColumnLimit + 1,
        engine_result_column_limit: engineColumnLimit,
      },
    },
  });
  expect(JSON.stringify(projection)).not.toContain("invalid_format");
});

it("attributes inventory selections beyond metadata bind capacity to result-column capacity", async () => {
  const { database } = await createFixture();
  const reader = new DatabaseSync(database.path, { readOnly: true });
  let selectedColumns: number;
  let engineColumnLimit: number;
  try {
    engineColumnLimit = reader.limits.column;
    selectedColumns =
      Math.max(reader.limits.variableNumber, engineColumnLimit) + 1;
  } finally {
    reader.close();
  }
  const provider = createProvider();
  onTestFinished(() => provider.close());
  const original = await readFile(database.path);
  const control = await provider.inspect({
    path: database.path,
    table: "records",
    schema_scope: "inventory",
    columns: ["text_value", "text_value"],
    row_limit: 1,
  });
  if (!control.ok) throw control.error;
  expect(control.value.result).toMatchObject({
    rows: {
      columns: ["text_value", "text_value"],
      returned_rows: 1,
    },
  });
  const result = await provider.inspect({
    path: database.path,
    table: "records",
    schema_scope: "inventory",
    columns: Array.from({ length: selectedColumns }, () => "text_value"),
    row_limit: 1,
  });
  if (result.ok) throw new Error("Expected result-column capacity refusal");
  const projected = projectAnalysisError(result.error);
  expect(projected).toMatchObject({
    code: "resource_constraint",
    details: {
      resource: "capacity",
      reported_limits: {
        selected_result_columns: selectedColumns,
        engine_result_column_limit: engineColumnLimit,
      },
    },
  });
  expect(JSON.stringify(projected)).not.toContain("invalid_format");
  expect(Buffer.compare(await readFile(database.path), original)).toBe(0);
});

it("reports application-collation row failures as unavailable while retaining schema-only recovery", async () => {
  const workspace = await createTestWorkspace("rea-sqlite-collation-");
  onTestFinished(() => removeTestWorkspace(workspace.root));
  const path = createSqliteApplicationCollationFixture(workspace.root);
  const original = await readFile(path);
  const provider = createProvider();
  onTestFinished(() => provider.close());
  const schema = await provider.inspect({ path, schema_scope: "database" });
  if (!schema.ok) throw schema.error;
  expect(schema.value.result).toMatchObject({
    schema: {
      tables: [
        {
          name: "items",
          sql: expect.stringContaining("COLLATE APPLICATION_COLLATION"),
        },
      ],
    },
    rows: null,
  });
  for (const columns of [undefined, ["value"], ["generated_value"]]) {
    const result = await provider.inspect({
      path,
      table: "items",
      ...(columns === undefined ? {} : { columns }),
    });
    if (result.ok)
      throw new Error("Expected unavailable application collation");
    const projected = projectAnalysisError(result.error);
    expect(projected).toMatchObject({
      code: "capability_unavailable",
      message: expect.stringContaining('rows of table "items"'),
      remediation: {
        action: expect.stringContaining("schema_scope: database"),
      },
    });
    expect(JSON.stringify(projected)).not.toContain("invalid_format");
    expect(projected.remediation.action).not.toContain(
      "Select columns whose values were read",
    );
  }
  expect(Buffer.compare(await readFile(path), original)).toBe(0);
});

it("rejects malformed databases without altering the selected file", async () => {
  const workspace = await createTestWorkspace("rea-sqlite-invalid-");
  onTestFinished(() => removeTestWorkspace(workspace.root));
  const path = await workspace.write(
    "not-a-database.db",
    "selected non-SQLite bytes",
  );
  const bytes = await readFile(path);
  const result = await createProvider().inspect({ path });
  expect(result).toMatchObject({
    ok: false,
    error: { _tag: "AnalysisInputError" },
  });
  expect(Buffer.compare(await readFile(path), bytes)).toBe(0);
});

nativeTest.runIf(process.platform !== "win32")(
  "rejects a symlink database",
  async () => {
    const { database, workspace } = await createFixture();
    const alias = workspace.path("alias.db");
    await symlink(database.path, alias);
    const provider = createProvider();
    expect(await provider.inspect({ path: alias })).toMatchObject({
      ok: false,
      error: { _tag: "AnalysisInputError" },
    });
  },
);

nativeTest(
  "rejects an actual open rollback transaction without changing its journal",
  async () => {
    const { database } = await createFixture();
    const writer = new DatabaseSync(database.path);
    writer.exec(
      "BEGIN IMMEDIATE; INSERT INTO records(id, text_value) VALUES (4, 'uncommitted')",
    );
    try {
      const main = await readFile(database.path);
      const journalPath = `${database.path}-journal`;
      const journal = await readFile(journalPath);
      expect(journal.length).toBeGreaterThan(0);
      expect(
        await createProvider().inspect({ path: database.path }),
      ).toMatchObject({
        ok: false,
        error: { _tag: "AnalysisInputError" },
      });
      expect(Buffer.compare(await readFile(database.path), main)).toBe(0);
      expect(Buffer.compare(await readFile(journalPath), journal)).toBe(0);
    } finally {
      writer.exec("ROLLBACK");
      writer.close();
    }
  },
);

nativeTest.runIf(process.platform !== "win32")(
  "rejects FIFO input without waiting for a writer",
  async () => {
    const workspace = await createTestWorkspace("rea-sqlite-fifo-");
    onTestFinished(() => removeTestWorkspace(workspace.root));
    const path = workspace.path("database.fifo");
    await promisify(execFile)("mkfifo", [path]);
    const result = await createProvider().inspect({ path });
    expect(result).toMatchObject({
      ok: false,
      error: { _tag: "AnalysisInputError" },
    });
  },
);

nativeTest(
  "honors a cancelled caller before opening the database",
  async () => {
    const { database } = await createFixture();
    const controller = new AbortController();
    const reason = { requested: "cancel before admission" };
    controller.abort(reason);
    const result = await createProvider().inspect(
      { path: database.path },
      { signal: controller.signal },
    );
    if (result.ok || result.error._tag !== "AnalysisCancelledError")
      throw new Error("Expected pre-admission cancellation");
    expect(result.error.cause).toBe(reason);
  },
);

nativeTest(
  "preserves the exact caller reason when cancellation lands before snapshot work",
  async () => {
    const { database } = await createFixture();
    const controller = new AbortController();
    const reason = { requested: "cancel after admission" };
    const provider = new SqliteDatabaseProvider({}, () => {
      throw new Error("SQLite worker must not launch before snapshot work");
    });
    onTestFinished(() => provider.close());

    const inspection = provider.inspect(
      { path: database.path },
      { signal: controller.signal },
    );
    controller.abort(reason);
    const result = await inspection;
    if (result.ok || result.error._tag !== "AnalysisCancelledError")
      throw new Error("Expected cancellation before snapshot work");
    expect(result.error.cause).toBe(reason);
  },
);

nativeTest(
  "keeps an owned worker failure primary when cancellation arrives during cleanup",
  async () => {
    const { database } = await createFixture();
    const controller = new AbortController();
    const reason = { requested: "stop after worker exit" };
    const provider = new SqliteDatabaseProvider(process.env, async (spawn) => {
      const launched = await spawnOwnedProviderProcess({
        ...spawn,
        arguments: [
          "-e",
          'process.stderr.write("authored SQLite worker failure"); process.exitCode = 7',
        ],
      });
      const cleanup =
        launched.cleanup ??
        (() => cleanupOwnedProcessGroup(launched.ownership));
      return {
        ...launched,
        cleanup: async () => {
          const outcome = await cleanup();
          controller.abort(reason);
          return outcome;
        },
      };
    });
    onTestFinished(async () => {
      await provider.close();
    });

    const result = await provider.inspect(
      { path: database.path, table: "records" },
      { signal: controller.signal },
    );

    expect(controller.signal.reason).toBe(reason);
    expect(result).toMatchObject({
      ok: false,
      error: {
        _tag: "ProviderAdapterError",
        diagnostics: {
          failure_kind: "process",
          exit_code: 7,
          captured_output: {
            stderr: "authored SQLite worker failure",
          },
        },
      },
    });
  },
);

nativeTest(
  "removes an acquired private root when cancelled before snapshot creation",
  async () => {
    const { database } = await createFixture();
    const controller = new AbortController();
    let ownedRoot = "";
    const provider = new SqliteDatabaseProvider(
      {},
      () => {
        throw new Error("Cancelled request must not launch SQLite");
      },
      async () => {
        const root = await PrivateRuntimeRoot.create({
          prefix: "rea-sqlite-cancel-root-",
        });
        ownedRoot = root.path;
        controller.abort();
        return root;
      },
    );
    expect(
      await provider.inspect(
        { path: database.path },
        { signal: controller.signal },
      ),
    ).toMatchObject({ ok: false, error: { _tag: "AnalysisCancelledError" } });
    await expectPrivateRootRemoved(ownedRoot);
  },
);

it.each(["UTF-8", "UTF-16le", "UTF-16be"] as const)(
  "preserves %s text, a leading BOM and empty table selection",
  async (encoding) => {
    const workspace = await createTestWorkspace("rea-sqlite-encoding-");
    onTestFinished(() => removeTestWorkspace(workspace.root));
    const path = workspace.path("encoding.db");
    const writer = new DatabaseSync(path);
    writer.exec(
      `PRAGMA encoding='${encoding}'; CREATE TABLE "" ("1" TEXT, "0" TEXT)`,
    );
    const value = "\uFEFFé𝄞\0selected";
    writer
      .prepare('INSERT INTO "" VALUES (?, ?)')
      .run(value, "second numeric column");
    writer.close();
    const bytes = Buffer.from(value, encoding === "UTF-8" ? "utf8" : "utf16le");
    if (encoding === "UTF-16be") bytes.swap16();
    const result = await createProvider().inspect({
      path,
      table: "",
    });
    if (!result.ok) throw result.error;
    expect(result.value.result).toMatchObject({
      database_encoding: encoding,
      rows: {
        table: "",
        columns: ["1", "0"],
        returned_rows: 1,
        values: [
          [
            { type: "text", value, bytes_hex: bytes.toString("hex"), encoding },
            { type: "text", value: "second numeric column" },
          ],
        ],
      },
    });
  },
);

it("retains an unavailable virtual module definition without executing it", async () => {
  const workspace = await createTestWorkspace("rea-sqlite-virtual-");
  onTestFinished(() => removeTestWorkspace(workspace.root));
  const path = workspace.path("virtual.db");
  const writer = new DatabaseSync(path);
  writer.exec(
    "CREATE VIRTUAL TABLE optional_search USING fts5(body); INSERT INTO optional_search VALUES ('selected source')",
  );
  writer.close();
  const bytes = await readFile(path);
  const declaration = bytes.indexOf(Buffer.from("USING fts5"));
  if (declaration < 0)
    throw new Error("SQLite virtual module declaration not found");
  bytes.write("zzzz", declaration + Buffer.byteLength("USING "), "utf8");
  await writeFile(path, bytes);
  const provider = createProvider();
  const result = await provider.inspect({ path, schema_scope: "database" });
  if (!result.ok) throw result.error;
  expect(result.value.result).toMatchObject({
    rows: null,
    schema: {
      tables: expect.arrayContaining([
        expect.objectContaining({
          name: "optional_search",
          kind: "virtual",
          sql: expect.stringContaining("USING zzzz"),
          columns: [],
          columns_completeness: "unsupported",
        }),
      ]),
    },
  });
  expect(
    await provider.inspect({ path, table: "optional_search" }),
  ).toMatchObject({ ok: false, error: { _tag: "AnalysisInputError" } });
  expect(Buffer.compare(await readFile(path), bytes)).toBe(0);
});

nativeTest(
  "cancels an acquired SQLite worker and removes its private snapshot",
  async () => {
    const { database } = await createFixture();
    const controller = new AbortController();
    const reason = { requested: "stop owned SQLite worker" };
    let ownedRoot = "";
    let pid: number | undefined;
    const provider = new SqliteDatabaseProvider(
      process.platform === "win32" && process.env.SystemRoot !== undefined
        ? { SystemRoot: process.env.SystemRoot }
        : {},
      async (spawn) => {
        ownedRoot = spawn.cwd ?? "";
        const requestPath = spawn.arguments[2];
        if (requestPath === undefined)
          throw new Error("SQLite worker arguments missing");
        const launched = await spawnOwnedProviderProcess({
          ...spawn,
          arguments: [
            "--input-type=module",
            "-e",
            `await import(${JSON.stringify(workerUrl.href)}); process.stdout.write('ready\\n'); setInterval(() => {}, 1000);`,
            "sqlite-worker-test",
            requestPath,
          ],
        });
        pid = launched.process.pid;
        await waitForProviderProcessReady(launched.process);
        await access(`${ownedRoot}/reply.json`);
        setImmediate(() => controller.abort(reason));
        return launched;
      },
    );
    const result = await provider.inspect(
      { path: database.path, table: "records" },
      { signal: controller.signal },
    );
    expect(result).toMatchObject({
      ok: false,
      error: { _tag: "AnalysisCancelledError" },
    });
    if (!result.ok && result.error._tag === "AnalysisCancelledError")
      expect(result.error.cause).toBe(reason);
    if (pid === undefined) throw new Error("SQLite worker not acquired");
    const acquiredPid = pid;
    expect(() => process.kill(acquiredPid, 0)).toThrow();
    await expectPrivateRootRemoved(ownedRoot);
  },
);

nativeTest.each([
  ["cancelled", "cancelled"],
  ["output-limit", "unreadable_output"],
  ["heap-diagnostic", "resource_constraint"],
] as const)(
  "preserves the typed %s worker failure through retained cleanup retry",
  async (scenario, code) => {
    const { database } = await createFixture();
    const controller = new AbortController();
    const reason = { requested: "cancel retained SQLite worker" };
    let cleanupAllowed = false;
    let ownedRoot = "";
    let launches = 0;
    const provider = new SqliteDatabaseProvider({}, async (spawn) => {
      launches += 1;
      ownedRoot = spawn.cwd ?? "";
      const script =
        scenario === "heap-diagnostic"
          ? "process.stderr.write('JavaScript heap out of memory'); process.exitCode = 3"
          : scenario === "output-limit"
            ? `process.stdout.write('x'.repeat(${String(SQLITE_DATABASE_LIMITS.diagnosticBytes + 1)})); setInterval(() => {}, 1000)`
            : "process.stdout.write('ready\\n'); setInterval(() => {}, 1000)";
      const launched = await spawnOwnedProviderProcess({
        ...spawn,
        arguments: ["-e", script],
      });
      const cleanupOwned =
        launched.cleanup ??
        (() => cleanupOwnedProcessGroup(launched.ownership));
      if (scenario === "cancelled") {
        await waitForProviderProcessReady(launched.process);
        setImmediate(() => controller.abort(reason));
      }
      return {
        ...launched,
        cleanup: async () => {
          const cleaned = await cleanupOwned();
          if (!cleanupAllowed)
            throw new Error("controlled SQLite worker cleanup refusal");
          return cleaned;
        },
      };
    });
    onTestFinished(async () => {
      cleanupAllowed = true;
      await provider.close();
    });
    const result = await provider.inspect(
      { path: database.path },
      { signal: controller.signal },
    );
    if (result.ok) throw new Error("Expected retained worker cleanup");
    expect(projectAnalysisError(result.error).code).toBe("cleanup_incomplete");
    const primary = result.error.cleanupPrimary;
    if (primary === undefined) throw new Error("Missing typed worker failure");
    expect(projectAnalysisError(primary).code).toBe(code);
    if (scenario === "cancelled")
      expect(result.error.cleanupPrimary?.cause).toBe(reason);
    expect(await provider.inspect({ path: database.path })).toMatchObject({
      ok: false,
      error: { cleanupIncomplete: true },
    });
    expect(launches).toBe(1);
    await access(ownedRoot);
    cleanupAllowed = true;
    await provider.close();
    expect(result.error.cleanupIncomplete).toBe(false);
    expect(result.error.cleanupResources).toEqual([]);
    expect(projectAnalysisError(result.error).code).toBe(code);
    if (scenario === "cancelled")
      expect(result.error.cleanupPrimary?.cause).toBe(reason);
    await expectPrivateRootRemoved(ownedRoot);
  },
);

nativeTest.each([
  { encoding: "malformed UTF-8", code: "unreadable_output" },
  { encoding: "literal replacement character", code: "capability_unavailable" },
  { encoding: "UTF-8 BOM", code: "unreadable_output" },
  { encoding: "malformed JSON", code: "unreadable_output" },
] as const)(
  "admits complete SQLite reply-file JSON without replacement decoding: $encoding",
  async ({ encoding, code }) => {
    const { database } = await createFixture();
    let ownedRoot = "";
    const provider = new SqliteDatabaseProvider(process.env, async (spawn) => {
      ownedRoot = spawn.cwd ?? "";
      const requestPath = spawn.arguments[2];
      if (requestPath === undefined)
        throw new Error("SQLite request path missing");
      const request = JSON.parse(await readFile(requestPath, "utf8")) as {
        reply_path: string;
      };
      const valid = Buffer.from(
        JSON.stringify({
          ok: false,
          reason: "unavailable",
          message: "recorded \ufffd diagnostic",
        }),
      );
      let bytes = valid;
      if (encoding === "malformed UTF-8") {
        const replacementOffset = valid.indexOf(Buffer.from("\ufffd"));
        expect(replacementOffset).toBeGreaterThanOrEqual(0);
        bytes = Buffer.concat([
          valid.subarray(0, replacementOffset),
          Buffer.from([0xff]),
          valid.subarray(replacementOffset + 3),
        ]);
      } else if (encoding === "UTF-8 BOM") {
        bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), valid]);
      } else if (encoding === "malformed JSON") {
        bytes = Buffer.from("{ malformed reply");
      }
      await writeFile(request.reply_path, bytes, { flag: "wx", mode: 0o600 });
      return spawnOwnedProviderProcess({
        ...spawn,
        arguments: [
          "-e",
          "process.stderr.write('sqlite-reply-marker'); process.exit(0)",
        ],
      });
    });
    onTestFinished(() => provider.close());
    const result = await provider.inspect({ path: database.path });
    if (result.ok) throw new Error("Expected worker refusal");
    expect(projectAnalysisError(result.error).code).toBe(code);
    expect(result.error.capturedOutput).toMatchObject({
      stderr: "sqlite-reply-marker",
      truncated: false,
    });
    if (encoding === "literal replacement character")
      expect(projectAnalysisError(result.error).message).toBe(
        "recorded \ufffd diagnostic",
      );
    else
      expect(result.error.cause).toBeInstanceOf(
        encoding === "malformed UTF-8" ? TypeError : SyntaxError,
      );
    await provider.close();
    await expectPrivateRootRemoved(ownedRoot);
  },
);
