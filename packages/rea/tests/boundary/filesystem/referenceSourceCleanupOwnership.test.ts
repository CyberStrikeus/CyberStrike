import {
  mkdir,
  open as fsOpen,
  opendir as fsOpendir,
  writeFile,
  type FileHandle,
} from "node:fs/promises";
import { join } from "node:path";
import type { Dirent } from "node:fs";

import { afterEach, beforeEach, expect, it, onTestFinished, vi } from "vitest";

import { ArtifactResourceScope } from "../../../src/artifacts/ArtifactResourceScope.js";
import { importReferenceSource } from "../../../src/application/ReferenceSourceImport.js";
import { readReferenceSource } from "../../../src/reference/ReferenceSourceReader.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { err, ok } from "../../../src/domain/result.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    open: vi.fn(actual.open),
    opendir: vi.fn(actual.opendir),
  };
});

const openMock = vi.mocked(fsOpen);
const opendirMock = vi.mocked(fsOpendir);
let actual: typeof import("node:fs/promises");

interface DirectoryOperations {
  read(): Promise<Dirent | null>;
  close(): Promise<void>;
}

beforeEach(async () => {
  actual =
    await vi.importActual<typeof import("node:fs/promises")>(
      "node:fs/promises",
    );
  openMock.mockImplementation((...args) => actual.open(...args));
  opendirMock.mockImplementation((...args) => actual.opendir(...args));
});

afterEach(() => {
  openMock.mockReset();
  opendirMock.mockReset();
});

it.each([
  ["refusal", false],
  ["refusal", true],
  ["cancel-after-policy", false],
  ["cancel-after-policy", true],
  ["refusal-late-cancel", true],
] as const)(
  "owns directory cleanup before policy %s (close fails=%s)",
  async (outcome, closeFails) => {
    const root = await createTestTempDirectory("rea-reference-policy-owner-");
    await writeFile(join(root, "unexamined.ts"), "export const value = 1;\n");
    const resources = new ArtifactResourceScope();
    onTestFinished(() => resources.close().catch(() => undefined));
    const controller = new AbortController();
    const reason = new Error("cancelled at the policy boundary");
    const policyCause = new Error("scoped policy read failed");
    const closeFailure = new Error("directory close rejected after policy");
    let closeCalls = 0;
    let readCalls = 0;
    opendirMock.mockImplementation(async (...args) => {
      const directory = await actual.opendir(...args);
      const operations: DirectoryOperations = directory;
      const read = operations.read.bind(directory);
      vi.spyOn(operations, "read").mockImplementation(async () => {
        readCalls += 1;
        return read();
      });
      const close = operations.close.bind(directory);
      vi.spyOn(operations, "close").mockImplementation(async () => {
        closeCalls += 1;
        if (outcome === "refusal-late-cancel") controller.abort(reason);
        await close();
        if (closeFails) throw closeFailure;
      });
      return directory;
    });
    const result = await readReferenceSource(root, resources, {
      signal: controller.signal,
      beforeDirectory: async () => {
        expect(opendirMock).toHaveBeenCalledTimes(1);
        if (outcome === "cancel-after-policy") {
          controller.abort(reason);
          return ok(undefined);
        }
        return err({
          tag: "reference-source-reader",
          code: "io",
          message: "Scoped policy could not be read",
          cause: policyCause,
        });
      },
    });
    if (result.ok) throw new Error("Policy outcome was ignored");
    expect(result.error.code).toBe(
      outcome === "cancel-after-policy" ? "cancelled" : "io",
    );
    if (outcome !== "cancel-after-policy") {
      expect(result.error.message).toBe("Scoped policy could not be read");
      expect(result.error.cause).toBe(policyCause);
    }
    expect(result.error.partial).toMatchObject({ entries: [], bytesRead: 0 });
    expect(readCalls).toBe(0);
    expect(openMock).not.toHaveBeenCalled();
    expect(closeCalls).toBe(1);
    expect(resources.hasPending).toBe(closeFails);
    if (closeFails) {
      expect(result.error.cleanup).toEqual({
        resources: [root],
        reason: expect.stringContaining(closeFailure.message),
      });
      await expect(resources.close()).rejects.toMatchObject({
        cleanup: { resources: [root] },
      });
    } else {
      expect(result.error.cleanup).toBeUndefined();
      await resources.close();
    }
    expect(closeCalls).toBe(1);
  },
);

