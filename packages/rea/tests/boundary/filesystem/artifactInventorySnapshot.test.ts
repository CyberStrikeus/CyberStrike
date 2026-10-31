import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { createPackage } from "@electron/asar";
import { describe, expect, it, onTestFinished, vi } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

import { translateArtifactFailure } from "../../../src/artifacts/ArtifactOperationFailure.js";
import {
  ArtifactReaderFailure,
  type ArtifactEntry,
  type ArtifactReader,
} from "../../../src/artifacts/ArtifactReader.js";
import { ArtifactResourceScope } from "../../../src/artifacts/ArtifactResourceScope.js";
import { AsarArtifactReader } from "../../../src/artifacts/AsarArtifactReader.js";
import { DirectoryArtifactReader } from "../../../src/artifacts/DirectoryArtifactReader.js";
import { scanCanonicalArtifactInventoryInScope } from "../../../src/artifacts/inventory/scanCanonical.js";
import { scanArtifactInventory } from "../../fixtures/artifactInventory.js";
import { projectAnalysisError } from "../../../src/domain/analysisErrorProjection.js";

describe("artifact inventory snapshot", () => {
  it("retains the complete scan after the source directory changes", async () => {
    const root = await createTestTempDirectory("rea-inventory-snapshot-");
    await writeFile(join(root, "a.txt"), "a");
    await writeFile(join(root, "b.txt"), "b");
    const snapshot = await scanArtifactInventory(root);

    await rm(join(root, "b.txt"));
    expect(snapshot.occurrences.map(({ logical_path: path }) => path)).toEqual([
      ".",
      "a.txt",
      "b.txt",
    ]);
    expect(snapshot.manifest.occurrence_count).toBe(3);
  });

  it("projects the complete inventory when reader cleanup fails after scanning", async () => {
    const root = await createTestTempDirectory("rea-inventory-cleanup-");
    await writeFile(join(root, "observed.txt"), "observed");
    const directory = new DirectoryArtifactReader(root);
    const resourceScope = new ArtifactResourceScope();
    onTestFinished(() => resourceScope.close());
    let closeAttempts = 0;
    const reader: ArtifactReader = {
      format: directory.format,
      entries: (signal) => directory.entries(signal),
      open: (entry, signal) => directory.open(entry, signal),
      provenance: () => directory.provenance(),
      async close() {
        await directory.close();
        closeAttempts += 1;
        if (closeAttempts > 1) return;
        throw new ArtifactReaderFailure("unavailable", "mount still attached", {
          cleanup: {
            reason: "DMG detach failed",
            resources: ["/dev/disk-test", "/tmp/rea-mount-test"],
          },
        });
      },
    };
    const failure = await resourceScope
      .run(() =>
        scanCanonicalArtifactInventoryInScope(
          root,
          { resourceScope },
          () => reader,
        ),
      )
      .catch((cause: unknown) => cause);
    expect(failure).toBeInstanceOf(ArtifactReaderFailure);
    if (!(failure instanceof ArtifactReaderFailure))
      throw failure instanceof Error
        ? failure
        : new Error("Expected the reader cleanup failure", { cause: failure });
    const projection = projectAnalysisError(
      translateArtifactFailure("inventory_artifact", failure),
    );
    expect(projection).toMatchObject({
      code: "cleanup_incomplete",
      details: {
        execution_failure: "artifact_operation_failed",
        resources: ["/dev/disk-test", "/tmp/rea-mount-test"],
        partial_observation: {
          kind: "artifact-inventory",
          inventory: {
            manifest: { occurrence_count: 2 },
            occurrences: expect.arrayContaining([
              expect.objectContaining({ logical_path: "observed.txt" }),
            ]),
          },
        },
      },
    });
    await resourceScope.close();
    expect(closeAttempts).toBe(2);
  });
});

it("unwinds every nested traversal and preserves its primary failure", async () => {
  const root = await createTestTempDirectory(
    "rea-inventory-traversal-cleanup-",
  );
  const contents = join(root, "contents");
  const bundle = join(root, "bundle");
  await Promise.all([mkdir(contents), mkdir(bundle)]);
  await writeFile(join(contents, "member.js"), "module.exports = 1;");
  await createPackage(contents, join(bundle, "app.asar"));
  const directory = new DirectoryArtifactReader(bundle);
  const resourceScope = new ArtifactResourceScope();
  const returned: string[] = [];
  onTestFinished(async () => {
    vi.restoreAllMocks();
    await resourceScope.close();
  });
  const nestedEntries = AsarArtifactReader.prototype.entries;
  vi.spyOn(AsarArtifactReader.prototype, "entries").mockImplementation(
    function (
      this: AsarArtifactReader,
      signal,
    ): AsyncIterableIterator<ArtifactEntry> {
      const iterator = nestedEntries.call(this, signal)[Symbol.asyncIterator]();
      return {
        [Symbol.asyncIterator]() {
          return this;
        },
        async next() {
          await iterator.next();
          throw new ArtifactReaderFailure(
            "integrity",
            "primary nested member failure",
          );
        },
        async return() {
          returned.push("nested");
          await iterator.return?.();
          return { done: true as const, value: undefined };
        },
      };
    },
  );
  const reader: ArtifactReader = {
    format: "directory",
    entries(signal): AsyncIterableIterator<ArtifactEntry> {
      const iterator = directory.entries(signal)[Symbol.asyncIterator]();
      return {
        [Symbol.asyncIterator]() {
          return this;
        },
        next: () => iterator.next(),
        async return() {
          returned.push("root");
          await iterator.return?.();
          throw new Error("root iterator cleanup failed");
        },
      };
    },
    open: (entry, signal) => directory.open(entry, signal),
    provenance: () => [],
    close: () => directory.close(),
  };

  const failure = await resourceScope
    .run(() =>
      scanCanonicalArtifactInventoryInScope(
        bundle,
        { resourceScope },
        () => reader,
      ),
    )
    .catch((cause: unknown) => cause);
  expect(failure).toMatchObject({
    reason: "integrity",
    message: "primary nested member failure",
    cleanup: {
      reason: "root iterator cleanup failed",
      resources: ["artifact traversal for directory"],
    },
  });
  expect(returned).toEqual(["nested", "root"]);
});
