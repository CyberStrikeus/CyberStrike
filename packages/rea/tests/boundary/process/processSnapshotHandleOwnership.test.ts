import { createHash } from "node:crypto";
import { Dir, type Dirent } from "node:fs";
import { mkdir, mkdtemp, open, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, expect, it, vi } from "vitest";

const injected = vi.hoisted(() => ({
  filePath: "",
  fileCloseFailure: undefined as Error | undefined,
  fileCloseRejectionEnabled: false,
  fileCloseRejection: undefined as unknown,
  fileStatFailure: undefined as Error | undefined,
  openedPaths: [] as string[],
  abortOnClose: undefined as (() => void) | undefined,
  abortOnStat: undefined as (() => void) | undefined,
  directoryPath: "",
  directoryCloseFailure: undefined as Error | undefined,
  fileHandle: undefined as Awaited<ReturnType<typeof open>> | undefined,
  restoreFileHandle: undefined as (() => void) | undefined,
  nativeFileClose: undefined as (() => Promise<void>) | undefined,
  nativeFileStat: undefined as
    | (() => Promise<Awaited<ReturnType<typeof stat>>>)
    | undefined,
  directory: undefined as Dir | undefined,
  nativeDirectoryClose: undefined as
    | ((callback: (error?: NodeJS.ErrnoException | null) => void) => void)
    | undefined,
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...original,
    open: async (...args: Parameters<typeof original.open>) => {
      const handle = await original.open(...args);
      const path = String(args[0]);
      injected.openedPaths.push(path);
      const statFailure = injected.fileStatFailure;
      if (path !== injected.filePath) return handle;
      const nativeClose = handle.close.bind(handle);
      const nativeStat = handle.stat.bind(handle);
      if (path === injected.filePath) {
        injected.fileHandle = handle;
        injected.nativeFileClose = nativeClose;
        injected.nativeFileStat = nativeStat;
        injected.restoreFileHandle = () => {
          handle.close = nativeClose;
          handle.stat = nativeStat as typeof handle.stat;
        };
      }
      handle.close = async () => {
        injected.abortOnClose?.();
        if (path === injected.filePath && injected.fileCloseRejectionEnabled)
          throw injected.fileCloseRejection;
        const currentCloseFailure = injected.fileCloseFailure;
        if (currentCloseFailure !== undefined) throw currentCloseFailure;
        await nativeClose();
      };
      if (statFailure !== undefined)
        handle.stat = async () => {
          injected.abortOnStat?.();
          throw statFailure;
        };
      return handle;
    },
    opendir: async (...args: Parameters<typeof original.opendir>) => {
      const directory = await original.opendir(...args);
      if (args[0] === injected.directoryPath) injected.directory = directory;
      return directory;
    },
  };
});

import { AnalysisCleanupLease } from "../../../src/artifacts/AnalysisCleanupLease.js";
import { processScenarioSchema } from "../../../src/domain/process/processScenario.js";
import {
  hashFile,
  snapshotRoots,
  ProcessCaptureSnapshotFailure,
} from "../../../src/process/capture/FilesystemSnapshot.js";
import { ProcessCaptureReadFailure } from "../../../src/process/capture/ProcessCaptureRead.js";
import { ProcessCaptureResourceScope } from "../../../src/process/capture/ProcessCaptureLifecycle.js";

const roots: string[] = [];
const trackedRoot = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), "rea-snapshot-handle-owner-"));
  roots.push(root);
  return root;
};

type DirectoryReadCallback = (
  error: NodeJS.ErrnoException | null,
  value: Dirent | null,
) => void;
type DirectoryCloseCallback = (error?: NodeJS.ErrnoException | null) => void;

const scenarioFor = (root: string) =>
  processScenarioSchema.parse({
    executable: process.execPath,
    working_directory: root,
    filesystem_observation_paths: [root],
  });