it("preserves admission EIO and retains an invalidated failed-close owner", async () => {
  const root = await createTestTempDirectory("rea-reference-admission-owner-");
  const file = join(root, "source.ts");
  await writeFile(file, "export const answer = 42;\n");
  const resources = new ArtifactResourceScope();
  onTestFinished(() => resources.close().catch(() => undefined));
  const statFailure = Object.assign(new Error("injected admission EIO"), {
    code: "EIO",
  });
  const closeFailure = new Error("native close rejected after invalidation");
  let closeCalls = 0;

  openMock.mockImplementation(async (...args) => {
    const handle = await actual.open(...args);
    vi.spyOn(handle, "stat").mockRejectedValueOnce(statFailure);
    const close = handle.close.bind(handle);
    vi.spyOn(handle, "close").mockImplementation(async () => {
      closeCalls += 1;
      await close();
      throw closeFailure;
    });
    return handle;
  });

  const result = await readReferenceSource(root, resources);
  expect(result).toMatchObject({
    ok: false,
    error: {
      tag: "reference-source-reader",
      code: "io",
      message: expect.stringContaining("EIO"),
      cleanup: {
        resources: [file],
        reason: expect.stringContaining(closeFailure.message),
      },
      partial: {
        entries: [
          {
            status: "failed",
            kind: "file",
            path: "source.ts",
            code: "io",
            message: expect.stringContaining("EIO"),
          },
        ],
      },
    },
  });
  expect(closeCalls).toBe(1);

  await expect(resources.close()).rejects.toMatchObject({
    cleanup: {
      resources: [file],
      reason: expect.stringContaining(closeFailure.message),
    },
  });
  expect(closeCalls).toBe(1);
});

const assertSourceCleanupRetry = async (enclosingGit: boolean) => {
  const workspace = await createTestTempDirectory("rea-reference-file-owner-");
  const root = join(workspace, "source");
  await mkdir(root);
  if (enclosingGit) {
    const gitDirectory = join(workspace, ".git");
    await mkdir(gitDirectory);
    await writeFile(
      join(gitDirectory, "HEAD"),
      "0123456789abcdef0123456789abcdef01234567\n",
    );
  }
  const file = join(root, "source.ts");
  const bytes = "export const answer = 'retained';\n";
  await writeFile(file, bytes);
  const resources = new ArtifactResourceScope();
  const closeFailure = new Error("injected close before native close");
  let allowClose = false;
  onTestFinished(async () => {
    allowClose = true;
    await resources.close().catch(() => undefined);
  });
  let closeCalls = 0;
  let openCalls = 0;
  let sourceHandle: FileHandle | undefined;

  openMock.mockImplementation(async (...args) => {
    if (args[0] !== file) return actual.open(...args);
    openCalls += 1;
    const handle = await actual.open(...args);
    sourceHandle = handle;
    const close = handle.close.bind(handle);
    vi.spyOn(handle, "close").mockImplementation(async () => {
      closeCalls += 1;
      if (!allowClose) throw closeFailure;
      await close();
    });
    return handle;
  });

  const first = await importReferenceSource(
    {
      root,
      caller: "reference-source-cleanup-owner-test",
      policy: { secretPatterns: [] },
    },
    resources,
  );
  expect(first).toMatchObject({
    ok: false,
    error: {
      code: "io",
      cleanup: {
        resources: [file],
        reason: expect.stringContaining(closeFailure.message),
      },
      partial: {
        entries: [
          {
            status: "read",
            kind: "file",
            path: "source.ts",
            bytes: Buffer.from(bytes),
          },
        ],
        bytesRead: Buffer.byteLength(bytes),
      },
    },
  });
  expect(openCalls).toBe(1);
  expect(closeCalls).toBe(1);
  expect(sourceHandle?.fd).toBeGreaterThanOrEqual(0);

  const blocked = await readReferenceSource(root, resources);
  expect(blocked).toMatchObject({
    ok: false,
    error: {
      code: "io",
      cleanup: { resources: [file] },
    },
  });
  expect(openCalls).toBe(1);
  expect(closeCalls).toBe(2);
  expect(sourceHandle?.fd).toBeGreaterThanOrEqual(0);

  allowClose = true;
  await resources.close();
  expect(openCalls).toBe(1);
  expect(closeCalls).toBe(3);
  expect(sourceHandle?.fd).toBe(-1);
};

