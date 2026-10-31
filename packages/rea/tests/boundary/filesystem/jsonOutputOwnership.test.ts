import { readdirSync, renameSync, writeFileSync } from "node:fs";
import { mkdir, open, rm } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import * as fs from "node:fs/promises";
import { join } from "node:path";
import { expect, it, vi } from "vitest";

import { ArtifactResourceScope } from "../../../src/artifacts/ArtifactResourceScope.js";
import { AnalysisCancelledError } from "../../../src/domain/analysisErrorCore.js";
import { EvidenceFileError } from "../../../src/domain/evidenceErrors.js";
import { OwnedFileHandle } from "../../../src/filesystem/OwnedFileHandle.js";
import { OwnedStagedOutput } from "../../../src/filesystem/OwnedStagedOutput.js";
import { projectAnalysisError } from "../../../src/domain/analysisErrorProjection.js";
import { writeTextParts } from "../../../src/application/JsonFiles.js";
import { StagedOutputError } from "../../../src/filesystem/StagedOutputError.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

const allocation = vi.hoisted(() => ({
  deferred: false,
  statFailure: false,
  staged: [] as FileHandle[],
}));

// FAT and exFAT on macOS report a placeholder file ID for an empty file and
// assign its cluster-derived ID when the first write allocates storage.
vi.mock("node:fs/promises", async (importOriginal) => {
  const filesystem = await importOriginal<typeof import("node:fs/promises")>();
  const { basename, dirname } = await import("node:path");
  return {
    ...filesystem,
    open: async (...args: Parameters<typeof filesystem.open>) => {
      const handle = await filesystem.open(...args);
      if (
        !(allocation.deferred || allocation.statFailure) ||
        !basename(dirname(String(args[0]))).startsWith(".rea-write-")
      )
        return handle;
      allocation.staged.push(handle);
      const stat = handle.stat.bind(handle);
      handle.stat = (async () => {
        if (allocation.statFailure)
          throw new Error("injected staged descriptor stat failure");
        const stats = await stat();
        if (stats.size === 0) stats.ino = Number.MAX_SAFE_INTEGER;
        return stats;
      }) as typeof handle.stat;
      return handle;
    },
  };
});

it("closes the descriptor and retains staged content when its final identity is unknown", async () => {
  const root = await createTestTempDirectory("rea-json-identity-unknown-");
  const resources = new ArtifactResourceScope();
  const destination = join(root, "unverified.json");
  allocation.statFailure = true;
  allocation.staged = [];
  try {
    const result = await writeTextParts(
      ["owned bytes"],
      destination,
      false,
      resources,
    );
    if (result.ok) throw new Error("Expected unverified publication failure");
    expect(allocation.staged).toHaveLength(1);
    expect(allocation.staged[0]!.fd).toBe(-1);
    expect(result.error).toBeInstanceOf(EvidenceFileError);
    expect(result.error.published).toBeUndefined();
    expect(result.error.cleanupIncomplete).toBe(true);
    expect(result.error.cause).toMatchObject({
      outcome: {
        ok: false,
        error: {
          _tag: "StagedOutputError",
          code: "identity_unverified",
        },
      },
    });
    const stage = result.error.cleanupResources[0];
    if (stage === undefined) throw new Error("Expected retained staging");
    expect(stage).toContain(".rea-write-");
    expect(await fs.readFile(join(stage, "content"), "utf8")).toBe(
      "owned bytes",
    );
    await expect(fs.access(destination)).rejects.toThrow();
    // A closed descriptor cannot re-establish identity, so retry stays incomplete.
    await expect(resources.close()).rejects.toThrow();
    expect(result.error.cleanupIncomplete).toBe(true);
    expect(result.error.cleanupResources).toEqual([stage]);
    expect(await fs.readFile(join(stage, "content"), "utf8")).toBe(
      "owned bytes",
    );
  } finally {
    allocation.statFailure = false;
    allocation.staged = [];
    await resources.close().catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  }
});