const expectSnapshotFailure = (cause: unknown) => {
  expect(cause).toBeInstanceOf(Error);
  expect(cause).toMatchObject({
    cleanupLeases: expect.any(Array),
  });
  const failure = cause as Error & {
    cleanupIncomplete: boolean;
    snapshot?: {
      files: readonly { path: string; type?: string; sha256?: string | null }[];
      truncated?: boolean;
      completeRoots?: readonly string[];
      coverage?: { enumeration_truncated?: boolean };
    };
    cleanupLeases: readonly AnalysisCleanupLease[];
  };
  expect(failure.cleanupLeases.length).toBeGreaterThan(0);
  expect(failure.cleanupLeases[0]).toBeInstanceOf(AnalysisCleanupLease);
  return failure;
};

afterEach(async () => {
  if (injected.fileHandle !== undefined) {
    injected.restoreFileHandle?.();
    if (injected.fileHandle.fd >= 0 && injected.nativeFileClose !== undefined) {
      try {
        await injected.nativeFileClose();
      } catch (cause: unknown) {
        if (
          injected.fileHandle.fd >= 0 ||
          !(cause instanceof Error && "code" in cause && cause.code === "EBADF")
        )
          throw cause;
      }
    }
  }
  injected.fileHandle = undefined;
  injected.restoreFileHandle = undefined;
  injected.nativeFileClose = undefined;
  injected.nativeFileStat = undefined;
  injected.filePath = "";
  injected.fileCloseFailure = undefined;
  injected.fileCloseRejectionEnabled = false;
  injected.fileCloseRejection = undefined;
  injected.fileStatFailure = undefined;
  injected.openedPaths = [];
  injected.abortOnClose = undefined;
  injected.abortOnStat = undefined;
  injected.directoryPath = "";
  injected.directoryCloseFailure = undefined;
  injected.directory = undefined;
  const closeDirectory = injected.nativeDirectoryClose;
  injected.nativeDirectoryClose = undefined;
  if (closeDirectory !== undefined) {
    await new Promise<void>((resolve, reject) => {
      try {
        closeDirectory((error) => {
          if (
            error !== undefined &&
            error !== null &&
            error.code !== "ERR_DIR_CLOSED"
          ) {
            reject(error);
          } else {
            resolve();
          }
        });
      } catch (cause: unknown) {
        reject(cause);
      }
    });
  }
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

it("retains a completed file hash and its exact descriptor owner when close fails", async () => {
  const root = await trackedRoot();
  const path = join(root, "input");
  const bytes = "retained file bytes";
  await writeFile(path, bytes);
  injected.filePath = path;
  injected.fileCloseFailure = new Error("injected file close denial");

  let cause: unknown;
  try {
    await snapshotRoots(scenarioFor(path));
  } catch (error: unknown) {
    cause = error;
  }

  expect(cause).not.toBe(injected.fileCloseFailure);
  const failure = expectSnapshotFailure(cause);
  expect(failure.cause).toBe(injected.fileCloseFailure);
  expect(failure.snapshot?.files).toEqual([
    expect.objectContaining({
      path: "root_0:.",
      type: "file",
      sha256: createHash("sha256").update(bytes).digest("hex"),
    }),
  ]);
  const [lease] = failure.cleanupLeases;
  expect(lease).toBeDefined();
  if (lease === undefined) throw new Error("file cleanup lease missing");
  await expect(injected.nativeFileStat?.()).resolves.toMatchObject({
    isFile: expect.any(Function),
  });
  injected.fileCloseFailure = undefined;
  await lease.release();
  expect(lease.released).toBe(true);
  await expect(injected.nativeFileStat?.()).rejects.toMatchObject({
    code: "EBADF",
  });
});

it("exposes a completed direct hash outcome while retaining its failed descriptor close", async () => {
  const root = await trackedRoot();
  const path = join(root, "input");
  const bytes = "direct hash outcome bytes";
  await writeFile(path, bytes);
  injected.filePath = path;
  injected.fileCloseFailure = new Error("injected direct hash close denial");
  const scope = new ProcessCaptureResourceScope();
  let cause: unknown;
  try {
    await hashFile(path, await stat(path), 1024, undefined, scope);
  } catch (error: unknown) {
    cause = error;
  }

  expect(cause).toBeInstanceOf(ProcessCaptureReadFailure);
  const failure = cause as ProcessCaptureReadFailure<{
    readonly state: "hashed";
    readonly sha256: string;
  }>;
  expect(failure.outcome).toEqual({
    kind: "completed",
    value: {
      state: "hashed",
      sha256: createHash("sha256").update(bytes).digest("hex"),
    },
  });
  expect(failure.cleanupCause).toBe(injected.fileCloseFailure);
  expect(failure.cleanupLeases).toHaveLength(1);
  await expect(scope.retryCleanup()).rejects.toMatchObject({
    cleanupIncomplete: true,
  });
  injected.fileCloseFailure = undefined;
  await scope.retryCleanup();
  expect(failure.cleanupIncomplete).toBe(false);
  await expect(injected.nativeFileStat?.()).rejects.toMatchObject({
    code: "EBADF",
  });
  await scope.close();
});

it("preserves a primary file stat failure when descriptor close also fails", async () => {
  const root = await trackedRoot();
  const path = join(root, "input");
  await writeFile(path, "retained file bytes");
  const primary = new Error("injected file stat failure");
  injected.filePath = path;
  injected.fileStatFailure = primary;
  injected.fileCloseFailure = new Error("injected file close denial");

  let cause: unknown;
  try {
    await snapshotRoots(scenarioFor(path));
  } catch (error: unknown) {
    cause = error;
  }

  expect(cause).not.toBe(injected.fileCloseFailure);
  const failure = expectSnapshotFailure(cause);
  expect(failure.cause).toBe(primary);
  expect(failure.cleanupLeases).toHaveLength(1);
  expect(failure.snapshot).toMatchObject({
    files: [],
    truncated: true,
    completeRoots: [],
    coverage: { enumeration_truncated: true },
  });
  const [lease] = failure.cleanupLeases;
  expect(lease).toBeDefined();
  if (lease === undefined) throw new Error("file cleanup lease missing");
  injected.fileCloseFailure = undefined;
  await lease.release();
  expect(lease.released).toBe(true);
  await expect(injected.nativeFileStat?.()).rejects.toMatchObject({
    code: "EBADF",
  });
});

it("keeps the physical file error primary when cancellation arrives during failed close", async () => {
  const root = await trackedRoot();
  const path = join(root, "input");
  await writeFile(path, "primary file and close cancellation");
  const primary = new Error("injected physical file stat failure");
  const reason = new Error("cancel during final file close");
  injected.filePath = path;
  injected.fileStatFailure = primary;
  injected.fileCloseFailure = new Error("injected file close denial");
  const controller = new AbortController();
  injected.abortOnClose = () => controller.abort(reason);
  const scope = new ProcessCaptureResourceScope();
  let cause: unknown;
  try {
    await hashFile(path, await stat(path), 1024, controller.signal, scope);
  } catch (error: unknown) {
    cause = error;
  }

  expect(cause).toBeInstanceOf(ProcessCaptureReadFailure);
  const failure = cause as ProcessCaptureReadFailure<unknown>;
  expect(failure.cause).toBe(primary);
  expect(failure.outcome).toMatchObject({ kind: "failed", cause: primary });
  expect(failure.cleanupCause).toBe(injected.fileCloseFailure);
  expect(failure.userCategory).toBeUndefined();
  expect(failure.cleanupIncomplete).toBe(true);
  expect(failure.cleanupLeases).toHaveLength(1);
  await expect(scope.retryCleanup()).rejects.toMatchObject({
    cleanupIncomplete: true,
  });
  expect(failure.cause).toBe(primary);
  expect(failure.cleanupIncomplete).toBe(true);

  injected.fileCloseFailure = undefined;
  injected.abortOnClose = undefined;
  await scope.retryCleanup();
  expect(failure.cause).toBe(primary);
  expect(failure.cleanupIncomplete).toBe(false);
  await scope.close();
});

it("keeps a completed file hash in the partial snapshot when cancellation arrives during close", async () => {
  const root = await trackedRoot();
  const first = join(root, "a-first");
  const second = join(root, "b-not-visited");
  const firstBytes = "completed before final-close cancellation";
  await writeFile(first, firstBytes);
  await writeFile(second, "not visited after cancellation");
  injected.filePath = first;
  injected.fileCloseFailure = new Error(
    "injected close failure after cancellation",
  );
  const controller = new AbortController();
  const reason = new Error("cancel during snapshot file close");
  injected.abortOnClose = () => controller.abort(reason);
  const scope = new ProcessCaptureResourceScope();
  let cause: unknown;
  try {
    await scope.run(() =>
      snapshotRoots(scenarioFor(root), controller.signal, undefined, {
        cleanup: scope,
      }),
    );
  } catch (error: unknown) {
    cause = error;
  }

  expect(cause).toBeInstanceOf(ProcessCaptureSnapshotFailure);
  const failure = cause as ProcessCaptureSnapshotFailure;
  expect(failure.cause).toBe(reason);
  expect(failure.userCategory).toBe("cancelled");
  expect(failure.snapshot).toMatchObject({
    truncated: true,
    completeRoots: [],
    coverage: { enumeration_truncated: true },
  });
  expect(failure.snapshot?.files).toContainEqual(
    expect.objectContaining({
      path: "root_0:a-first",
      sha256: createHash("sha256").update(firstBytes).digest("hex"),
    }),
  );
  expect(failure.snapshot?.files).not.toContainEqual(
    expect.objectContaining({ path: "root_0:b-not-visited" }),
  );
  expect(failure.cleanupLeases).toHaveLength(1);
  expect(failure.cleanupIncomplete).toBe(true);

  injected.fileCloseFailure = undefined;
  injected.abortOnClose = undefined;
  await scope.retryCleanup();
  expect(failure.cleanupIncomplete).toBe(false);
  await scope.close();
});

it("keeps a completed file hash when cancellation arrives during confirmed close", async () => {
  const root = await trackedRoot();
  const first = join(root, "a-first");
  const second = join(root, "b-not-visited");
  const firstBytes = "completed before confirmed-close cancellation";
  await writeFile(first, firstBytes);
  await writeFile(second, "not visited after cancellation");
  injected.filePath = first;
  const controller = new AbortController();
  const reason = new Error("cancel during confirmed snapshot file close");
  injected.abortOnClose = () => controller.abort(reason);
  const scope = new ProcessCaptureResourceScope();
  let cause: unknown;
  try {
    await scope.run(() =>
      snapshotRoots(scenarioFor(root), controller.signal, undefined, {
        cleanup: scope,
      }),
    );
  } catch (error: unknown) {
    cause = error;
  }

  expect(cause).toBeInstanceOf(ProcessCaptureSnapshotFailure);
  const failure = cause as ProcessCaptureSnapshotFailure;
  expect(failure.cause).toBe(reason);
  expect(failure.userCategory).toBe("cancelled");
  expect(failure.snapshot).toMatchObject({
    truncated: true,
    completeRoots: [],
    coverage: { enumeration_truncated: true },
  });
  expect(failure.snapshot?.files).toContainEqual(
    expect.objectContaining({
      path: "root_0:a-first",
      sha256: createHash("sha256").update(firstBytes).digest("hex"),
    }),
  );
  expect(failure.cleanupLeases).toEqual([]);
  expect(failure.cleanupIncomplete).toBe(false);
  await scope.close();
});

it.each([
  { label: "undefined", rejection: undefined },
  { label: "string", rejection: "injected non-Error close rejection" },
])(
  "keeps cleanup incomplete for a $label descriptor close rejection",
  async ({ rejection }) => {
    const root = await trackedRoot();
    const path = join(root, "input");
    await writeFile(path, "non-Error close rejection bytes");
    injected.filePath = path;
    injected.fileCloseRejectionEnabled = true;
    injected.fileCloseRejection = rejection;
    const scope = new ProcessCaptureResourceScope();
    let cause: unknown;
    try {
      await snapshotRoots(scenarioFor(path), undefined, undefined, {
        cleanup: scope,
      });
    } catch (error: unknown) {
      cause = error;
    }

    expect(cause).toBeInstanceOf(ProcessCaptureSnapshotFailure);
    const failure = cause as ProcessCaptureSnapshotFailure;
    expect(failure.readFailures[0]?.outcome.kind).toBe("completed");
    expect(failure.readFailures[0]?.cleanupCause).toBe(rejection);
    if (typeof rejection === "string")
      expect(failure.message).toContain(rejection);
    expect(failure.cleanupIncomplete).toBe(true);
    expect(failure.cleanupLeases).toHaveLength(1);
    await expect(scope.retryCleanup()).rejects.toMatchObject({
      cleanupIncomplete: true,
    });
    expect(failure.cleanupIncomplete).toBe(true);

    injected.fileCloseRejectionEnabled = false;
    await scope.retryCleanup();
    expect(failure.cleanupIncomplete).toBe(false);
    await scope.close();
  },
);

it("retains the full directory snapshot and exact directory owner when close fails", async () => {
  const root = await trackedRoot();
  const child = join(root, "observed");
  await mkdir(child);
  await writeFile(join(child, "payload"), "complete observation");
  injected.directoryPath = child;
  injected.directoryCloseFailure = new Error("injected directory close denial");
  const originalClose = Dir.prototype.close;
  let ownedDirectory: Dir | undefined;
  let nativeClose: ((callback: DirectoryCloseCallback) => void) | undefined;
  function closeWithFailure(this: Dir): Promise<void>;
  function closeWithFailure(this: Dir, callback: DirectoryCloseCallback): void;
  function closeWithFailure(
    this: Dir,
    callback?: DirectoryCloseCallback,
  ): void | Promise<void> {
    const boundClose = originalClose.bind(this);
    if (this !== injected.directory) {
      if (callback !== undefined) return boundClose(callback);
      return new Promise<void>((resolve, reject) =>
        boundClose((error) =>
          error === undefined || error === null ? resolve() : reject(error),
        ),
      );
    }
    ownedDirectory = this;
    nativeClose ??= (done: DirectoryCloseCallback) =>
      originalClose.call(this, done);
    if (callback !== undefined) {
      queueMicrotask(() => callback(injected.directoryCloseFailure));
      return;
    }
    return Promise.reject(injected.directoryCloseFailure);
  }
  Dir.prototype.close = closeWithFailure;
  const scope = new ProcessCaptureResourceScope();
  let cause: unknown;
  try {
    await scope.run(() =>
      snapshotRoots(scenarioFor(root), undefined, undefined, {
        cleanup: scope,
      }),
    );
  } catch (error: unknown) {
    cause = error;
  } finally {
    Dir.prototype.close = originalClose;
    injected.directory = ownedDirectory;
    injected.nativeDirectoryClose = nativeClose;
  }

  expect(cause).not.toBe(injected.directoryCloseFailure);
  const failure = expectSnapshotFailure(cause);
  expect(failure.cause).toBe(injected.directoryCloseFailure);
  expect(failure.snapshot?.files).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ path: "root_0:observed" }),
      expect.objectContaining({ path: "root_0:observed/payload" }),
    ]),
  );
  expect(failure.cleanupLeases).toHaveLength(1);
  await expect(
    scope.run(async () => "unexpected replacement capture"),
  ).rejects.toMatchObject({ cleanupIncomplete: true });
  await expect(scope.close()).rejects.toMatchObject({
    cleanupIncomplete: true,
  });
  expect(failure.cleanupIncomplete).toBe(true);
  expect(failure.cleanupLeases[0]?.released).toBe(false);
  expect(ownedDirectory).toBeDefined();
});