it.each([false, true])(
  "retains partial file bytes and retries the same live owner before new work (enclosing Git repository: %s)",
  assertSourceCleanupRetry,
);

it("preserves a directory read failure when closing that directory also fails", async () => {
  const root = await createTestTempDirectory(
    "rea-reference-directory-read-owner-",
  );
  const file = join(root, "source.ts");
  const bytes = "observed before directory EIO\n";
  await writeFile(file, bytes);
  const resources = new ArtifactResourceScope();
  onTestFinished(() => resources.close().catch(() => undefined));
  const readFailure = Object.assign(new Error("injected directory EIO"), {
    code: "EIO",
  });
  const closeFailure = new Error("directory close rejected after invalidation");
  let readCalls = 0;
  let closeCalls = 0;

  opendirMock.mockImplementation(async (...args) => {
    const directory = await actual.opendir(...args);
    const operations: DirectoryOperations = directory;
    const read = operations.read.bind(directory);
    vi.spyOn(operations, "read").mockImplementation(async () => {
      if (readCalls++ > 0) throw readFailure;
      return read();
    });
    const close = operations.close.bind(directory);
    vi.spyOn(operations, "close").mockImplementation(async () => {
      closeCalls += 1;
      await close();
      throw closeFailure;
    });
    return directory;
  });

  const result = await readReferenceSource(root, resources);
  if (result.ok) throw new Error("Directory and cleanup failures were ignored");
  expect(result).toMatchObject({
    ok: false,
    error: {
      code: "io",
      message: expect.stringContaining(readFailure.message),
      cleanup: {
        resources: [root],
        reason: expect.stringContaining(closeFailure.message),
      },
      partial: {
        bytesRead: Buffer.byteLength(bytes),
      },
    },
  });
  expect(result.error.partial?.entries).toContainEqual(
    expect.objectContaining({
      status: "read",
      kind: "file",
      path: "source.ts",
      bytes: Buffer.from(bytes),
    }),
  );
  expect(result.error.partial?.rootFailure).toEqual({
    code: "io",
    message: expect.stringContaining(readFailure.message),
  });
  expect(closeCalls).toBe(1);

  await expect(resources.close()).rejects.toMatchObject({
    cleanup: {
      resources: [root],
      reason: expect.stringContaining(closeFailure.message),
    },
  });
  expect(closeCalls).toBe(1);
});

it("keeps cancelled traversal typed when native directory close rejects after invalidation", async () => {
  const root = await createTestTempDirectory("rea-reference-directory-owner-");
  await mkdir(join(root, "child"));
  const resources = new ArtifactResourceScope();
  onTestFinished(() => resources.close().catch(() => undefined));
  const controller = new AbortController();
  const closeFailure = new Error("native directory close rejected");
  let closeCalls = 0;
  let openedPath: string | undefined;

  opendirMock.mockImplementation(async (...args) => {
    const directory = await actual.opendir(...args);
    const operations: DirectoryOperations = directory;
    openedPath = String(args[0]);
    const read = operations.read.bind(directory);
    vi.spyOn(operations, "read").mockImplementation(async () => {
      const child = await read();
      if (child !== null) controller.abort();
      return child;
    });
    const close = operations.close.bind(directory);
    vi.spyOn(operations, "close").mockImplementation(async () => {
      closeCalls += 1;
      await close();
      throw closeFailure;
    });
    return directory;
  });

  const result = await readReferenceSource(root, resources, {
    signal: controller.signal,
  });
  expect(result).toMatchObject({
    ok: false,
    error: {
      code: "cancelled",
      cleanup: {
        resources: [root],
        reason: expect.stringContaining(closeFailure.message),
      },
      partial: { entries: [] },
    },
  });
  expect(openedPath).toBe(root);
  expect(closeCalls).toBe(1);

  await expect(resources.close()).rejects.toMatchObject({
    cleanup: {
      resources: [root],
      reason: expect.stringContaining(closeFailure.message),
    },
  });
  expect(closeCalls).toBe(1);
});
