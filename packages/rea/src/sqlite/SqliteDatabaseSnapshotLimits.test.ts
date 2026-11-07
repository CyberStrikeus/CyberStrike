import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, it } from "vitest";

import { ArtifactReaderFailure } from "../artifacts/ArtifactReader.js";
import { ArtifactResourceScope } from "../artifacts/ArtifactResourceScope.js";
import type { StableArtifactFileSystem } from "../artifacts/readStableArtifact.js";
import { projectAnalysisError } from "../domain/analysisErrorProjection.js";
import { AnalysisCancelledError } from "../domain/analysisErrorCore.js";
import { ProviderCleanupError } from "../domain/providerCleanupError.js";
import type { AnalysisPartialObservation } from "../domain/analysisErrorBase.js";
import { captureSqliteDatabaseSnapshot } from "./SqliteDatabaseSnapshot.js";
import { SQLITE_DATABASE_LIMITS } from "./SqliteDatabaseLimits.js";
import { sqliteDatabaseFailure } from "./SqliteDatabaseFailures.js";

it("tags an exact caller reason at snapshot admission", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "rea-sqlite-snapshot-entry-"));
  const reason = { requested: "cancel at snapshot admission" };
  const controller = new AbortController();
  controller.abort(reason);
  const resourceScope = new ArtifactResourceScope();

  try {
    const failure = await captureSqliteDatabaseSnapshot(
      join(workspace, "selected.db"),
      join(workspace, "private"),
      resourceScope,
      controller.signal,
    ).then(
      () => {
        throw new Error("Expected cancellation at snapshot admission");
      },
      (cause: unknown) => cause,
    );
    expect(failure).toBeInstanceOf(ArtifactReaderFailure);
    expect(failure).toMatchObject({
      reason: "cancelled",
      cancellation: { reason },
    });
    const projected = sqliteDatabaseFailure(
      failure,
      join(workspace, "selected.db"),
      "artifact-read",
      controller.signal,
    );
    expect(projected).toBeInstanceOf(AnalysisCancelledError);
    expect(projected.cause).toBe(reason);
  } finally {
    await resourceScope.close();
    await rm(workspace, { force: true, recursive: true });
  }
});

it("keeps the exact caller reason when cancellation lands at final snapshot verification", async () => {
  const workspace = await mkdtemp(
    join(tmpdir(), "rea-sqlite-snapshot-cancel-"),
  );
  const databasePath = join(workspace, "selected.db");
  const privateRoot = join(workspace, "private");
  const journalPath = `${databasePath}-journal`;
  const reason = { requested: "cancel after snapshot copy" };
  const controller = new AbortController();
  await writeFile(databasePath, "tiny fixture");
  await mkdir(privateRoot);
  let journalStats = 0;
  const fileSystem: StableArtifactFileSystem = {
    lstat: async (path) => {
      if (path === journalPath) {
        journalStats += 1;
        if (journalStats === 2) controller.abort(reason);
        throw Object.assign(new Error("journal absent"), { code: "ENOENT" });
      }
      return lstat(path, { bigint: true });
    },
    open: async (path, flags) => open(path, flags),
  };
  const resourceScope = new ArtifactResourceScope();

  try {
    const failure = await captureSqliteDatabaseSnapshot(
      databasePath,
      privateRoot,
      resourceScope,
      controller.signal,
      fileSystem,
    ).then(
      () => {
        throw new Error("Expected cancellation during final verification");
      },
      (cause: unknown) => cause,
    );
    const projected = sqliteDatabaseFailure(
      failure,
      databasePath,
      "artifact-read",
      controller.signal,
    );
    expect(journalStats).toBe(2);
    expect(projected).toBeInstanceOf(AnalysisCancelledError);
    expect(projected.cause).toBe(reason);
  } finally {
    await resourceScope.close();
    await rm(workspace, { force: true, recursive: true });
  }
});

