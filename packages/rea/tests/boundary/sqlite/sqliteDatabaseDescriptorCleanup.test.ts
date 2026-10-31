import { Cli } from "incur";
import { access, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import type { FileHandle } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it, onTestFinished, vi } from "vitest";

import { SqliteDatabaseService } from "../../../src/application/sqlite/SqliteDatabaseService.js";
import { ArtifactFileCleanupFailure } from "../../../src/artifacts/ArtifactFileOperation.js";
import { ArtifactResourceScope } from "../../../src/artifacts/ArtifactResourceScope.js";
import { registerSqliteCommands } from "../../../src/cli/sqliteCommands.js";
import { createSqliteDatabaseService } from "../../../src/composition/sqlite.js";
import { projectAnalysisError } from "../../../src/domain/analysisErrorProjection.js";
import { ProviderCleanupError } from "../../../src/domain/providerCleanupError.js";
import { primaryAnalysisError } from "../../../src/domain/analysisErrorBase.js";
import { parseEvidence } from "../../../src/domain/evidence.js";
import { silentLogger } from "../../../src/logger.js";
import { SqliteDatabaseProvider } from "../../../src/sqlite/SqliteDatabaseProvider.js";
import { PrivateRuntimeRoot } from "../../../src/process/PrivateRuntimeRoot.js";
import { spawnOwnedProviderProcess } from "../../../src/process/ProviderProcess.js";
import {
  createSqliteDatabaseFixture,
  SQLITE_NATIVE_LIMITS_AVAILABLE,
} from "../../fixtures/sqlite/database.js";
import {
  createTestWorkspace,
  removeTestWorkspace,
} from "../../support/workspace/workspaceFixture.js";

const nativeInspectionTest = it.runIf(SQLITE_NATIVE_LIMITS_AVAILABLE);

const descriptorCleanup = vi.hoisted(() => ({
  path: "",
  denied: false,
  invalidate: false,
  attempts: 0,
  handles: [] as FileHandle[],
  readFailure: undefined as Error | undefined,
  onOpen: undefined as (() => void) | undefined,
  onClose: undefined as (() => void) | undefined,
  reply: undefined as string | undefined,
}));

vi.mock("../../../src/composition/sqlite.js", () => ({
  createSqliteDatabaseService: vi.fn(),
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const filesystem = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...filesystem,
    open: async (...args: Parameters<typeof filesystem.open>) => {
      const handle = await filesystem.open(...args);
      if (args[0] === descriptorCleanup.path) {
        descriptorCleanup.handles.push(handle);
        const close = handle.close.bind(handle);
        handle.close = async () => {
          // FileHandle.close also asks attached streams to close the invalidated handle.
          if (handle.fd < 0) {
            await close();
            return;
          }
          descriptorCleanup.attempts += 1;
          if (descriptorCleanup.denied) {
            if (descriptorCleanup.invalidate) await close();
            descriptorCleanup.onClose?.();
            throw new Error("injected SQLite descriptor close failure");
          }
          await close();
          descriptorCleanup.onClose?.();
        };
        if (descriptorCleanup.readFailure !== undefined)
          vi.spyOn(handle, "stat").mockRejectedValue(
            descriptorCleanup.readFailure,
          );
        descriptorCleanup.onOpen?.();
      }
      return handle;
    },
  };
});

