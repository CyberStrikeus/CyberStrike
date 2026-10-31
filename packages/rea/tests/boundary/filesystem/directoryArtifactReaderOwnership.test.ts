import { mkdir, rename, writeFile, type FileHandle } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

const controls = vi.hoisted(() => ({
  wrapDirectory: undefined as
    | ((handle: { close(): Promise<void>; readonly path: string }) => void)
    | undefined,
  wrapFile: undefined as
    | ((handle: { close(): Promise<void>; readonly fd: number }) => void)
    | undefined,
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    opendir: async (...args: Parameters<typeof actual.opendir>) => {
      const handle = await actual.opendir(...args);
      controls.wrapDirectory?.(handle);
      return handle;
    },
    open: async (...args: Parameters<typeof actual.open>) => {
      const handle = await actual.open(...args);
      controls.wrapFile?.(handle);
      return handle;
    },
  };
});

import { ArtifactReaderFailure } from "../../../src/artifacts/ArtifactReader.js";
import { DirectoryArtifactReader } from "../../../src/artifacts/DirectoryArtifactReader.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

const makeFixture = async () => {
  const root = await createTestTempDirectory("rea-directory-owner-");
  const file = join(root, "sample.txt");
  await writeFile(file, "directory content\n");
  return { root, file, reader: new DirectoryArtifactReader(root) };
};

afterEach(() => {
  controls.wrapDirectory = undefined;
  controls.wrapFile = undefined;
  vi.restoreAllMocks();
});

describe("DirectoryArtifactReader resource ownership", () => {
  it("rejects descendants after the selected root directory is replaced", async () => {
    const parent = await createTestTempDirectory("rea-directory-replacement-");
    const root = join(parent, "selected");
    await mkdir(root);
    await writeFile(join(root, "sample.txt"), "directory content\n");
    const reader = new DirectoryArtifactReader(root);
    const subdirectory = join(root, "sub");
    await mkdir(subdirectory);
    await writeFile(join(subdirectory, "old.txt"), "original tree\n");
    const movedRoot = join(parent, "original");
    try {
      const entries = reader.entries()[Symbol.asyncIterator]();
      // Root entries follow the filesystem's directory order; descendants are
      // read only after the root is exhausted.
      const rootEntries = [
        (await entries.next()).value?.path,
        (await entries.next()).value?.path,
      ];
      expect(rootEntries.sort()).toEqual(["sample.txt", "sub"]);

      await rename(root, movedRoot);
      await mkdir(root);
      await mkdir(subdirectory);
      await writeFile(join(subdirectory, "new.txt"), "replacement tree\n");
      await expect(entries.next()).rejects.toMatchObject({
        reason: "path",
        message: "Directory traversal escaped or changed its artifact root",
      });
    } finally {
      await reader.close();
    }
  });

  it("closes the exact directory owner on early iterator return", async () => {
    const { reader } = await makeFixture();
    let closeCalls = 0;
    controls.wrapDirectory = (handle) => {
      const close = handle.close.bind(handle);
      handle.close = async () => {
        closeCalls += 1;
        await close();
      };
    };

    try {
      const entries = reader.entries()[Symbol.asyncIterator]();
      expect((await entries.next()).done).toBe(false);
      await entries.return?.();
      expect(closeCalls).toBe(1);
      await reader.close();
      expect(closeCalls).toBe(1);
    } finally {
      await reader.close();
    }
  });

  it("retains an invalidated directory owner after native close rejection", async () => {
    const { reader } = await makeFixture();
    const nativeFailure = new Error("injected native directory close failure");
    let closeCalls = 0;
    controls.wrapDirectory = (handle) => {
      const close = handle.close.bind(handle);
      handle.close = async () => {
        closeCalls += 1;
        await close();
        throw nativeFailure;
      };
    };

    try {
      await expect(async () => {
        for await (const _entry of reader.entries()) {
          // Read through EOF so the explicit owner close runs.
        }
      }).rejects.toMatchObject({
        reason: "io",
        message: expect.stringContaining("close directory"),
      });

      const cleanupFailure = await reader
        .close()
        .catch((cause: unknown) => cause);
      expect(cleanupFailure).toBeInstanceOf(ArtifactReaderFailure);
      expect((cleanupFailure as Error).message).toContain("cleanup failed");
      expect(closeCalls).toBe(1);
      const aggregate = (cleanupFailure as Error & { cause: AggregateError })
        .cause;
      expect(
        aggregate.errors.some(
          (cause) => cause instanceof Error && cause.cause === nativeFailure,
        ),
      ).toBe(true);
    } finally {
      await reader.close().catch(() => undefined);
    }
  });

  it("preserves cancellation while retaining a failed directory close", async () => {
    const { root, reader } = await makeFixture();
    await writeFile(join(root, "second.txt"), "second entry\n");
    const closeFailure = new Error("injected close after cancellation");
    let closeCalls = 0;
    controls.wrapDirectory = (handle) => {
      const close = handle.close.bind(handle);
      handle.close = async () => {
        closeCalls += 1;
        await close();
        throw closeFailure;
      };
    };

    try {
      const controller = new AbortController();
      const entries = reader.entries(controller.signal)[Symbol.asyncIterator]();
      expect((await entries.next()).done).toBe(false);
      controller.abort();
      const failure = await entries.next().catch((cause: unknown) => cause);
      expect(failure).toMatchObject({ reason: "cancelled" });
      expect((failure as ArtifactReaderFailure).cleanup?.resources).toEqual([
        root,
      ]);
      expect(closeCalls).toBe(1);
      await expect(reader.close()).rejects.toMatchObject({ reason: "io" });
      expect(closeCalls).toBe(1);
    } finally {
      await reader.close().catch(() => undefined);
    }
  });
});

