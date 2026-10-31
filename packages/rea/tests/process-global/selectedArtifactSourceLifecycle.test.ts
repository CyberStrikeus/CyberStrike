import { createHash } from "node:crypto";
import type { Stats } from "node:fs";
import {
  mkdir,
  open,
  rename,
  writeFile,
  type FileHandle,
} from "node:fs/promises";
import { join } from "node:path";
import { buffer } from "node:stream/consumers";
import { setImmediate } from "node:timers/promises";
import { afterEach, expect, it, vi } from "vitest";

import { ArtifactFileSource } from "../../src/artifacts/ArtifactFileSource.js";
import * as artifactHash from "../../src/artifacts/ArtifactHash.js";
import {
  ArtifactReaderFailure,
  type ArtifactEntry,
} from "../../src/artifacts/ArtifactReader.js";
import { MachOSliceArtifactReader } from "../../src/artifacts/MachOSliceArtifactReader.js";
import {
  CPU,
  fatImage,
  machoImage,
} from "../../src/artifacts/apple/MachoImage.fixture.js";
import * as regularFile from "../../src/filesystem/RegularFile.js";
import { createDeferred } from "../fixtures/binarySession.js";
import { awaitAcknowledgement } from "../fixtures/lifecycleAcknowledgement.js";
import { NativeFixtureRunner } from "../fixtures/nativeCommands.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";

interface OpenControl {
  path: string | undefined;
  readonly handles: Map<FileHandle, () => Promise<void>>;
  onOpen: ((handle: FileHandle) => Promise<void>) | undefined;
}

const control = vi.hoisted((): OpenControl => ({
  path: undefined,
  handles: new Map(),
  onOpen: undefined,
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...original,
    open: async (...args: Parameters<typeof original.open>) => {
      const handle = await original.open(...args);
      if (String(args[0]) === control.path) {
        control.handles.set(handle, handle.close.bind(handle));
        await control.onOpen?.(handle);
      }
      return handle;
    },
  };
});

afterEach(async () => {
  control.onOpen = undefined;
  for (const [handle, close] of control.handles)
    if (handle.fd >= 0) await close();
  control.handles.clear();
  control.path = undefined;
  vi.restoreAllMocks();
});

