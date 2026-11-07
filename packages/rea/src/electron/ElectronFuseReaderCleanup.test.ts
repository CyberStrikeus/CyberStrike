import { ArtifactFileCleanupFailure } from "../artifacts/ArtifactFileOperation.js";
import { parseEvidence } from "../domain/evidence.js";
import { fstatSync } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AnalysisAccessDeniedError } from "../domain/analysisErrorCore.js";
import { AnalysisCancelledError } from "../domain/analysisErrorCore.js";
import { RegularFileCleanupFailure } from "../filesystem/OwnedRegularFile.js";
import { createTestTempDirectory } from "../../tests/fixtures/temporaryDirectory.js";
import { elfFuseImage } from "../../tests/fixtures/electron/fuseImage.js";
import { ElectronFuseProvider } from "./ElectronFuseProvider.js";
import { readElectronFuseImage } from "./ElectronFuseReader.js";

const { mockOpen } = vi.hoisted(() => ({ mockOpen: vi.fn() }));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, open: mockOpen };
});

const actualFs =
  await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");

const openedHandles: FileHandle[] = [];
const originalCloses = new Map<FileHandle, () => Promise<void>>();

const passthroughOpen = (path: unknown, ...rest: unknown[]) =>
  (actualFs.open as (...args: unknown[]) => Promise<FileHandle>)(path, ...rest);

beforeEach(() => {
  mockOpen.mockImplementation(passthroughOpen);
});

/**
 * Route open() through the real filesystem but fault the returned handle for
 * one target path: reads can be made to fail with a primary error while the
 * final close rejects, mirroring issue #4658's controlled reproduction.
 */
const armFaults = (
  target: string,
  faults: {
    readonly readFailure?: unknown;
    readonly closeFailure: unknown;
    readonly onClose?: () => void;
  },
) => {
  mockOpen.mockImplementation(
    async (path: unknown, ...rest: unknown[]): Promise<FileHandle> => {
      const handle = await passthroughOpen(path, ...rest);
      if (String(path) === target) {
        originalCloses.set(handle, handle.close.bind(handle));
        if (faults.readFailure !== undefined) {
          const readFailure = faults.readFailure;
          handle.read = (async () => {
            throw readFailure;
          }) as unknown as FileHandle["read"];
        }
        const closeFailure = faults.closeFailure;
        handle.close = (async () => {
          faults.onClose?.();
          throw closeFailure;
        }) as unknown as FileHandle["close"];
        openedHandles.push(handle);
      }
      return handle;
    },
  );
};

afterEach(async () => {
  mockOpen.mockReset();
  for (const handle of openedHandles) {
    try {
      await originalCloses.get(handle)?.();
    } catch {
      // The handle is already closed or the faulted close left it unusable.
    }
  }
  openedHandles.length = 0;
  originalCloses.clear();
});

const writeElfImage = async (root: string, name: string): Promise<string> => {
  const path = join(root, name);
  const image = elfFuseImage([1, 1]);
  await actualFs.writeFile(path, image.bytes);
  return path;
};

/**
 * Walk the error cause graph for the retained cleanup failure. The provider
 * reports cleanup through nested AggregateError causes, so a direct `.cause`
 * read cannot reach it.
 */
const findRegularFileCleanupFailure = (
  error: unknown,
): RegularFileCleanupFailure | undefined => {
  const seen = new Set<unknown>();
  const queue: unknown[] = [error];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === null || typeof current !== "object" || seen.has(current))
      continue;
    seen.add(current);
    if (current instanceof RegularFileCleanupFailure) return current;
    const nested = current as { errors?: unknown[]; cause?: unknown };
    if (Array.isArray(nested.errors)) queue.push(...nested.errors);
    if (nested.cause !== undefined) queue.push(nested.cause);
  }
  return undefined;
};