const fixture = async (
  member: "database" | "WAL" | "journal" | "reply",
  invalidate = false,
) => {
  const workspace = await createTestWorkspace("rea-sqlite-descriptor-cleanup-");
  const database = createSqliteDatabaseFixture(workspace.root, true);
  const path =
    member === "database"
      ? database.path
      : member === "WAL"
        ? database.walPath
        : member === "journal"
          ? `${database.path}-journal`
          : "";
  if (member === "journal") await writeFile(path, Buffer.alloc(28));
  const roots: PrivateRuntimeRoot[] = [];
  const provider = new SqliteDatabaseProvider(
    process.env,
    (spawn) => {
      if (member !== "reply")
        throw new Error("SQLite worker deliberately unavailable");
      if (descriptorCleanup.reply !== undefined)
        return spawnOwnedProviderProcess({
          ...spawn,
          arguments: [
            "-e",
            `const fs=require('node:fs');const request=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));fs.writeFileSync(request.reply_path,${JSON.stringify(descriptorCleanup.reply)});`,
            spawn.arguments[2] ?? "",
          ],
        });
      return spawnOwnedProviderProcess({
        ...spawn,
        arguments: spawn.arguments.map((argument, index) =>
          index === 1
            ? fileURLToPath(
                new URL(
                  "../../../dist/sqlite/SqliteDatabaseWorker.js",
                  import.meta.url,
                ),
              )
            : argument,
        ),
      });
    },
    async () => {
      const root = await PrivateRuntimeRoot.create({ parent: workspace.root });
      if (member === "reply")
        descriptorCleanup.path = join(root.path, "reply.json");
      roots.push(root);
      return root;
    },
  );
  descriptorCleanup.path = path;
  descriptorCleanup.denied = true;
  descriptorCleanup.invalidate = invalidate;
  descriptorCleanup.attempts = 0;
  descriptorCleanup.handles = [];
  descriptorCleanup.readFailure = undefined;
  descriptorCleanup.onOpen = undefined;
  descriptorCleanup.onClose = undefined;
  descriptorCleanup.reply = undefined;
  onTestFinished(async () => {
    descriptorCleanup.denied = false;
    try {
      await provider.close();
    } catch (cause) {
      if (!invalidate) throw cause;
    }
    for (const handle of descriptorCleanup.handles) await handle.close();
    descriptorCleanup.path = "";
    descriptorCleanup.onClose = undefined;
    descriptorCleanup.reply = undefined;
    database.close();
    await removeTestWorkspace(workspace.root);
  });
  return { provider, roots, path, database };
};

const serveInspection = async (
  provider: SqliteDatabaseProvider,
  path: string,
) => {
  const previousExitCode = process.exitCode;
  onTestFinished(() => {
    process.exitCode = previousExitCode;
  });
  vi.mocked(createSqliteDatabaseService).mockReturnValue(
    new SqliteDatabaseService(provider),
  );
  const cli = Cli.create("rea-sqlite-cleanup-test", { sync: false });
  registerSqliteCommands(cli, silentLogger, {});
  let stdout = "";
  await cli.serve(["inspect-sqlite-database", path, "--json"], {
    env: {},
    stdout: (text) => {
      stdout += text;
    },
    exit: () => {},
  });
  return { output: JSON.parse(stdout) as unknown, exitCode: process.exitCode };
};

const expectedMember = async (role: string, path: string) => {
  const bytes = await readFile(path);
  return {
    role,
    path,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    bytes: bytes.length,
  };
};

it.each(["database", "WAL", "journal"] as const)(
  "retains a failed %s descriptor and retries it at shutdown",
  async (member) => {
    const selected = await fixture(member);
    const first = await selected.provider.inspect({
      path: selected.database.path,
    });
    if (first.ok) throw new Error("Expected incomplete source cleanup");
    expect(first).toMatchObject({
      ok: false,
      error: {
        cleanupIncomplete: true,
        cleanupResources: [expect.stringContaining(selected.path)],
      },
    });
    const sources =
      member === "journal"
        ? []
        : [
            { role: "database", path: selected.database.path },
            ...(member === "WAL"
              ? [{ role: "wal", path: selected.database.walPath }]
              : []),
          ];
    const members = await Promise.all(
      sources.map((source) => expectedMember(source.role, source.path)),
    );
    if (members.length > 0)
      expect(
        projectAnalysisError(first.error).details?.diagnostics,
      ).toMatchObject({
        snapshot_acquisition: { consistency: "unverified", members },
      });
    else
      expect(
        projectAnalysisError(first.error).details?.diagnostics,
      ).not.toHaveProperty("snapshot_acquisition");
    expect(first.error.partialObservation).toBeUndefined();
    const handle = descriptorCleanup.handles[0];
    if (handle === undefined)
      throw new Error("Expected owned source descriptor");
    expect(handle.fd).toBeGreaterThanOrEqual(0);
    const blocked = await selected.provider.inspect({
      path: selected.database.path,
    });
    expect(blocked).toMatchObject({
      ok: false,
      error: { cleanupIncomplete: true },
    });
    expect(selected.roots).toHaveLength(1);
    await expect(selected.provider.close()).rejects.toMatchObject({
      cleanupIncomplete: true,
    });
    expect(descriptorCleanup.attempts).toBe(3);
    descriptorCleanup.denied = false;
    await selected.provider.close();
    expect(descriptorCleanup.attempts).toBe(4);
    expect(handle.fd).toBe(-1);
    if (members.length > 0)
      expect(
        projectAnalysisError(first.error).details?.diagnostics,
      ).toMatchObject({
        snapshot_acquisition: { consistency: "unverified", members },
      });
    for (const root of selected.roots)
      await expect(access(root.path)).rejects.toMatchObject({ code: "ENOENT" });
  },
);