it.each([false, true])(
  "publishes when the staged file ID is assigned by its first write (overwrite: %s)",
  async (overwrite) => {
    const root = await createTestTempDirectory("rea-json-deferred-id-");
    const resources = new ArtifactResourceScope();
    const destination = join(root, "bundle.json");
    allocation.deferred = true;
    try {
      if (overwrite) writeFileSync(destination, "previous");
      const result = await writeTextParts(
        ["canonical ", "output"],
        destination,
        overwrite,
        resources,
      );
      if (!result.ok) throw result.error;
      expect(result.value).toEqual({ path: destination, bytes: 16 });
      expect(await fs.readFile(destination, "utf8")).toBe("canonical output");
      expect(requireStages(root)).toEqual([]);
    } finally {
      allocation.deferred = false;
      await resources.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);

it("removes cancelled staging after the first write assigned its file ID", async () => {
  const root = await createTestTempDirectory("rea-json-deferred-cancel-");
  const resources = new ArtifactResourceScope();
  const controller = new AbortController();
  const destination = join(root, "cancelled.json");
  allocation.deferred = true;
  try {
    function* cancelledAfterFirstWrite(): Generator<string> {
      yield "partial";
      controller.abort();
      yield "must not publish";
    }
    const result = await writeTextParts(
      cancelledAfterFirstWrite(),
      destination,
      false,
      resources,
      { signal: controller.signal, operation: "export_evidence_bundle" },
    );
    if (result.ok) throw new Error("Expected cancellation");
    expect(result.error).toBeInstanceOf(AnalysisCancelledError);
    expect(result.error.cleanupIncomplete).toBe(false);
    await expect(fs.access(destination)).rejects.toThrow();
    expect(requireStages(root)).toEqual([]);
  } finally {
    allocation.deferred = false;
    await resources.close();
    await rm(root, { recursive: true, force: true });
  }
});

it("reports committed output when post-publication staging cleanup remains owned", async () => {
  const root = await createTestTempDirectory("rea-json-write-");
  const resources = new ArtifactResourceScope();
  try {
    const result = await writeTextParts(
      stagingPollutingParts(root),
      join(root, "bundle.json"),
      false,
      resources,
    );
    if (result.ok) throw new Error("Expected staged cleanup failure");
    const cleanupResource = result.error.cleanup?.resources[0];
    if (cleanupResource === undefined)
      throw new Error("Expected retained staging resource");
    expect(result.error).toBeInstanceOf(EvidenceFileError);
    expect(result.error.published).toMatchObject({
      path: join(root, "bundle.json"),
      bytes: 16,
    });
    expect(cleanupResource).toContain(".rea-write-");
    expect(projectAnalysisError(result.error)).toMatchObject({
      code: "cleanup_incomplete",
      details: { published: true, published_path: join(root, "bundle.json") },
    });
    expect(await fs.readFile(join(root, "bundle.json"), "utf8")).toBe(
      "canonical output",
    );
    await fs.rm(join(cleanupResource, "unexpected"));
    await resources.close();
    expect(result.error.cleanupIncomplete).toBe(false);
    expect(result.error.cleanupResources).toEqual([]);
    const released = projectAnalysisError(result.error);
    expect(released).toMatchObject({
      code: "execution_failure",
      details: { published: true, published_path: join(root, "bundle.json") },
    });
    expect(released.details).not.toHaveProperty("cleanup");
  } finally {
    await resources.close();
    await rm(root, { recursive: true, force: true });
  }
});

it("preserves cancellation when staging cleanup also fails", async () => {
  const root = await createTestTempDirectory("rea-json-cancel-");
  const resources = new ArtifactResourceScope();
  const controller = new AbortController();
  let unexpected: string | undefined;
  try {
    function* cancelledParts(): Generator<string> {
      const directories = requireStages(root);
      if (directories.length !== 1)
        throw new Error("Expected one staging directory");
      unexpected = join(root, directories[0]!, "unexpected");
      writeFileSync(unexpected, "retain this");
      controller.abort();
      yield "must not publish";
    }
    const result = await writeTextParts(
      cancelledParts(),
      join(root, "cancelled.json"),
      false,
      resources,
      { signal: controller.signal, operation: "export_evidence_bundle" },
    );
    if (result.ok) throw new Error("Expected cancellation");
    expect(result.error).toBeInstanceOf(AnalysisCancelledError);
    expect(result.error.cleanupIncomplete).toBe(true);
    // The caller's exact abort reason stays the cause; the retained staging
    // directory is reported as cleanup state, not as the cancellation cause.
    expect(result.error.cause).toBe(controller.signal.reason);
    expect(result.error.cleanupPrimary).toBeInstanceOf(AnalysisCancelledError);
    expect(result.error.cleanupPrimary).toMatchObject({
      operation: "export_evidence_bundle",
    });
    expect(result.error.cleanupPrimary?.cause).toBe(controller.signal.reason);
    const stages = requireStages(root);
    expect(stages).toHaveLength(1);
    expect(result.error.cleanupResources).toEqual([join(root, stages[0]!)]);
    expect(await fs.readFile(unexpected!, "utf8")).toBe("retain this");
    await expect(fs.access(join(root, "cancelled.json"))).rejects.toThrow();
    await fs.rm(unexpected!);
    await resources.close();
    expect(requireStages(root)).toEqual([]);
    expect(result.error.cleanupIncomplete).toBe(false);
    const released = projectAnalysisError(result.error);
    expect(released).toMatchObject({
      code: "cancelled",
      details: { operation: "export_evidence_bundle", cleanup: "complete" },
    });
    expect(released.details).not.toHaveProperty("resources");
  } finally {
    if (unexpected !== undefined) await fs.rm(unexpected, { force: true });
    await resources.close();
    expect(requireStages(root)).toEqual([]);
    await rm(root, { recursive: true, force: true });
  }
});

it("restores an unpublished write failure once its retained stage is released", async () => {
  const root = await createTestTempDirectory("rea-json-write-retry-");
  const resources = new ArtifactResourceScope();
  const destination = join(root, "failed.json");
  try {
    function* failingParts(): Generator<string> {
      const stage = requireStages(root)[0];
      if (stage === undefined) throw new Error("Expected staging directory");
      writeFileSync(join(root, stage, "unexpected"), "retain this");
      yield "partial";
      throw new Error("injected staged write failure");
    }
    const result = await writeTextParts(
      failingParts(),
      destination,
      false,
      resources,
    );
    if (result.ok) throw new Error("Expected staged write failure");
    expect(result.error).toBeInstanceOf(EvidenceFileError);
    expect(result.error.published).toBeUndefined();
    const stage = result.error.cleanupResources[0];
    if (stage === undefined) throw new Error("Expected retained staging");
    expect(projectAnalysisError(result.error)).toMatchObject({
      code: "cleanup_incomplete",
      details: { cleanup: "incomplete", resources: [stage] },
    });
    await fs.rm(join(stage, "unexpected"));
    await resources.close();
    expect(requireStages(root)).toEqual([]);
    await expect(fs.access(destination)).rejects.toThrow();
    expect(result.error.cleanupIncomplete).toBe(false);
    expect(result.error.cleanupResources).toEqual([]);
    const released = projectAnalysisError(result.error);
    expect(released).toMatchObject({
      code: "execution_failure",
      details: { operation: "write", reason: "io", path: destination },
    });
    expect(released.details).not.toHaveProperty("cleanup");
    expect(released.details).not.toHaveProperty("resources");
  } finally {
    await resources.close().catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  }
});

it("clears an admission retry failure only after every retained owner releases", async () => {
  const root = await createTestTempDirectory("rea-json-admission-retry-");
  const directory = join(root, ".rea-write-owned");
  await mkdir(directory);
  const unexpected = join(directory, "unexpected");
  writeFileSync(unexpected, "retain this");
  const resources = new ArtifactResourceScope();
  try {
    expect(
      await resources.release({
        kind: "staged-output",
        resource: directory,
        output: await OwnedStagedOutput.create(directory),
      }),
    ).toMatchObject({ kind: "failed" });
    const destination = join(root, "next.json");
    const result = await writeTextParts(
      ["unused"],
      destination,
      false,
      resources,
    );
    if (result.ok) throw new Error("Expected admission retry failure");
    expect(result.error).toBeInstanceOf(EvidenceFileError);
    expect(result.error.cleanupResources).toEqual([directory]);
    await expect(fs.access(destination)).rejects.toThrow();
    // A retry that still fails keeps the same exact owner unresolved.
    await expect(resources.retryCleanup()).rejects.toThrow();
    expect(result.error.cleanupIncomplete).toBe(true);
    await fs.rm(unexpected);
    await resources.close();
    await expect(fs.access(directory)).rejects.toThrow();
    expect(result.error.cleanupIncomplete).toBe(false);
    expect(projectAnalysisError(result.error).code).toBe("execution_failure");
  } finally {
    await fs.rm(unexpected, { force: true });
    await resources.close().catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  }
});

it("refuses to publish a staged path replaced after its descriptor opened", async () => {
  const root = await createTestTempDirectory("rea-staged-swap-");
  const resources = new ArtifactResourceScope();
  const destination = join(root, "swapped.json");
  try {
    const result = await writeTextParts(
      replacingStagedParts(root),
      destination,
      false,
      resources,
    );
    if (result.ok) throw new Error("Expected staged identity rejection");
    expect(
      await fs.readFile(join(root, requireStages(root)[0]!, "content"), "utf8"),
    ).toBe("foreign bytes");
    await expect(fs.access(destination)).rejects.toThrow();
    const stage = requireStages(root)[0];
    if (stage !== undefined) {
      const directory = join(root, stage);
      await fs.rm(join(directory, "content"));
      await fs.rename(join(directory, "original"), join(directory, "content"));
    }
  } finally {
    await resources.close();
    await rm(root, { recursive: true, force: true });
  }
});

it("does not invent a staged owner when the supplied scope is closed", async () => {
  const root = await createTestTempDirectory("rea-closed-output-scope-");
  const resources = new ArtifactResourceScope();
  await resources.close();
  const destination = join(root, "closed.json");
  const result = await writeTextParts(
    ["unused"],
    destination,
    false,
    resources,
  );
  if (result.ok) throw new Error("Expected closed-scope admission failure");
  expect(result.error).toBeInstanceOf(EvidenceFileError);
  expect(result.error.cleanupIncomplete).toBe(false);
  expect(result.error.cleanupResources).toEqual([]);
  expect(await fs.readdir(root)).toEqual([]);
});

function stagingPollutingParts(root: string): Iterable<string> {
  return {
    *[Symbol.iterator](): Generator<string> {
      const directories = readdirSync(root);
      const stage = directories.find((entry) =>
        entry.startsWith(".rea-write-"),
      );
      if (stage === undefined) throw new Error("Expected staging directory");
      writeFileSync(join(root, stage, "unexpected"), "retain this");
      yield "canonical output";
    },
  };
}

function replacingStagedParts(root: string): Iterable<string> {
  return {
    *[Symbol.iterator](): Generator<string> {
      const stage = requireStages(root)[0];
      if (stage === undefined) throw new Error("Expected staging directory");
      const content = join(root, stage, "content");
      renameSync(content, join(root, stage, "original"));
      writeFileSync(content, "foreign bytes");
      yield "owned bytes";
    },
  };
}

const requireStages = (root: string): string[] =>
  readdirSync(root).filter((entry) => entry.startsWith(".rea-write-"));

it("retains a failed file close owner and retries before removing its stage", async () => {
  const root = await createTestTempDirectory("rea-staged-close-");
  const directory = join(root, ".rea-write-owned");
  await mkdir(directory);
  const path = join(directory, "content");
  const handle = await open(path, "wx", 0o600);
  const owner = await OwnedStagedOutput.create(directory);
  let closeAttempts = 0;
  const actualClose = handle.close.bind(handle);
  vi.spyOn(handle, "close").mockImplementation(async () => {
    closeAttempts += 1;
    if (closeAttempts === 1) throw new Error("injected close failure");
    await actualClose();
  });
  owner.setFile(new OwnedFileHandle(handle));
  const resources = new ArtifactResourceScope();
  const stagedOwner = {
    kind: "staged-output" as const,
    resource: directory,
    output: owner,
  };
  try {
    expect(await resources.release(stagedOwner)).toMatchObject({
      kind: "failed",
    });
    await resources.close();
    expect(closeAttempts).toBe(2);
    await expect(fs.access(directory)).rejects.toThrow();
  } finally {
    await resources.close();
    await rm(root, { recursive: true, force: true });
  }
});

it("refuses to remove unexpected files from an owned staging directory", async () => {
  const root = await createTestTempDirectory("rea-staged-replaced-");
  const directory = join(root, ".rea-write-owned");
  await mkdir(directory);
  const owner = await OwnedStagedOutput.create(directory);
  const unexpected = join(directory, "unexpected");
  writeFileSync(unexpected, "unowned");
  try {
    await expect(owner.close()).rejects.toMatchObject({
      _tag: "StagedOutputError",
      code: "unexpected_entries",
      detail: { count: 1, entries: "unexpected" },
    });
    expect(await fs.readFile(unexpected, "utf8")).toBe("unowned");
  } finally {
    await fs.rm(unexpected, { force: true });
    await owner.close();
    await rm(root, { recursive: true, force: true });
  }
});

it("keeps unexpected staging names on the publication error", async () => {
  const root = await createTestTempDirectory("rea-staged-public-entries-");
  const destination = join(root, "out.json");
  const resources = new ArtifactResourceScope();
  const close = vi
    .spyOn(OwnedStagedOutput.prototype, "close")
    .mockImplementation(async () => {
      throw new StagedOutputError("unexpected_entries", {
        count: 1,
        entries: "unexpected",
      });
    });
  try {
    const result = await writeTextParts(["{}"], destination, false, resources);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatchObject({
      _tag: "EvidenceFileError",
      diagnostics: {
        code: "unexpected_entries",
        count: 1,
        entries: "unexpected",
      },
    });
  } finally {
    close.mockRestore();
    await resources.close().catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  }
});

it("retains cleanup when its staging directory was renamed", async () => {
  const root = await createTestTempDirectory("rea-staged-renamed-dir-");
  const directory = join(root, ".rea-write-owned");
  const moved = join(root, ".rea-write-moved");
  await mkdir(directory);
  const path = join(directory, "content");
  const handle = await open(path, "wx", 0o600);
  const owner = await OwnedStagedOutput.create(directory);
  owner.setFile(new OwnedFileHandle(handle));
  const resources = new ArtifactResourceScope();
  const stagedOwner = {
    kind: "staged-output" as const,
    resource: directory,
    output: owner,
  };
  try {
    writeFileSync(join(directory, "unexpected"), "retain this");
    expect(await resources.release(stagedOwner)).toMatchObject({
      kind: "failed",
    });
    await fs.rename(directory, moved);
    await expect(resources.close()).rejects.toThrow();
    await fs.rename(moved, directory);
    await rm(join(directory, "unexpected"));
    await expect(resources.close()).resolves.toBeUndefined();
  } finally {
    await resources.close();
    await rm(root, { recursive: true, force: true });
  }
});

it("retains cleanup when owned staged content was renamed", async () => {
  const root = await createTestTempDirectory("rea-staged-renamed-file-");
  const directory = join(root, ".rea-write-owned");
  const content = join(directory, "content");
  const moved = join(directory, "moved-content");
  await mkdir(directory);
  const handle = await open(content, "wx", 0o600);
  const owner = await OwnedStagedOutput.create(directory);
  owner.setFile(new OwnedFileHandle(handle));
  const resources = new ArtifactResourceScope();
  const stagedOwner = {
    kind: "staged-output" as const,
    resource: directory,
    output: owner,
  };
  try {
    await fs.rename(content, moved);
    expect(await resources.release(stagedOwner)).toMatchObject({
      kind: "failed",
    });
    await expect(resources.close()).rejects.toThrow(
      /cleanup remains incomplete/u,
    );
    await fs.rename(moved, content);
    await expect(resources.close()).resolves.toBeUndefined();
  } finally {
    await resources.close();
    await rm(root, { recursive: true, force: true });
  }
});
