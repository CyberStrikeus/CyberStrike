import {
  lstat,
  open,
  readFile,
  rename,
  symlink,
  unlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { expect, it, onTestFinished, vi } from "vitest";
import { ArtifactResourceScope } from "../../../src/artifacts/ArtifactResourceScope.js";
import type { StableArtifactFileSystem } from "../../../src/artifacts/readStableArtifact.js";
import { captureSqliteDatabaseSnapshot } from "../../../src/sqlite/SqliteDatabaseSnapshot.js";
import { inspectSqliteDatabaseSnapshot } from "../../../src/sqlite/SqliteDatabaseInspection.js";
import { sqliteDatabaseFailure } from "../../../src/sqlite/SqliteDatabaseFailures.js";
import {
  createSqliteDatabaseFixture,
  SQLITE_NATIVE_LIMITS_AVAILABLE,
} from "../../fixtures/sqlite/database.js";
import {
  createTestWorkspace,
  removeTestWorkspace,
} from "../../support/workspace/workspaceFixture.js";

const fixture = async (wal = false) => {
  const workspace = await createTestWorkspace("rea-sqlite-snapshot-race-");
  const database = createSqliteDatabaseFixture(workspace.root, wal);
  if (!wal) database.close();
  const resourceScope = new ArtifactResourceScope();
  onTestFinished(async () => {
    await resourceScope.close();
    if (wal) database.close();
    await removeTestWorkspace(workspace.root);
  });
  const root = await workspace.mkdir("private");
  const capture = (fileSystem?: StableArtifactFileSystem) =>
    captureSqliteDatabaseSnapshot(
      database.path,
      root,
      resourceScope,
      undefined,
      fileSystem,
    );
  return { workspace, database, root, capture };
};

it.runIf(SQLITE_NATIVE_LIMITS_AVAILABLE).each(["PERSIST", "TRUNCATE"])(
  "inspects a committed %s journal without modifying the source file set",
  async (mode) => {
    const { database, capture } = await fixture();
    const writer = new DatabaseSync(database.path);
    try {
      writer.exec(
        `PRAGMA journal_mode=${mode}; INSERT INTO records(id, text_value) VALUES (4, 'committed');`,
      );
    } finally {
      writer.close();
    }
    const journalPath = `${database.path}-journal`;
    const before = await readFile(journalPath);
    const beforeStat = await lstat(journalPath, { bigint: true });
    const snapshot = await capture();
    const result = inspectSqliteDatabaseSnapshot(snapshot.snapshotPath, {
      path: database.path,
      table: "records",
    });
    expect(result.rows).toMatchObject({ returned_rows: 4, truncated: false });
    expect(Buffer.compare(await readFile(journalPath), before)).toBe(0);
    const afterStat = await lstat(journalPath, { bigint: true });
    expect([
      afterStat.ino,
      afterStat.size,
      afterStat.mtimeNs,
      afterStat.ctimeNs,
    ]).toEqual([
      beforeStat.ino,
      beforeStat.size,
      beforeStat.mtimeNs,
      beforeStat.ctimeNs,
    ]);
  },
);

it.runIf(process.platform !== "win32").each([
  ["database", "remove"],
  ["WAL", "remove"],
  ["database", "replace with symlink"],
  ["WAL", "replace with symlink"],
])(
  "reports an observed %s change during acquisition as changed evidence: %s",
  async (member, change) => {
    const { database, workspace, capture } = await fixture(true);
    const replacement = await workspace.write("replacement", "");
    const selectedPath =
      member === "database" ? database.path : database.walPath;
    let observations = 0;
    const fileSystem: StableArtifactFileSystem = {
      lstat: async (path) => {
        if (path === selectedPath && ++observations === 2) {
          await unlink(path);
          if (change === "replace with symlink")
            await symlink(replacement, path);
        }
        return lstat(path, { bigint: true });
      },
      open,
    };
    try {
      await capture(fileSystem);
      throw new Error("A disappearing source must be rejected");
    } catch (cause) {
      expect(
        sqliteDatabaseFailure(cause, database.path, "artifact-read"),
      ).toMatchObject({ _tag: "AnalysisArtifactChangedError" });
      expect(cause).toMatchObject({
        message: expect.stringContaining(selectedPath),
      });
    }
  },
);

it.each(["ELOOP", "ENAMETOOLONG"] as const)(
  "treats %s during file acquisition as changed evidence, not an invalid input path",
  async (code) => {
    const { database, capture } = await fixture();
    const fileSystem: StableArtifactFileSystem = {
      lstat: (path) => lstat(path, { bigint: true }),
      open: async (path, flags) => {
        if (path === database.path)
          throw Object.assign(
            new Error(`${code}: path changed after observation`),
            { code },
          );
        return open(path, flags);
      },
    };

    await expect(capture(fileSystem)).rejects.toMatchObject({
      reason: "integrity",
      message: expect.stringContaining(database.path),
    });
  },
);

it("retains changed-evidence semantics when a sidecar path failure follows database removal", async () => {
  const { database, capture } = await fixture();
  const fileSystem: StableArtifactFileSystem = {
    lstat: async (path) => {
      if (path === database.walPath) {
        await unlink(database.path);
        throw Object.assign(new Error("derived sidecar path is too long"), {
          code: "ENAMETOOLONG",
        });
      }
      return lstat(path, { bigint: true });
    },
    open,
  };

  await expect(capture(fileSystem)).rejects.toMatchObject({
    reason: "integrity",
    message: expect.stringContaining(database.path),
  });
});

it("refuses an active journal even before SQLite writes its magic header", async () => {
  const { database, capture } = await fixture();
  const writer = new DatabaseSync(database.path);
  try {
    writer.exec(
      "PRAGMA journal_mode=PERSIST; BEGIN IMMEDIATE; INSERT INTO records(id, text_value) VALUES (4, 'uncommitted');",
    );
    const journalPath = `${database.path}-journal`;
    const journal = await readFile(journalPath);
    expect(journal.subarray(0, 8).every((byte) => byte === 0)).toBe(true);
    expect(journal.subarray(8, 28).some((byte) => byte !== 0)).toBe(true);
    const original = await readFile(database.path);
    await expect(capture()).rejects.toMatchObject({
      reason: "format",
      message: expect.stringContaining("recovery"),
    });
    expect(Buffer.compare(await readFile(database.path), original)).toBe(0);
    expect(Buffer.compare(await readFile(journalPath), journal)).toBe(0);
  } finally {
    writer.exec("ROLLBACK");
    writer.close();
  }
});

it("refuses an incomplete zeroed journal header", async () => {
  const { database, capture } = await fixture();
  await writeFile(`${database.path}-journal`, Buffer.alloc(27));
  await expect(capture()).rejects.toMatchObject({ reason: "format" });
});

it.runIf(process.platform !== "win32")(
  "refuses a journal symlink even when its target is empty",
  async () => {
    const { database, workspace, capture } = await fixture();
    const empty = await workspace.write("empty-journal", "");
    await symlink(empty, `${database.path}-journal`);
    await expect(capture()).rejects.toMatchObject({ reason: "path" });
  },
);

it.each(["activate", "replace", "remove"])(
  "rejects a cold journal changed during database acquisition: %s",
  async (change) => {
    const { database, capture } = await fixture();
    const journalPath = `${database.path}-journal`;
    await writeFile(journalPath, Buffer.alloc(28));
    const fileSystem: StableArtifactFileSystem = {
      lstat: (path) => lstat(path, { bigint: true }),
      open: async (path, flags) => {
        if (path === database.path) {
          if (change === "activate")
            await writeFile(journalPath, Buffer.alloc(28, 1));
          else if (change === "remove") await unlink(journalPath);
          else {
            await rename(journalPath, `${journalPath}.previous`);
            await writeFile(journalPath, Buffer.alloc(28));
          }
        }
        return open(path, flags);
      },
    };
    await expect(capture(fileSystem)).rejects.toMatchObject({
      _tag: "SqliteSnapshotAcquisitionFailure",
      operationCause: { reason: "integrity" },
    });
  },
);

it("refuses an activated journal even when filesystem metadata cannot distinguish the write", async () => {
  const { database, capture } = await fixture();
  const journalPath = `${database.path}-journal`;
  await writeFile(journalPath, Buffer.alloc(28));
  const observed = await lstat(journalPath, { bigint: true });
  const fileSystem: StableArtifactFileSystem = {
    lstat: (path) =>
      path === journalPath
        ? Promise.resolve(observed)
        : lstat(path, { bigint: true }),
    open: async (path, flags) => {
      if (path === database.path)
        await writeFile(journalPath, Buffer.alloc(28, 1));
      const handle = await open(path, flags);
      if (path === journalPath)
        vi.spyOn(handle, "stat").mockResolvedValue(observed);
      return handle;
    },
  };
  await expect(capture(fileSystem)).rejects.toMatchObject({
    _tag: "SqliteSnapshotAcquisitionFailure",
    operationCause: { reason: "integrity" },
  });
});

it("rejects a database changed after its copy but before WAL acquisition", async () => {
  const { database, root, capture } = await fixture(true);
  const initial = await readFile(database.path);
  const initialStat = await lstat(database.path);
  let changed = false;
  const fileSystem: StableArtifactFileSystem = {
    lstat: (path) => lstat(path, { bigint: true }),
    open: async (path, flags) => {
      if (path === database.walPath) {
        const bytes = Buffer.from(initial);
        const offset = bytes.length - 1;
        bytes[offset] = (bytes[offset] ?? 0) ^ 1;
        await writeFile(database.path, bytes);
        await utimes(database.path, initialStat.atime, initialStat.mtime);
        changed = true;
      }
      return open(path, flags);
    },
  };
  await expect(capture(fileSystem)).rejects.toMatchObject({
    _tag: "SqliteSnapshotAcquisitionFailure",
    operationCause: { reason: "integrity" },
    completedMembers: expect.arrayContaining([
      {
        role: "database",
        path: database.path,
        sha256: createHash("sha256").update(initial).digest("hex"),
        bytes: initial.length,
      },
    ]),
  });
  expect(changed).toBe(true);
  expect(
    Buffer.compare(await readFile(`${root}/database.snapshot`), initial),
  ).toBe(0);
});

it.each(["-wal", "-journal"] as const)(
  "rejects a previously absent %s created during database acquisition",
  async (suffix) => {
    const { database, capture } = await fixture();
    let created = false;
    const fileSystem: StableArtifactFileSystem = {
      lstat: (path) => lstat(path, { bigint: true }),
      open: async (path, flags) => {
        if (path === database.path) {
          await writeFile(
            `${database.path}${suffix}`,
            "newly selected sidecar",
          );
          created = true;
        }
        return open(path, flags);
      },
    };
    await expect(capture(fileSystem)).rejects.toMatchObject({
      _tag: "SqliteSnapshotAcquisitionFailure",
      operationCause: { reason: "integrity" },
    });
    expect(created).toBe(true);
  },
);