it("delivers individually completed database and WAL facts through CLI cleanup failure", async () => {
  const selected = await fixture("WAL");
  const members = await Promise.all([
    expectedMember("database", selected.database.path),
    expectedMember("wal", selected.database.walPath),
  ]);
  const result = await serveInspection(
    selected.provider,
    selected.database.path,
  );
  expect(result).toMatchObject({
    exitCode: 1,
    output: {
      code: "cleanup_incomplete",
      details: {
        diagnostics: {
          primary_error: {
            details: {
              diagnostics: {
                snapshot_acquisition: { consistency: "unverified", members },
              },
            },
          },
        },
      },
    },
  });
});

it.each(["EACCES", "EPERM"])(
  "retains the original %s inspection diagnostics through CLI shutdown",
  async (code) => {
    const selected = await fixture("database");
    descriptorCleanup.readFailure = Object.assign(
      new Error("injected source read denial"),
      { code },
    );
    const result = await serveInspection(
      selected.provider,
      selected.database.path,
    );
    expect(result).toMatchObject({
      exitCode: 1,
      output: {
        code: "cleanup_incomplete",
        details: {
          resources: [expect.stringContaining(selected.path)],
          diagnostics: {
            primary_error: {
              details: {
                diagnostics: {
                  previous_error: {
                    code: "access_denied",
                    details: { path: selected.path, system_code: code },
                  },
                },
              },
            },
            cleanup_error: { code: "cleanup_incomplete" },
          },
        },
      },
    });
    expect(descriptorCleanup.attempts).toBe(2);
  },
);

it("retains cancellation diagnostics and the interrupt exit code through CLI shutdown", async () => {
  const selected = await fixture("database");
  descriptorCleanup.onOpen = () => {
    const interrupt = process.listeners("SIGINT").at(-1);
    if (interrupt === undefined)
      throw new Error("Missing CLI interrupt handler");
    interrupt("SIGINT");
  };
  const result = await serveInspection(
    selected.provider,
    selected.database.path,
  );
  expect(result).toMatchObject({
    exitCode: 130,
    output: {
      code: "cleanup_incomplete",
      details: {
        resources: [expect.stringContaining(selected.path)],
        diagnostics: {
          primary_error: {
            details: {
              diagnostics: { previous_error: { code: "cancelled" } },
            },
          },
          cleanup_error: { code: "cleanup_incomplete" },
        },
      },
    },
  });
  expect(descriptorCleanup.attempts).toBeGreaterThanOrEqual(2);
});

