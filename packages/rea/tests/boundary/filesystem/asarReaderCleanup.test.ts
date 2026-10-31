import { fstatSync } from "node:fs";
import {
  lstat,
  mkdir,
  open as openFile,
  type FileHandle,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";

import { createPackage } from "@electron/asar";
import { describe, expect, it } from "vitest";

import { AsarArtifactReader } from "../../../src/artifacts/AsarArtifactReader.js";
import { withVerifierCleanup } from "../../../scripts/lib/verifier-cleanup.mjs";
import { awaitAcknowledgement } from "../../fixtures/lifecycleAcknowledgement.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

const CONTENT = "module.exports = 'owned';\n";

const createArchive = async (content = CONTENT) => {
  const root = await createTestTempDirectory("rea-asar-reader-cleanup-");
  const source = join(root, "source");
  const archive = join(root, "fixture.asar");
  await mkdir(source);
  await writeFile(join(source, "main.js"), content);
  await createPackage(source, archive);
  return { archive };
};

type OpenedHandle = { readonly path: string; readonly fd: number };
type ReaderHooks = {
  readonly beforeAdoption?: (path: string, handle: FileHandle) => Promise<void>;
  readonly close?: (handle: FileHandle) => Promise<void>;
};

const createTrackedReader = (archive: string, hooks: ReaderHooks = {}) => {
  const opened: OpenedHandle[] = [];
  const reader = new AsarArtifactReader(archive, {
    openFile: async (path, flags) => {
      const handle = await openFile(path, flags);
      opened.push({ path, fd: handle.fd });
      await hooks.beforeAdoption?.(path, handle);
      return {
        get fd() {
          return handle.fd;
        },
        stat: () => handle.stat(),
        read: handle.read.bind(handle),
        close: () => hooks.close?.(handle) ?? handle.close(),
      };
    },
  });
  return { reader, opened };
};

const packedMember = async (reader: AsarArtifactReader) => {
  for await (const entry of reader.entries())
    if (entry.path === "main.js") return entry;
  throw new Error("Expected packed ASAR member");
};

const latestHandle = (opened: readonly OpenedHandle[]): OpenedHandle => {
  const handle = opened.at(-1);
  if (handle === undefined)
    throw new Error("Expected a descriptor for the packed member");
  return handle;
};

const openPackedMember = async (
  reader: AsarArtifactReader,
  opened: readonly OpenedHandle[],
) => {
  const output = await reader.open(await packedMember(reader));
  const handle = latestHandle(opened);
  return { output, handle, root: dirname(handle.path) };
};

const expectDescriptorOpen = (fd: number): void => {
  expect(fstatSync(fd).isFile()).toBe(true);
};

const expectDescriptorClosed = (fd: number): void => {
  expect(() => fstatSync(fd)).toThrow();
};

const expectSnapshotRemoved = async (
  fd: number,
  root: string,
): Promise<void> => {
  expectDescriptorClosed(fd);
  await expect(lstat(root)).rejects.toMatchObject({ code: "ENOENT" });
};

describe("ASAR reader cleanup", () => {
  it("reaps an unread packed member and its snapshot when the reader closes", async () => {
    const { archive } = await createArchive();
    const { reader, opened } = createTrackedReader(archive);

    try {
      const {
        output,
        handle: memberHandle,
        root,
      } = await openPackedMember(reader, opened);
      expect(memberHandle.path).toContain("rea-asar-snapshot-");
      expectDescriptorOpen(memberHandle.fd);
      expect(output.destroyed).toBe(false);

      await reader.close();

      await expectSnapshotRemoved(memberHandle.fd, root);
    } finally {
      await reader.close();
    }
  });

  it("retains the snapshot and facts after a failed close, then retries cleanup", async () => {
    const { archive } = await createArchive();
    let failNextClose = false;
    const closeFailure = Object.assign(new Error("injected close failure"), {
      code: "EIO",
      errno: -5,
      syscall: "close",
    });
    const { reader, opened } = createTrackedReader(archive, {
      close: async (handle) => {
        if (failNextClose) {
          failNextClose = false;
          throw closeFailure;
        }
        await handle.close();
      },
    });

    try {
      const { handle: memberHandle, root } = await openPackedMember(
        reader,
        opened,
      );
      failNextClose = true;

      await expect(reader.close()).rejects.toMatchObject({
        cleanup: { resources: [memberHandle.path] },
      });
      expectDescriptorOpen(memberHandle.fd);
      expect((await lstat(root)).isDirectory()).toBe(true);
      expect(await packedMember(reader)).toMatchObject({ path: "main.js" });

      await reader.close();

      await expectSnapshotRemoved(memberHandle.fd, root);
    } finally {
      await reader.close();
    }
  });

  it("closes a member handle adopted while reader shutdown is queued", async () => {
    const { archive } = await createArchive();
    let pauseMemberOpen = false;
    let memberOpenReached!: () => void;
    let releaseMemberOpen!: () => void;
    const memberOpenStarted = new Promise<void>((resolve) => {
      memberOpenReached = resolve;
    });
    const memberOpenGate = new Promise<void>((resolve) => {
      releaseMemberOpen = resolve;
    });
    const { reader, opened } = createTrackedReader(archive, {
      beforeAdoption: async (path) => {
        if (pauseMemberOpen && path.includes("rea-asar-snapshot-")) {
          pauseMemberOpen = false;
          memberOpenReached();
          await memberOpenGate;
        }
      },
    });

    let opening: ReturnType<typeof reader.open> | undefined;
    let closing: ReturnType<typeof reader.close> | undefined;
    await withVerifierCleanup(async () => {
      const entry = await packedMember(reader);
      pauseMemberOpen = true;
      opening = reader.open(entry);
      await awaitAcknowledgement(memberOpenStarted, opening, "member open");
      closing = reader.close();
      releaseMemberOpen();
      const output = await opening;
      const memberHandle = latestHandle(opened);
      const root = dirname(memberHandle.path);

      await closing;

      expect(output.destroyed).toBe(true);
      await expectSnapshotRemoved(memberHandle.fd, root);
    }, [
      releaseMemberOpen,
      async () => {
        await opening;
      },
      async () => {
        await closing;
      },
      () => reader.close(),
    ]);
  });
});

describe("ASAR preparation cleanup", () => {
  it("retains a zero-byte member handle when its first close fails", async () => {
    const { archive } = await createArchive("");
    let failNextClose = false;
    const { reader, opened } = createTrackedReader(archive, {
      close: async (handle) => {
        if (failNextClose) {
          failNextClose = false;
          throw new Error("empty member close denied");
        }
        await handle.close();
      },
    });
    try {
      const entry = await packedMember(reader);
      failNextClose = true;
      await expect(reader.open(entry)).rejects.toMatchObject({
        cleanup: {
          reason: "empty member close denied",
          resources: [expect.any(String)],
        },
      });
      const handle = latestHandle(opened);
      expectDescriptorOpen(handle.fd);
      expect((await lstat(dirname(handle.path))).isDirectory()).toBe(true);
      await reader.close();
      await expectSnapshotRemoved(handle.fd, dirname(handle.path));
    } finally {
      await reader.close();
    }
  });

  it("preserves a malformed header failure when closing its handle also fails", async () => {
    const { archive } = await createArchive();
    await writeFile(archive, Buffer.alloc(16));
    let failHeaderClose = false;
    const closeFailure = new Error("header close denied");
    const { reader, opened } = createTrackedReader(archive, {
      beforeAdoption: async (path) => {
        if (path !== archive) failHeaderClose = true;
      },
      close: async (handle) => {
        if (failHeaderClose) {
          failHeaderClose = false;
          throw closeFailure;
        }
        await handle.close();
      },
    });
    try {
      await expect(packedMember(reader)).rejects.toMatchObject({
        reason: "format",
        message: "ASAR header has invalid Pickle extents",
        cleanup: {
          reason: closeFailure.message,
          resources: [expect.any(String)],
        },
      });
      const handle = latestHandle(opened);
      expectDescriptorOpen(handle.fd);
      expect((await lstat(dirname(handle.path))).isDirectory()).toBe(true);
      await reader.close();
      await expectSnapshotRemoved(handle.fd, dirname(handle.path));
    } finally {
      await reader.close();
    }
  });
});

it("forwards cancellation of an unconsumed packed member and closes its exact descriptor", async () => {
  const { archive } = await createArchive();
  const { reader, opened } = createTrackedReader(archive);
  try {
    const entry = await packedMember(reader);
    const controller = new AbortController();
    const output = await reader.open(entry, controller.signal);
    const descriptor = latestHandle(opened);
    const failed = new Promise<Error>((resolve) =>
      output.once("error", resolve),
    );
    controller.abort(null);
    await expect(failed).resolves.toMatchObject({
      reason: "cancelled",
      cancellation: { reason: null },
    });
    await reader.close();
    expectDescriptorClosed(descriptor.fd);
  } finally {
    await reader.close();
  }
});

it.each(["snapshot", "member"])(
  "preserves %s read failure when caller cancellation arrives during that read",
  async (stage) => {
    const { archive } = await createArchive();
    const controller = new AbortController();
    const failure = Object.assign(
      new Error("controlled ASAR native read failure"),
      { code: "EIO", errno: -5, syscall: "read" },
    );
    let active = stage === "snapshot";
    const { reader, opened } = createTrackedReader(archive, {
      beforeAdoption: async (_path, handle) => {
        if (active)
          handle.read = (async () => {
            controller.abort(null);
            throw failure;
          }) as FileHandle["read"];
      },
    });
    try {
      const consume = async () => {
        if (stage === "snapshot") {
          for await (const _entry of reader.entries(controller.signal)) {
            /* failure precedes admission */
          }
        } else {
          const entry = await packedMember(reader);
          active = true;
          const source = await reader.open(entry, controller.signal);
          for await (const _chunk of source) {
            /* failure precedes bytes */
          }
        }
      };
      await expect(consume()).rejects.toMatchObject({
        reason: "io",
        cause: failure,
      });
      await reader.close();
      for (const handle of opened) expectDescriptorClosed(handle.fd);
    } finally {
      await reader.close();
    }
  },
);