it("reports filesystem sizes above the safe-integer range exactly before opening files", async () => {
  const databaseBytes = BigInt(Number.MAX_SAFE_INTEGER) + 1n;
  const walBytes = 17n;
  const workspace = await mkdtemp(join(tmpdir(), "rea-sqlite-budget-"));
  const databasePath = join(workspace, "selected.db");
  const walPath = `${databasePath}-wal`;
  const journalPath = `${databasePath}-journal`;
  const privateRoot = join(workspace, "private");
  await writeFile(databasePath, "tiny fixture");
  const stat = await lstat(databasePath, { bigint: true });
  const open = async (): Promise<never> => {
    throw new Error("An over-budget source must be refused before open");
  };
  const fileSystem: StableArtifactFileSystem = {
    lstat: async (path) => {
      if (path === journalPath)
        throw Object.assign(new Error("journal absent"), { code: "ENOENT" });
      const size =
        path === databasePath
          ? databaseBytes
          : path === walPath
            ? walBytes
            : stat.size;
      return Object.assign(
        Object.create(Object.getPrototypeOf(stat)) as typeof stat,
        stat,
        { size },
      );
    },
    open,
  };
  const resourceScope = new ArtifactResourceScope();

  try {
    const failure = await captureSqliteDatabaseSnapshot(
      databasePath,
      privateRoot,
      resourceScope,
      undefined,
      fileSystem,
    ).then(
      () => {
        throw new Error("Expected the oversized snapshot to be refused");
      },
      (cause: unknown) => cause,
    );
    const projected = projectAnalysisError(
      sqliteDatabaseFailure(failure, databasePath, "artifact-read"),
    );
    expect(failure).toMatchObject({
      _tag: "AnalysisResourceConstraintError",
      operation: "inspect_sqlite_database",
      resource: "file-size",
      reportedLimits: {
        sqlite_snapshot_input_bytes: SQLITE_DATABASE_LIMITS.inputBytes,
        observed_sqlite_snapshot_input_bytes: (
          databaseBytes + walBytes
        ).toString(),
      },
      remediationAction: expect.stringContaining(
        "smaller offline SQLite snapshot",
      ),
    });
    expect(projected).toMatchObject({
      code: "resource_constraint",
      category: "resource_constraint",
      retryable: false,
      details: {
        reported_limits: {
          sqlite_snapshot_input_bytes: SQLITE_DATABASE_LIMITS.inputBytes,
          observed_sqlite_snapshot_input_bytes: (
            databaseBytes + walBytes
          ).toString(),
        },
      },
      remediation: {
        action: expect.stringContaining("supported export workflow"),
      },
    });
    await expect(readdir(privateRoot)).rejects.toMatchObject({
      code: "ENOENT",
    });
  } finally {
    await resourceScope.close();
    await rm(workspace, { force: true, recursive: true });
  }
});

it.each([
  { label: "incomplete cleanup", retainCleanup: true },
  { label: "partial observation without cleanup", retainCleanup: false },
])(
  "preserves $label when a late read-limit failure becomes changed evidence",
  async ({ retainCleanup }) => {
    const workspace = await mkdtemp(join(tmpdir(), "rea-sqlite-read-cleanup-"));
    const databasePath = join(workspace, "selected.db");
    await writeFile(databasePath, "tiny fixture");
    const stat = await lstat(databasePath, { bigint: true });
    const cleanup = {
      reason: "fixture file-handle close failed",
      resources: [databasePath],
    };
    const partialObservation = {
      operation: "address_to_file_offset",
      address: "0x1000",
      provider_file_offset: 16,
      provider_source_path: null,
      provider_image_header_hex: null,
      original_file_offset: {
        available: false,
        reason: "fixture observation",
      },
    } satisfies AnalysisPartialObservation;
    const details = {
      logicalPath: "selected.db",
      declaredSha256: null,
      calculatedSha256: null,
      unpacked: false,
    };
    const primary = new ArtifactReaderFailure(
      "limit",
      "Selected artifact grew beyond its byte limit",
      { partialObservation },
      details,
    );
    const limitFailure = retainCleanup
      ? ArtifactReaderFailure.withCleanup(primary, cleanup)
      : primary;
    const fileSystem: StableArtifactFileSystem = {
      lstat: async (path) => {
        if (path === `${databasePath}-journal`)
          throw Object.assign(new Error("journal absent"), { code: "ENOENT" });
        return stat;
      },
      open: async () => {
        throw limitFailure;
      },
    };
    const resourceScope = new ArtifactResourceScope();

    try {
      const failure = await captureSqliteDatabaseSnapshot(
        databasePath,
        join(workspace, "private"),
        resourceScope,
        undefined,
        fileSystem,
      ).then(
        () => {
          throw new Error("Expected the changed snapshot to be rejected");
        },
        (cause: unknown) => cause,
      );
      expect(failure).toMatchObject({ reason: "integrity" });
      if (retainCleanup)
        expect(failure).toMatchObject({
          cleanup,
          cause: expect.any(ArtifactReaderFailure),
        });
      expect(failure).toMatchObject({ partialObservation, details });
      const projectedFailure = sqliteDatabaseFailure(
        failure,
        databasePath,
        "artifact-read",
      );
      if (retainCleanup) {
        expect(projectedFailure).toBeInstanceOf(ProviderCleanupError);
        expect(projectedFailure).toMatchObject({
          cleanupIncomplete: true,
          cleanupResources: cleanup.resources,
        });
      }
    } finally {
      await resourceScope.close();
      await rm(workspace, { force: true, recursive: true });
    }
  },
);