it("retains reply-read cancellation and retries the failed reply descriptor close", async () => {
  const selected = await fixture("reply");
  const controller = new AbortController();
  const reason = { requested: "cancel during reply read" };
  descriptorCleanup.onOpen = () => controller.abort(reason);
  const result = await selected.provider.inspect(
    { path: selected.database.path },
    { signal: controller.signal },
  );
  if (result.ok) throw new Error("Expected cancelled reply read");
  expect(result.error).toMatchObject({ _tag: "AnalysisCancelledError" });
  expect(result.error.cause).toBe(reason);
  expect(result.error.partialObservation).toBeUndefined();
  const cancelled = {
    code: "cleanup_incomplete",
    details: {
      execution_failure: "cancelled",
      resources: [expect.stringContaining(descriptorCleanup.path)],
      captured_output: {
        stdout: "",
        stderr: expect.any(String),
        truncated: false,
      },
    },
  };
  // Windows cannot remove a private root while the reply descriptor is open;
  // the retained cancellation is then reported as the root cleanup's cause.
  expect(projectAnalysisError(result.error)).toMatchObject(
    process.platform === "win32"
      ? {
          code: "cleanup_incomplete",
          details: {
            resources: [dirname(descriptorCleanup.path)],
            captured_output: cancelled.details.captured_output,
            diagnostics: {
              previous_error: {
                code: cancelled.code,
                details: {
                  execution_failure: "cancelled",
                  resources: cancelled.details.resources,
                },
              },
            },
          },
        }
      : cancelled,
  );
  const handle = descriptorCleanup.handles[0];
  if (handle === undefined) throw new Error("Expected owned reply descriptor");
  expect(handle.fd).toBeGreaterThanOrEqual(0);
  await expect(selected.provider.close()).rejects.toMatchObject({
    cleanupIncomplete: true,
  });
  descriptorCleanup.denied = false;
  await selected.provider.close();
  expect(handle.fd).toBe(-1);
  expect(result.error.cleanupIncomplete).toBe(false);
  expect(projectAnalysisError(result.error)).toMatchObject({
    code: "cancelled",
  });
  for (const root of selected.roots)
    await expect(access(root.path)).rejects.toMatchObject({ code: "ENOENT" });
});

nativeInspectionTest.each([
  { cancel: false, denied: false },
  { cancel: true, denied: false },
  { cancel: false, denied: true },
  { cancel: true, denied: true },
])(
  "retains completed SQLite Evidence through reply close (cancel=$cancel, denied=$denied)",
  async ({ cancel, denied }) => {
    const selected = await fixture("reply");
    descriptorCleanup.denied = denied;
    const controller = new AbortController();
    const reason = { requested: "cancel after complete SQLite reply read" };
    if (cancel) descriptorCleanup.onClose = () => controller.abort(reason);
    const input = {
      path: selected.database.path,
      table: "records",
      columns: ["id"],
      row_limit: 1,
      worker_timeout_ms: 4321,
    };
    const databaseBytes = await readFile(input.path);
    const walBytes = await readFile(selected.database.walPath);
    const databaseDigest = createHash("sha256")
      .update(databaseBytes)
      .digest("hex");
    const walDigest = createHash("sha256").update(walBytes).digest("hex");
    const result = await new SqliteDatabaseService(selected.provider).inspect(
      input,
      { signal: controller.signal },
    );
    expect(result.ok).toBe(!cancel && !denied);
    const evidence = parseEvidence(
      result.ok ? result.value : result.error.partialObservation,
    );
    expect(evidence).toMatchObject({
      operation: "inspect_sqlite_database",
      parameters: input,
      subject: {
        local_path: input.path,
        format: "file",
        digest: { sha256: databaseDigest },
      },
      normalized_result: {
        artifact: {
          path: input.path,
          sha256: databaseDigest,
          bytes: databaseBytes.length,
        },
        wal: {
          path: selected.database.walPath,
          sha256: walDigest,
          bytes: walBytes.length,
        },
        worker_timeout_ms: input.worker_timeout_ms,
        schema: { scope: "selected_table", completeness: "complete" },
        rows: {
          table: "records",
          columns: ["id"],
          values: [[{ type: "integer", value: "1" }]],
          returned_rows: 1,
          truncated: true,
        },
      },
    });
    if (!result.ok) {
      if (cancel) {
        expect(primaryAnalysisError(result.error)._tag).toBe(
          "AnalysisCancelledError",
        );
        expect(primaryAnalysisError(result.error).cause).toBe(reason);
      }
      expect(projectAnalysisError(result.error)).toMatchObject({
        details: { partial_observation: evidence },
      });
      expect(result.error.cleanupIncomplete).toBe(denied);
      if (denied) {
        const handle = descriptorCleanup.handles[0];
        expect(handle?.fd).toBeGreaterThanOrEqual(0);
        await expect(selected.provider.close()).rejects.toMatchObject({
          cleanupIncomplete: true,
        });
        descriptorCleanup.denied = false;
        await selected.provider.close();
        expect(result.error.cleanupIncomplete).toBe(false);
        expect(result.error.cleanupResources).toEqual([]);
        expect(result.error.partialObservation).toEqual(evidence);
      }
    }
    await selected.provider.close();
    expect(descriptorCleanup.handles.every((handle) => handle.fd === -1)).toBe(
      true,
    );
    for (const root of selected.roots)
      await expect(access(root.path)).rejects.toMatchObject({ code: "ENOENT" });
  },
);