it("preserves a primary directory read failure when final close also fails", async () => {
  const root = await trackedRoot();
  const selected = join(root, "selected");
  await mkdir(selected);
  await writeFile(
    join(selected, "payload"),
    "never visited after read failure",
  );
  injected.directoryPath = selected;
  injected.directoryCloseFailure = new Error("injected directory close denial");
  const primary = new Error("injected directory read failure");
  const originalRead = Dir.prototype.read;
  const originalClose = Dir.prototype.close;
  let ownedDirectory: Dir | undefined;
  let nativeClose: ((callback: DirectoryCloseCallback) => void) | undefined;
  function failRead(this: Dir): Promise<Dirent | null>;
  function failRead(this: Dir, callback: DirectoryReadCallback): void;
  function failRead(
    this: Dir,
    callback?: DirectoryReadCallback,
  ): void | Promise<Dirent | null> {
    if (this !== injected.directory) {
      if (callback !== undefined) return originalRead.call(this, callback);
      return new Promise<Dirent | null>((resolve, reject) =>
        originalRead.call(this, (error, value) =>
          error === null ? resolve(value) : reject(error),
        ),
      );
    }
    if (callback !== undefined) {
      queueMicrotask(() => callback(primary as NodeJS.ErrnoException, null));
      return;
    }
    return Promise.reject(primary);
  }
  function closeWithFailure(this: Dir): Promise<void>;
  function closeWithFailure(this: Dir, callback: DirectoryCloseCallback): void;
  function closeWithFailure(
    this: Dir,
    callback?: DirectoryCloseCallback,
  ): void | Promise<void> {
    const boundClose = originalClose.bind(this);
    if (this !== injected.directory) {
      if (callback !== undefined) return boundClose(callback);
      return new Promise<void>((resolve, reject) =>
        boundClose((error) =>
          error === undefined || error === null ? resolve() : reject(error),
        ),
      );
    }
    ownedDirectory = this;
    nativeClose ??= (done: DirectoryCloseCallback) =>
      originalClose.call(this, done);
    if (callback !== undefined) {
      queueMicrotask(() => callback(injected.directoryCloseFailure));
      return;
    }
    return Promise.reject(injected.directoryCloseFailure);
  }
  Dir.prototype.read = failRead;
  Dir.prototype.close = closeWithFailure;
  let cause: unknown;
  try {
    await snapshotRoots(scenarioFor(selected));
  } catch (error: unknown) {
    cause = error;
  } finally {
    Dir.prototype.read = originalRead;
    Dir.prototype.close = originalClose;
    injected.directory = ownedDirectory;
    injected.nativeDirectoryClose = nativeClose;
  }

  expect(cause).not.toBe(injected.directoryCloseFailure);
  const failure = expectSnapshotFailure(cause);
  expect(failure.cause).toBe(primary);
  expect(failure.snapshot).toMatchObject({
    files: [expect.objectContaining({ path: "root_0:.", type: "directory" })],
    truncated: true,
    completeRoots: [],
    coverage: { enumeration_truncated: true },
  });
  expect(failure.cleanupLeases).toHaveLength(1);
});