describe("DirectoryArtifactReader file handle ownership", () => {
  it("retries an uninvalidated file close through its retained owner", async () => {
    const { reader } = await makeFixture();
    let fileCloseCalls = 0;
    let openedHandle: FileHandle | undefined;
    controls.wrapFile = (handle) => {
      if (handle.fd < 0) return;
      openedHandle = handle as FileHandle;
      const close = handle.close.bind(handle);
      handle.close = async () => {
        fileCloseCalls += 1;
        if (fileCloseCalls === 1) throw new Error("before native close");
        await close();
      };
    };

    try {
      let entry;
      for await (const observed of reader.entries()) {
        if (observed.path === "sample.txt") entry = observed;
      }
      if (entry === undefined)
        throw new Error("fixture file was not inventoried");
      const stream = await reader.open(entry);
      stream.destroy();
      await new Promise<void>((resolve) => stream.once("close", resolve));
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(fileCloseCalls).toBe(1);
      expect(openedHandle?.fd).toBeGreaterThanOrEqual(0);
      await reader.close();
      expect(fileCloseCalls).toBe(2);
      expect(openedHandle?.fd).toBe(-1);
    } finally {
      await reader.close().catch(() => undefined);
    }
  });

  it("maps an aborted positional read to typed cancellation and owner close", async () => {
    const { file, reader } = await makeFixture();
    await writeFile(file, Buffer.alloc(256 * 1024, 0x5a));
    try {
      let entry;
      for await (const observed of reader.entries()) {
        if (observed.path === "sample.txt") entry = observed;
      }
      if (entry === undefined)
        throw new Error("fixture file was not inventoried");
      const controller = new AbortController();
      const stream = await reader.open(entry, controller.signal);
      const closed = new Promise<void>((resolve) =>
        stream.once("close", resolve),
      );
      const outcome = new Promise<unknown>((resolve, reject) => {
        stream.once("error", resolve);
        stream.once("end", () => reject(new Error("read was not cancelled")));
      });
      stream.once("data", () => controller.abort());
      const failure = await outcome;
      expect(failure).toMatchObject({
        name: "ArtifactReaderFailure",
        reason: "cancelled",
      });
      await closed;
      await new Promise<void>((resolve) => setImmediate(resolve));
      await reader.close();
    } finally {
      await reader.close().catch(() => undefined);
    }
  });
});