it.each([
  { reply: "{ malformed reply", tag: "AnalysisOutputError" },
  {
    reply: JSON.stringify({
      ok: false,
      reason: "selection",
      message: "Selected table does not exist",
    }),
    tag: "AnalysisInputError",
  },
])(
  "preserves a completed $tag reply alongside denied close without inventing SQLite Evidence",
  async ({ reply, tag }) => {
    const selected = await fixture("reply");
    descriptorCleanup.reply = reply;
    const result = await selected.provider.inspect({
      path: selected.database.path,
    });
    if (result.ok) throw new Error("Expected rejected worker reply");
    expect(primaryAnalysisError(result.error)._tag).toBe(tag);
    expect(result.error.partialObservation).toBeUndefined();
    expect(result.error.cleanupIncomplete).toBe(true);
    descriptorCleanup.denied = false;
    await selected.provider.close();
    expect(result.error.cleanupIncomplete).toBe(false);
    expect(primaryAnalysisError(result.error)._tag).toBe(tag);
    expect(descriptorCleanup.handles.every((handle) => handle.fd === -1)).toBe(
      true,
    );
  },
);

nativeInspectionTest(
  "keeps a completed reply close failure primary when abort follows lease retention",
  async () => {
    const selected = await fixture("reply");
    const controller = new AbortController();
    const reason = { requested: "abort after reply close failure capture" };
    let retainedReplyLease: string | undefined;
    const retain = ArtifactResourceScope.prototype.retain;
    const retainSpy = vi
      .spyOn(ArtifactResourceScope.prototype, "retain")
      .mockImplementation(function (this: ArtifactResourceScope, owner) {
        retain.call(this, owner);
        if (
          owner.kind === "lease" &&
          owner.resource === descriptorCleanup.path
        ) {
          retainedReplyLease = owner.resource;
          controller.abort(reason);
        }
      });

    try {
      const result = await selected.provider.inspect(
        { path: selected.database.path },
        { signal: controller.signal },
      );
      expect(controller.signal.aborted).toBe(true);
      expect(controller.signal.reason).toBe(reason);
      expect(retainedReplyLease).toBe(descriptorCleanup.path);
      expect(result.ok).toBe(false);
      if (result.ok) return;

      const primary = primaryAnalysisError(result.error);
      expect(primary).toBeInstanceOf(ProviderCleanupError);
      if (!(primary instanceof ProviderCleanupError)) return;
      expect(primary).not.toMatchObject({ _tag: "AnalysisCancelledError" });
      expect(primary.cause).toBeInstanceOf(ArtifactFileCleanupFailure);
      expect(primary.cause).toMatchObject({
        fileCleanupFailure: {
          path: descriptorCleanup.path,
          outcome: { kind: "completed" },
          completionCancellation: undefined,
        },
      });
      expect(primary.cleanupIncomplete).toBe(true);
      expect(primary.cleanupResources).toContain(descriptorCleanup.path);

      const handle = descriptorCleanup.handles[0];
      if (handle === undefined)
        throw new Error("Expected owned reply descriptor");
      expect(handle.fd).toBeGreaterThanOrEqual(0);
      expect(descriptorCleanup.attempts).toBe(1);

      descriptorCleanup.denied = false;
      await selected.provider.close();
      expect(descriptorCleanup.attempts).toBe(2);
      expect(handle.fd).toBe(-1);
      expect(primary.cleanupIncomplete).toBe(false);
      expect(primary).toBeInstanceOf(ProviderCleanupError);
    } finally {
      retainSpy.mockRestore();
    }
  },
);