it("keeps a later file hash, blocks scope admission on the first file owner, then resumes after retry", async () => {
  const root = await trackedRoot();
  const first = join(root, "a-first");
  const second = join(root, "b-second");
  const firstBytes = "first completed hash";
  const secondBytes = "second completed hash";
  await writeFile(first, firstBytes);
  await writeFile(second, secondBytes);
  injected.filePath = first;
  injected.fileCloseFailure = new Error("injected first file close denial");
  const scope = new ProcessCaptureResourceScope();
  let cause: unknown;
  try {
    await scope.run(() =>
      snapshotRoots(scenarioFor(root), undefined, undefined, {
        cleanup: scope,
      }),
    );
  } catch (error: unknown) {
    cause = error;
  }

  expect(cause).not.toBe(injected.fileCloseFailure);
  const failure = expectSnapshotFailure(cause);
  expect(failure.snapshot?.files).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        path: "root_0:a-first",
        sha256: createHash("sha256").update(firstBytes).digest("hex"),
      }),
      expect.objectContaining({
        path: "root_0:b-second",
        sha256: createHash("sha256").update(secondBytes).digest("hex"),
      }),
    ]),
  );
  expect(failure.cleanupLeases).toHaveLength(1);
  expect(injected.openedPaths).toEqual([first, second]);

  await expect(
    scope.run(() =>
      snapshotRoots(scenarioFor(root), undefined, undefined, {
        cleanup: scope,
      }),
    ),
  ).rejects.toMatchObject({ cleanupIncomplete: true });
  expect(injected.openedPaths).toEqual([first, second]);

  injected.fileCloseFailure = undefined;
  await scope.retryCleanup();
  expect(failure.cleanupIncomplete).toBe(false);
  await expect(
    scope.run(() =>
      snapshotRoots(scenarioFor(root), undefined, undefined, {
        cleanup: scope,
      }),
    ),
  ).resolves.toMatchObject({ files: expect.any(Array) });
  expect(injected.openedPaths).toEqual([first, second, first, second]);
  await scope.close();
});