describe("electron fuse final-close failures", () => {
  it("keeps the primary read error when the final close rejects", async () => {
    const root = await createTestTempDirectory("rea-fuse-close-fault-");
    const path = await writeElfImage(root, "app.elf");
    const readFailure = Object.assign(new Error("physical read failure"), {
      code: "EIO",
    });
    const closeFailure = Object.assign(
      new Error("close rejected; descriptor still live"),
      { code: "EACCES" },
    );
    armFaults(path, { readFailure, closeFailure });

    const caught = await readElectronFuseImage(path).catch(
      (error: unknown) => error,
    );

    expect(caught).toBeInstanceOf(ArtifactFileCleanupFailure);
    if (!(caught instanceof ArtifactFileCleanupFailure)) throw caught;
    expect(caught.cleanupLease.released).toBe(false);
    const failure = caught.fileCleanupFailure;
    // The close rejection must not replace the primary read error.
    expect(failure).toBeInstanceOf(RegularFileCleanupFailure);
    if (!(failure instanceof RegularFileCleanupFailure))
      throw new Error("Expected a RegularFileCleanupFailure");
    expect(failure.outcome.kind).toBe("failed");
    if (failure.outcome.kind !== "failed")
      throw new Error("Expected the read outcome to be retained");
    expect(failure.outcome.cause).toBe(readFailure);
    expect(failure.cleanupCause).toBe(closeFailure);
    // Ownership of the still-live descriptor is retained, not dropped.
    expect(failure.owner.handle).toBe(openedHandles[0]);
    expect(() => fstatSync(openedHandles[0]?.fd ?? -1)).not.toThrow();
  });

  it("reports incomplete cleanup instead of a read permission failure when only the close fails", async () => {
    const root = await createTestTempDirectory("rea-fuse-cleanup-report-");
    const path = await writeElfImage(root, "app.elf");
    const closeFailure = Object.assign(
      new Error("close rejected; descriptor still live"),
      { code: "EACCES" },
    );
    armFaults(path, { closeFailure });

    const result = await new ElectronFuseProvider().inspect({ path });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected an error result");
    // A close failure with errno EACCES must not surface as a read denial.
    expect(result.error).not.toBeInstanceOf(AnalysisAccessDeniedError);
    expect(result.error.cleanupIncomplete).toBe(true);
    expect(result.error.cleanupResources).toContain(path);
  });

  it("reads normally when the final close succeeds", async () => {
    const root = await createTestTempDirectory("rea-fuse-close-ok-");
    const path = await writeElfImage(root, "app.elf");

    const image = await readElectronFuseImage(path);

    expect(image.format).toBe("elf");
    expect(image.slices).toHaveLength(1);
  });

  it("reports the primary read diagnostic with incomplete cleanup when read and close both fail", async () => {
    const root = await createTestTempDirectory("rea-fuse-combined-fault-");
    const path = await writeElfImage(root, "app.elf");
    const readFailure = Object.assign(new Error("physical read failure"), {
      code: "EIO",
    });
    const closeFailure = Object.assign(
      new Error("close rejected; descriptor still live"),
      { code: "EACCES" },
    );
    armFaults(path, { readFailure, closeFailure });

    const result = await new ElectronFuseProvider().inspect({ path });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected an error result");
    // The close errno must not replace the original read classification.
    expect(result.error).not.toBeInstanceOf(AnalysisAccessDeniedError);
    expect(result.error.cleanupIncomplete).toBe(true);
    expect(result.error.cleanupResources).toContain(path);
    expect(JSON.stringify(result.error.diagnostics)).toContain(
      "physical read failure",
    );
    // Ownership of the still-live descriptor is retained in the cause chain.
    const cleanupFailure = findRegularFileCleanupFailure(result.error);
    expect(cleanupFailure?.owner.handle).toBe(openedHandles[0]);
  });

  it("keeps incomplete cleanup and the descriptor owner when cancellation races the faulted close", async () => {
    const root = await createTestTempDirectory("rea-fuse-cancel-close-");
    const path = await writeElfImage(root, "app.elf");
    const controller = new AbortController();
    const abortReason = new Error("test abort during final close");
    const closeFailure = Object.assign(
      new Error("close rejected; descriptor still live"),
      { code: "EACCES" },
    );
    // Synchronize the abort with the finalization boundary itself: the abort
    // fires inside the faulted close, so no fixed delay is involved.
    armFaults(path, {
      closeFailure,
      onClose: () => controller.abort(abortReason),
    });

    const result = await new ElectronFuseProvider().inspect(
      { path },
      { signal: controller.signal },
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected an error result");
    // Typed cancellation composed with the incomplete-cleanup report instead
    // of a bare cancellation that would drop the descriptor owner.
    const aggregate = result.error.cause as AggregateError | undefined;
    expect(aggregate).toBeInstanceOf(AggregateError);
    expect(aggregate?.errors[0]).toBeInstanceOf(AnalysisCancelledError);
    expect((aggregate?.errors[0] as Error | undefined)?.cause).toBe(
      abortReason,
    );
    expect(result.error.cleanupIncomplete).toBe(true);
    expect(result.error.cleanupResources).toContain(path);
    const cleanupFailure = findRegularFileCleanupFailure(result.error);
    expect(cleanupFailure?.owner.handle).toBe(openedHandles[0]);
    expect(() => fstatSync(openedHandles[0]?.fd ?? -1)).not.toThrow();
  });

  it("retains the completed fuse evidence as a partial observation when only the close fails", async () => {
    const root = await createTestTempDirectory("rea-fuse-partial-evidence-");
    const path = await writeElfImage(root, "app.elf");
    const closeFailure = Object.assign(
      new Error("close rejected; descriptor still live"),
      { code: "EACCES" },
    );
    armFaults(path, { closeFailure });

    const result = await new ElectronFuseProvider().inspect({ path });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected an error result");
    expect(result.error.cleanupIncomplete).toBe(true);
    // The successfully read fuse evidence survives as an explicitly partial
    // observation instead of being discarded with the report.
    const partial = result.error.partialObservation;
    expect(partial).toBeDefined();
    expect(parseEvidence(partial)).toMatchObject({
      provider: { id: "electron-fuses" },
      subject: { local_path: path },
      normalized_result: {
        artifact: { selected_path: path, resolved_path: path },
        slices: [{ sentinel_count: 1 }],
      },
    });
  });
});

describe("electron fuse read failure precedence", () => {
  it("preserves an earlier read failure when cancellation arrives during failed close", async () => {
    const root = await createTestTempDirectory("rea-fuse-read-cancel-close-");
    const path = await writeElfImage(root, "app.elf");
    const controller = new AbortController();
    const readFailure = Object.assign(
      new Error("primary read failed before cancellation"),
      {
        code: "EIO",
      },
    );
    const closeFailure = Object.assign(new Error("final close failed"), {
      code: "EACCES",
    });
    armFaults(path, {
      readFailure,
      closeFailure,
      onClose: () => controller.abort(new Error("late close cancellation")),
    });

    const result = await new ElectronFuseProvider().inspect(
      { path },
      { signal: controller.signal },
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected an error result");
    expect(result.error.cleanupIncomplete).toBe(true);
    expect(result.error.cleanupResources).toContain(path);
    expect(JSON.stringify(result.error.diagnostics)).toContain(
      readFailure.message,
    );
    const aggregate = result.error.cause as AggregateError;
    expect(aggregate).toBeInstanceOf(AggregateError);
    expect(aggregate.errors[0]).not.toBeInstanceOf(AnalysisCancelledError);
    const retained = findRegularFileCleanupFailure(result.error);
    expect(retained?.outcome).toEqual({ kind: "failed", cause: readFailure });
    expect(retained?.cleanupCause).toBe(closeFailure);
    expect(retained?.owner.handle).toBe(openedHandles[0]);
    expect(() => fstatSync(openedHandles[0]?.fd ?? -1)).not.toThrow();
  });
});
