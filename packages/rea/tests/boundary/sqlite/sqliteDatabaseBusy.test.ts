import { spawn, type ChildProcess } from "node:child_process";
import { access } from "node:fs/promises";
import { expect, it, onTestFinished, vi } from "vitest";

import { projectAnalysisError } from "../../../src/domain/analysisErrorProjection.js";
import { PrivateRuntimeRoot } from "../../../src/process/PrivateRuntimeRoot.js";
import { SqliteDatabaseProvider } from "../../../src/sqlite/SqliteDatabaseProvider.js";
import { createSqliteDatabaseFixture } from "../../fixtures/sqlite/database.js";
import {
  createTestWorkspace,
  removeTestWorkspace,
} from "../../support/workspace/workspaceFixture.js";

const busy = vi.hoisted(() => ({ path: "" }));

// Node opens files with full sharing, so a test process cannot hold one without read sharing
// itself. This injects the error Windows returns for that sharing violation.
vi.mock("node:fs/promises", async (importOriginal) => {
  const filesystem = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...filesystem,
    open: async (...args: Parameters<typeof filesystem.open>) => {
      if (busy.path !== "" && args[0] === busy.path)
        throw Object.assign(
          new Error(`EBUSY: resource busy or locked, open '${busy.path}'`),
          { code: "EBUSY", errno: -4082, syscall: "open", path: busy.path },
        );
      return filesystem.open(...args);
    },
  };
});

// Private roots go under the test's own workspace, so the cleanup check sees only this
// provider's root and not those of SQLite tests running in parallel.
const createProvider = (parent: string, roots: string[]) =>
  new SqliteDatabaseProvider(process.env, undefined, async () => {
    const root = await PrivateRuntimeRoot.create({ parent });
    roots.push(root.path);
    return root;
  });

const expectRetryableBusy = (
  error: Parameters<typeof projectAnalysisError>[0],
  path: string,
) =>
  expect(projectAnalysisError(error)).toMatchObject({
    code: "capability_unavailable",
    category: "unavailable",
    retryable: true,
    message:
      "The selected SQLite database is held open by another process without read sharing. Close that application or inspect a copy, then retry.",
    details: {
      provider_id: "sqlite",
      operation: "inspect_sqlite_database",
      reason: `Selected database file set is in use by another process (EBUSY): ${path}`,
    },
  });

const expectRootsRemoved = async (roots: string[]) => {
  expect(roots).toHaveLength(1);
  await expect(access(roots[0]!)).rejects.toMatchObject({ code: "ENOENT" });
};

const stopHolder = async (holder: ChildProcess) => {
  // A holder that never started has no pid and emits only "error", never "exit".
  if (
    holder.pid === undefined ||
    holder.exitCode !== null ||
    holder.signalCode !== null
  )
    return;
  const exited = new Promise<void>((resolve) =>
    holder.once("exit", () => resolve()),
  );
  holder.kill();
  await exited;
};

it("reports a selected database held by another process as retryable and unavailable", async () => {
  const workspace = await createTestWorkspace("rea-sqlite-busy-");
  const database = createSqliteDatabaseFixture(workspace.root);
  database.close();
  const roots: string[] = [];
  const provider = createProvider(workspace.root, roots);
  onTestFinished(async () => {
    busy.path = "";
    await provider.close();
    await removeTestWorkspace(workspace.root);
  });
  busy.path = database.path;

  const result = await provider.inspect({ path: database.path });
  if (result.ok) throw new Error("Expected a busy database rejection");
  expectRetryableBusy(result.error, database.path);
  await expectRootsRemoved(roots);
});

it("names the WAL when another process holds that member of the file set", async () => {
  const workspace = await createTestWorkspace("rea-sqlite-busy-wal-");
  const database = createSqliteDatabaseFixture(workspace.root, true);
  const roots: string[] = [];
  const provider = createProvider(workspace.root, roots);
  onTestFinished(async () => {
    busy.path = "";
    await provider.close();
    database.close();
    await removeTestWorkspace(workspace.root);
  });
  busy.path = database.walPath;

  const result = await provider.inspect({ path: database.path });
  if (result.ok) throw new Error("Expected a busy WAL rejection");
  expectRetryableBusy(result.error, database.walPath);
  await expectRootsRemoved(roots);
});

it.runIf(process.platform === "win32")(
  "reports a database that another Windows process holds without sharing as retryable",
  async () => {
    const workspace = await createTestWorkspace("rea-sqlite-busy-native-");
    const database = createSqliteDatabaseFixture(workspace.root);
    database.close();
    const roots: string[] = [];
    const provider = createProvider(workspace.root, roots);
    const literal = database.path.replaceAll("'", "''");
    const holder = spawn(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        `$f = [System.IO.File]::Open('${literal}', 'Open', 'ReadWrite', 'None'); Write-Output ready; Start-Sleep -Seconds 60; $f.Close()`,
      ],
      { stdio: ["ignore", "pipe", "ignore"], windowsHide: true },
    );
    // One ordered cleanup: the holder must release the file before the workspace is removed.
    onTestFinished(async () => {
      await stopHolder(holder);
      await provider.close();
      await removeTestWorkspace(workspace.root);
    });
    await new Promise<void>((resolve, reject) => {
      holder.stdout?.once("data", () => resolve());
      holder.once("error", (error) =>
        reject(new Error("Holder did not start", { cause: error })),
      );
      holder.once("exit", (code) =>
        reject(
          new Error(`Holder exited before opening the file (${String(code)})`),
        ),
      );
    });

    const result = await provider.inspect({ path: database.path });
    if (result.ok) throw new Error("Expected a busy database rejection");
    expectRetryableBusy(result.error, database.path);
    await expectRootsRemoved(roots);
  },
  20_000,
);