const machoCarrier = async () => {
  const root = await createTestTempDirectory("rea-selected-artifact-source-");
  const selected = join(root, "selected");
  await mkdir(selected);
  const path = join(selected, "universal.bin");
  const x86 = Buffer.from(machoImage({ cpu: CPU.x86_64 }));
  const arm = Buffer.from(machoImage({ cpu: CPU.arm64 }));
  const bytes = Buffer.from(
    fatImage([
      { cpu: CPU.x86_64, bytes: x86 },
      { cpu: CPU.arm64, bytes: arm },
    ]),
  );
  await writeFile(path, bytes);
  control.path = path;
  const runner = new NativeFixtureRunner({
    lipo: `architecture x86_64\n cputype 16777223\n cpusubtype 3\n offset 4096\n size ${x86.length}\n align 2^12 (4096)\narchitecture arm64\n cputype 16777228\n cpusubtype 0\n offset 8192\n size ${arm.length}\n align 2^12 (4096)\n`,
  });
  return {
    path,
    root,
    selected,
    runner,
    arm,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
};

const entries = async (
  reader: MachOSliceArtifactReader,
): Promise<ArtifactEntry[]> => {
  const values: ArtifactEntry[] = [];
  for await (const entry of reader.entries()) values.push(entry);
  return values;
};

const openedHandle = (): FileHandle => {
  expect(control.handles.size).toBe(1);
  const handle = control.handles.keys().next().value;
  if (handle === undefined)
    throw new Error("Missing selected carrier descriptor");
  return handle;
};

const replaceSelectedDirectory = async (
  fixture: Awaited<ReturnType<typeof machoCarrier>>,
) => {
  await rename(fixture.selected, join(fixture.root, "original"));
  await mkdir(fixture.selected);
  await writeFile(fixture.path, "replacement selected carrier");
};

const expectDescriptorUnchanged = async (
  handle: FileHandle,
  initial: Stats,
) => {
  expect(await handle.stat()).toMatchObject({
    dev: initial.dev,
    ino: initial.ino,
    size: initial.size,
    mode: initial.mode,
    mtimeMs: initial.mtimeMs,
    ctimeMs: initial.ctimeMs,
  });
};

it("joins late Mach-O admission before releasing its descriptor and dispatches no lipo after closure", async () => {
  const fixture = await machoCarrier();
  const entered = createDeferred<void>();
  const release = createDeferred<void>();
  control.onOpen = async (handle) => {
    vi.spyOn(handle, "close");
    entered.resolve();
    await release.promise;
  };
  const run = vi.spyOn(fixture.runner, "run");
  const reader = new MachOSliceArtifactReader(fixture.path, {}, fixture.runner);
  const operations: Promise<unknown>[] = [];
  try {
    const operation = entries(reader);
    const reading = operation.catch((cause: unknown) => cause);
    operations.push(reading);
    await awaitAcknowledgement(entered.promise, operation, "Mach-O admission");
    const handle = openedHandle();
    let closed = false;
    const closings = [reader.close(), reader.close()];
    operations.push(...closings);
    const closing = Promise.all(closings).then(() => {
      closed = true;
    });
    operations.push(closing);
    await setImmediate();
    expect(closed).toBe(false);
    expect(handle.fd).toBeGreaterThanOrEqual(0);
    expect(handle.close).not.toHaveBeenCalled();
    release.resolve();
    expect(await reading).toMatchObject({ reason: "unavailable" });
    await closing;
    expect(handle.fd).toBe(-1);
    expect(handle.close).toHaveBeenCalledOnce();
    await expect(entries(reader)).rejects.toMatchObject({
      reason: "unavailable",
    });
    expect(run).not.toHaveBeenCalled();
    expect(control.handles.size).toBe(1);
    await reader.close();
    expect(handle.close).toHaveBeenCalledOnce();
  } finally {
    release.resolve();
    await Promise.allSettled(operations);
    await reader.close();
  }
});

it("retains the same Mach-O descriptor through a denied close and concurrent cleanup retry", async () => {
  const fixture = await machoCarrier();
  const failure = new Error("controlled Mach-O close denial");
  let blocked = true;
  control.onOpen = async (handle) => {
    const close = handle.close.bind(handle);
    vi.spyOn(handle, "close").mockImplementation(async () => {
      if (blocked) throw failure;
      await close();
    });
  };
  const reader = new MachOSliceArtifactReader(fixture.path, {}, fixture.runner);
  try {
    expect((await entries(reader)).map((entry) => entry.path)).toEqual([
      "slices/x86_64",
      "slices/arm64",
    ]);
    const handle = openedHandle();
    expect(await Promise.allSettled([reader.close(), reader.close()])).toEqual([
      { status: "rejected", reason: failure },
      { status: "rejected", reason: failure },
    ]);
    expect(handle.fd).toBeGreaterThanOrEqual(0);
    expect(handle.close).toHaveBeenCalledOnce();
    blocked = false;
    await Promise.all([reader.close(), reader.close()]);
    expect(handle.fd).toBe(-1);
    expect(handle.close).toHaveBeenCalledTimes(2);
    await reader.close();
    expect(handle.close).toHaveBeenCalledTimes(2);
    expect(control.handles.size).toBe(1);
  } finally {
    blocked = false;
    await reader.close();
  }
});

it("reads admitted Mach-O slice bytes and leaves the borrowed descriptor open after close", async () => {
  const fixture = await machoCarrier();
  const handle = await open(fixture.path, "r");
  const close = vi.spyOn(handle, "close");
  let reader: MachOSliceArtifactReader | undefined;
  try {
    reader = new MachOSliceArtifactReader(fixture.path, {}, fixture.runner, {
      handle,
      initial: await handle.stat(),
    });
    const entry = (await entries(reader)).find(
      (value) => value.path === "slices/arm64",
    );
    if (entry === undefined) throw new Error("Missing authored ARM64 slice");
    expect(await buffer(await reader.open(entry))).toEqual(fixture.arm);
    await reader.close();
    await reader.close();
    expect(close).not.toHaveBeenCalled();
    expect(handle.fd).toBeGreaterThanOrEqual(0);
    expect(control.handles.size).toBe(1);
    await handle.close();
    expect(close).toHaveBeenCalledOnce();
    expect(handle.fd).toBe(-1);
  } finally {
    try {
      await reader?.close();
    } finally {
      if (handle.fd >= 0) await handle.close();
    }
  }
});

it("rejects a replaced selected pathname without closing the borrowed Mach-O descriptor", async () => {
  const fixture = await machoCarrier();
  const handle = await open(fixture.path, "r");
  const close = vi.spyOn(handle, "close");
  const run = vi.spyOn(fixture.runner, "run");
  let reader: MachOSliceArtifactReader | undefined;
  try {
    const initial = await handle.stat();
    reader = new MachOSliceArtifactReader(fixture.path, {}, fixture.runner, {
      handle,
      initial,
    });
    const entry = (await entries(reader)).find(
      (value) => value.path === "slices/arm64",
    );
    if (entry === undefined) throw new Error("Missing authored ARM64 slice");
    await replaceSelectedDirectory(fixture);
    await expectDescriptorUnchanged(handle, initial);
    await expect(reader.open(entry)).rejects.toMatchObject({
      reason: "integrity",
    });
    await expect(entries(reader)).rejects.toMatchObject({
      reason: "integrity",
    });
    expect(run).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledWith(
      "lipo",
      ["-detailed_info", fixture.path],
      {},
    );
    await reader.close();
    expect(close).not.toHaveBeenCalled();
    expect(handle.fd).toBeGreaterThanOrEqual(0);
    expect(control.handles.size).toBe(1);
  } finally {
    try {
      await reader?.close();
    } finally {
      if (handle.fd >= 0) await handle.close();
    }
  }
});

it.each([false, true])(
  "rejects selected pathname replacement after real hashing even with a late abort (%s)",
  async (abort) => {
    const fixture = await machoCarrier();
    const completed = createDeferred<void>();
    const release = createDeferred<void>();
    const controller = new AbortController();
    const originalHash = artifactHash.hashReadable;
    vi.spyOn(artifactHash, "hashReadable").mockImplementation(
      async (...args) => {
        const hashed = await originalHash(...args);
        expect(hashed.sha256).toBe(fixture.sha256);
        completed.resolve();
        await release.promise;
        return hashed;
      },
    );
    const source = new ArtifactFileSource(fixture.path, "Selected carrier");
    let binding: Promise<unknown> | undefined;
    try {
      const operation = source.bindSelectedPathSha256(
        fixture.sha256,
        controller.signal,
      );
      binding = operation.catch((cause: unknown) => cause);
      await awaitAcknowledgement(
        completed.promise,
        operation,
        "selected carrier hash",
      );
      const handle = openedHandle();
      const initial = await handle.stat();
      await replaceSelectedDirectory(fixture);
      await expectDescriptorUnchanged(handle, initial);
      if (abort)
        controller.abort({ request: "cancel after completed carrier hash" });
      release.resolve();
      const failure = await binding;
      if (!(failure instanceof ArtifactReaderFailure))
        throw new Error("Expected a selected-path identity failure");
      expect(failure.reason).toBe("integrity");
      expect(failure.message).toBe(
        `Selected carrier source identity changed: ${fixture.path}`,
      );
      expect(failure.cancellation).toBeUndefined();
      await source.close();
      expect(handle.fd).toBe(-1);
    } finally {
      release.resolve();
      await binding;
      await source.close();
    }
  },
);

it.each([false, true])(
  "preserves typed admission identity failure and its exact cleanup owner (closeFails=%s)",
  async (closeFails) => {
    const fixture = await machoCarrier();
    const changed = new regularFile.RegularFileChangedError(fixture.path);
    const cleanupFailure = new Error(
      "controlled changed-admission close denial",
    );
    let blocked = closeFails;
    control.onOpen = async (handle) => {
      vi.spyOn(handle, "stat").mockRejectedValueOnce(changed);
      const close = handle.close.bind(handle);
      vi.spyOn(handle, "close").mockImplementation(async () => {
        if (blocked) throw cleanupFailure;
        await close();
      });
    };
    const run = vi.spyOn(fixture.runner, "run");
    const reader = new MachOSliceArtifactReader(
      fixture.path,
      {},
      fixture.runner,
    );
    try {
      const failure = await entries(reader).catch((cause: unknown) => cause);
      if (!(failure instanceof ArtifactReaderFailure))
        throw new Error("Expected a typed admission identity failure");
      expect(failure.reason).toBe("integrity");
      const primary = closeFails ? failure.cause : failure;
      if (!(primary instanceof ArtifactReaderFailure))
        throw new Error("Missing the primary admission identity failure");
      expect(primary.cause).toBe(changed);
      const handle = openedHandle();
      if (closeFails) {
        expect(failure.cleanup).toEqual({
          reason: cleanupFailure.message,
          resources: [fixture.path],
        });
        expect(handle.fd).toBeGreaterThanOrEqual(0);
        await expect(reader.close()).rejects.toBe(cleanupFailure);
        expect(handle.close).toHaveBeenCalledTimes(2);
        blocked = false;
        await reader.close();
        expect(handle.close).toHaveBeenCalledTimes(3);
      } else {
        expect(failure.cleanup).toBeUndefined();
        await reader.close();
        expect(handle.close).toHaveBeenCalledOnce();
      }
      expect(handle.fd).toBe(-1);
      expect(run).not.toHaveBeenCalled();
      expect(control.handles.size).toBe(1);
    } finally {
      blocked = false;
      await reader.close();
    }
  },
);