it("preserves an IO failure that arrives with cancellation before descriptor cleanup", async () => {
  const root = await trackedRoot();
  const path = join(root, "input");
  await writeFile(path, "failed metadata with late cancellation");
  const primary = new Error("physical metadata failure");
  const reason = new Error("cancelled while metadata rejected");
  const controller = new AbortController();
  injected.filePath = path;
  injected.fileStatFailure = primary;
  injected.abortOnStat = () => controller.abort(reason);
  let failure: unknown;
  try {
    await hashFile(path, await stat(path), 1024, controller.signal);
  } catch (cause: unknown) {
    failure = cause;
  }
  expect(failure).toBeInstanceOf(ProcessCaptureReadFailure);
  expect(failure).toMatchObject({
    cause: primary,
    outcome: { kind: "failed", cause: primary },
    cleanupIncomplete: false,
  });
  expect((failure as ProcessCaptureReadFailure).userCategory).toBeUndefined();
  expect((failure as ProcessCaptureReadFailure).cancellation?.reason).toBe(
    reason,
  );
  expect(injected.fileHandle?.fd).toBe(-1);
});

it.each([false, true])(
  "preserves complete root-file coverage after close-time cancellation (close denied: %s)",
  async (denied) => {
    const root = await trackedRoot();
    const path = join(root, "input");
    const bytes = "all selected snapshot facts completed";
    await writeFile(path, bytes);
    injected.filePath = path;
    injected.fileCloseFailure = denied
      ? new Error("close denied after full root read")
      : undefined;
    const controller = new AbortController();
    const reason = new Error("cancelled during final root-file close");
    injected.abortOnClose = () => controller.abort(reason);
    const scope = new ProcessCaptureResourceScope();
    let failure: unknown;
    try {
      await scope.run(() =>
        snapshotRoots(scenarioFor(path), controller.signal, undefined, {
          cleanup: scope,
        }),
      );
    } catch (cause: unknown) {
      failure = cause;
    }
    expect(failure).toBeInstanceOf(ProcessCaptureSnapshotFailure);
    expect(failure).toMatchObject({
      cause: reason,
      userCategory: "cancelled",
      cleanupIncomplete: denied,
      snapshot: {
        truncated: false,
        completeRoots: ["root_0"],
        coverage: { enumeration_truncated: false },
        files: [
          expect.objectContaining({
            sha256: createHash("sha256").update(bytes).digest("hex"),
          }),
        ],
      },
    });
    injected.abortOnClose = undefined;
    injected.fileCloseFailure = undefined;
    await scope.close();
    expect(injected.fileHandle?.fd).toBe(-1);
  },
);