it("retries source cleanup before admitting another snapshot", async () => {
  const selected = await fixture("database");
  await selected.provider.inspect({ path: selected.database.path });
  const first = descriptorCleanup.handles[0];
  if (first === undefined) throw new Error("Expected source descriptor");
  descriptorCleanup.denied = false;
  const resumed = await selected.provider.inspect({
    path: selected.database.path,
  });
  expect(selected.roots).toHaveLength(2);
  expect(first.fd).toBe(-1);
  if (resumed.ok) throw new Error("The worker is deliberately unavailable");
  expect(resumed.error.cleanupIncomplete).toBe(false);
  await selected.provider.close();
});

it("keeps an invalidated descriptor close failure unconfirmed across retries", async () => {
  const selected = await fixture("journal", true);
  const first = await selected.provider.inspect({
    path: selected.database.path,
  });
  expect(first).toMatchObject({
    ok: false,
    error: { cleanupIncomplete: true },
  });
  expect(descriptorCleanup.handles[0]?.fd).toBe(-1);
  descriptorCleanup.denied = false;
  await expect(selected.provider.close()).rejects.toMatchObject({
    cleanupIncomplete: true,
  });
  await expect(selected.provider.close()).rejects.toMatchObject({
    cleanupIncomplete: true,
  });
  expect(descriptorCleanup.attempts).toBe(1);
});

it.each(["EACCES", "EPERM"])(
  "preserves %s read diagnostics alongside a failed descriptor close",
  async (code) => {
    const selected = await fixture("database");
    descriptorCleanup.readFailure = Object.assign(
      new Error("injected source read denial"),
      { code },
    );
    const result = await selected.provider.inspect({
      path: selected.database.path,
    });
    expect(result).toMatchObject({
      ok: false,
      error: {
        cleanupIncomplete: true,
        diagnostics: { previous_error: { code: "access_denied" } },
      },
    });
    if (result.ok) throw new Error("Expected physical source denial");
    expect(
      projectAnalysisError(result.error).details?.diagnostics,
    ).not.toHaveProperty("snapshot_acquisition");
  },
);

it.each(["database", "WAL", "journal"] as const)(
  "preserves caller cancellation alongside a failed %s descriptor close",
  async (member) => {
    const selected = await fixture(member);
    const controller = new AbortController();
    const reason = { requested: `cancel while reading ${member}` };
    descriptorCleanup.onOpen = () => controller.abort(reason);
    const result = await selected.provider.inspect(
      { path: selected.database.path },
      { signal: controller.signal },
    );
    if (result.ok) throw new Error("Expected caller cancellation");
    expect(result).toMatchObject({
      ok: false,
      error: {
        cleanupIncomplete: true,
        diagnostics: { previous_error: { code: "cancelled" } },
      },
    });
    descriptorCleanup.denied = false;
    await selected.provider.close();
    expect(result.error.cleanupIncomplete).toBe(false);
    expect(projectAnalysisError(result.error)).toMatchObject({
      code: "cancelled",
    });
    expect(result.error.cleanupPrimary).toMatchObject({
      _tag: "AnalysisCancelledError",
    });
    expect(result.error.cleanupPrimary?.cause).toBe(reason);
    if (member === "WAL")
      expect(
        projectAnalysisError(result.error).details?.diagnostics,
      ).toMatchObject({
        snapshot_acquisition: {
          consistency: "unverified",
          members: [await expectedMember("database", selected.database.path)],
        },
      });
    for (const root of selected.roots)
      await expect(access(root.path)).rejects.toMatchObject({ code: "ENOENT" });
  },
);
