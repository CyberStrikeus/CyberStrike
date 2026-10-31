import { createHash } from "node:crypto";
import {
  open,
  readFile,
  rename,
  writeFile,
  type FileHandle,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { text } from "node:stream/consumers";
import { setImmediate } from "node:timers/promises";
import { afterEach, expect, it, vi } from "vitest";

import {
  ArtifactReaderFailure,
  type ArtifactEntry,
  type ArtifactReader,
} from "../../src/artifacts/ArtifactReader.js";
import { ArtifactResourceScope } from "../../src/artifacts/ArtifactResourceScope.js";
import { GodotPckArtifactReader } from "../../src/artifacts/GodotPckArtifactReader.js";
import { NodeSeaArtifactReader } from "../../src/artifacts/NodeSeaArtifactReader.js";
import { nodeSeaElf } from "../../src/artifacts/nodeSea/NodeSea.fixture.js";
import type { StableRegularFileDescriptor } from "../../src/filesystem/RegularFile.js";
import { createDeferred } from "../fixtures/binarySession.js";
import { buildGodotPck } from "../fixtures/godotPck.js";
import { awaitAcknowledgement } from "../fixtures/lifecycleAcknowledgement.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";

interface OpenControl {
  readonly paths: Set<string>;
  readonly handles: Map<FileHandle, () => Promise<void>>;
  onOpen: ((handle: FileHandle, path: string) => Promise<void>) | undefined;
}

const control = vi.hoisted((): OpenControl => ({
  paths: new Set(),
  handles: new Map(),
  onOpen: undefined,
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...original,
    open: async (...args: Parameters<typeof original.open>) => {
      const handle = await original.open(...args);
      const path = String(args[0]);
      if (control.paths.has(path)) {
        control.handles.set(handle, handle.close.bind(handle));
        await control.onOpen?.(handle, path);
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
  control.paths.clear();
  vi.restoreAllMocks();
});

const BODY = "export const artifact = 'retained';\n";
const carriers = [
  {
    name: "Godot PCK",
    bytes: (body = BODY) => buildGodotPck(3, [{ path: "main.js", data: body }]),
    reader: (path: string, admitted?: StableRegularFileDescriptor) =>
      new GodotPckArtifactReader(path, admitted),
  },
  {
    name: "Node SEA",
    bytes: (body = BODY) => nodeSeaElf({ codePath: "main.js", main: body }),
    reader: (path: string, admitted?: StableRegularFileDescriptor) =>
      new NodeSeaArtifactReader(path, admitted),
  },
] as const;

const carrierFile = async (carrier: (typeof carriers)[number]) => {
  const root = await createTestTempDirectory("rea-artifact-source-lifecycle-");
  const path = join(root, "carrier.bin");
  const bytes = carrier.bytes();
  await writeFile(path, bytes);
  control.paths.add(path);
  return { path, sha256: createHash("sha256").update(bytes).digest("hex") };
};

const entries = async (reader: ArtifactReader): Promise<ArtifactEntry[]> => {
  const values: ArtifactEntry[] = [];
  for await (const entry of reader.entries()) values.push(entry);
  return values;
};

const openedHandle = (): FileHandle => {
  const handles = [...control.handles.keys()];
  expect(handles).toHaveLength(1);
  const handle = handles[0];
  if (handle === undefined) throw new Error("Missing admitted descriptor");
  return handle;
};

it.each(carriers)(
  "$name keeps the caller's expected digest and rechecks identity after binding",
  async (carrier) => {
    const { path, sha256 } = await carrierFile(carrier);
    const reader = carrier.reader(path);
    const expected = "0".repeat(64);
    try {
      await reader.prepareContainer(sha256);
      await expect(reader.prepareContainer(expected)).rejects.toMatchObject({
        reason: "integrity",
        details: {
          logicalPath: ".",
          declaredSha256: expected,
          calculatedSha256: sha256,
          unpacked: false,
        },
      });
      await reader.prepareContainer(sha256);
      await writeFile(path, carrier.bytes(BODY.repeat(3)));
      await expect(reader.prepareContainer(sha256)).rejects.toMatchObject({
        reason: "integrity",
        message: `${carrier.name} source identity changed: ${path}`,
      });
    } finally {
      await reader.close();
    }
  },
);

it.each(carriers)(
  "$name joins late admission before close and refuses replacement work",
  async (carrier) => {
    const { path, sha256 } = await carrierFile(carrier);
    const admitted = createDeferred<void>();
    const release = createDeferred<void>();
    control.onOpen = async (handle) => {
      vi.spyOn(handle, "close");
      admitted.resolve();
      await release.promise;
    };
    const reader = carrier.reader(path);
    const operations: Promise<unknown>[] = [];
    let closed = false;
    try {
      const preparing = reader.prepareContainer(sha256);
      operations.push(preparing);
      await awaitAcknowledgement(
        admitted.promise,
        preparing,
        "carrier admission",
      );
      const handle = openedHandle();
      const closeAttempts = [reader.close(), reader.close()];
      operations.push(...closeAttempts);
      const closing = Promise.all(closeAttempts).then(() => {
        closed = true;
      });
      operations.push(closing);
      await setImmediate();
      expect(closed).toBe(false);
      expect(handle.fd).toBeGreaterThanOrEqual(0);
      expect(handle.close).not.toHaveBeenCalled();
      release.resolve();
      await preparing;
      await closing;
      expect(handle.fd).toBe(-1);
      expect(handle.close).toHaveBeenCalledOnce();
      await expect(reader.prepareContainer(sha256)).rejects.toMatchObject({
        reason: "unavailable",
      });
      await expect(
        reader.entries()[Symbol.asyncIterator]().next(),
      ).rejects.toMatchObject({
        reason: "unavailable",
      });
      expect(control.handles.size).toBe(1);
      await reader.close();
      expect(handle.close).toHaveBeenCalledOnce();
    } finally {
      release.resolve();
      await Promise.allSettled(operations);
      await reader.close();
    }
  },
);

it.each(carriers)(
  "$name retains a failed physical close and retries only that exact descriptor",
  async (carrier) => {
    const { path, sha256 } = await carrierFile(carrier);
    const entered = createDeferred<void>();
    const release = createDeferred<void>();
    const failure = new Error("controlled carrier close failure");
    let blocked = true;
    control.onOpen = async (handle) => {
      const close = handle.close.bind(handle);
      vi.spyOn(handle, "close").mockImplementation(async () => {
        entered.resolve();
        await release.promise;
        if (blocked) throw failure;
        await close();
      });
    };
    const reader = carrier.reader(path);
    let closing: Promise<PromiseSettledResult<void>[]> | undefined;
    try {
      await reader.prepareContainer(sha256);
      const [entry] = await entries(reader);
      if (entry === undefined) throw new Error("Missing carrier member");
      expect(await text(await reader.open(entry))).toBe(BODY);
      const handle = openedHandle();
      closing = Promise.allSettled([reader.close(), reader.close()]);
      await awaitAcknowledgement(entered.promise, closing, "carrier close");
      expect(handle.fd).toBeGreaterThanOrEqual(0);
      expect(handle.close).toHaveBeenCalledOnce();
      release.resolve();
      expect(await closing).toEqual([
        { status: "rejected", reason: failure },
        { status: "rejected", reason: failure },
      ]);
      expect(handle.fd).toBeGreaterThanOrEqual(0);
      blocked = false;
      await Promise.all([reader.close(), reader.close()]);
      expect(handle.fd).toBe(-1);
      expect(handle.close).toHaveBeenCalledTimes(2);
      await reader.close();
      expect(handle.close).toHaveBeenCalledTimes(2);
      expect(control.handles.size).toBe(1);
    } finally {
      blocked = false;
      release.resolve();
      await closing;
      await reader.close();
    }
  },
);

it.each(carriers)(
  "$name borrows the admitted descriptor after path replacement and leaves its close to the caller",
  async (carrier) => {
    const { path, sha256 } = await carrierFile(carrier);
    const handle = await open(path, "r");
    const close = vi.spyOn(handle, "close");
    let reader: ReturnType<typeof carrier.reader> | undefined;
    try {
      const replacement = join(dirname(path), "replacement.bin");
      const replacementBytes = carrier.bytes("replacement source\n");
      await writeFile(replacement, replacementBytes);
      await rename(replacement, path);
      reader = carrier.reader(path, {
        handle,
        initial: await handle.stat(),
      });
      await reader.prepareContainer(sha256);
      const [entry] = await entries(reader);
      if (entry === undefined)
        throw new Error("Missing original carrier member");
      expect(await text(await reader.open(entry))).toBe(BODY);
      await reader.close();
      await reader.close();
      expect(close).not.toHaveBeenCalled();
      expect(handle.fd).toBeGreaterThanOrEqual(0);
      expect(Buffer.compare(await readFile(path), replacementBytes)).toBe(0);
      expect(control.handles.size).toBe(1);
      await handle.close();
      expect(close).toHaveBeenCalledOnce();
      expect(handle.fd).toBe(-1);
      await reader.close();
      expect(close).toHaveBeenCalledOnce();
    } finally {
      try {
        await reader?.close();
      } finally {
        if (handle.fd >= 0) await handle.close();
      }
    }
  },
);

const admissionCases = carriers.flatMap((carrier) =>
  (
    [
      { primary: "io", closeFails: false },
      { primary: "io", closeFails: true },
      { primary: "cancelled", closeFails: false },
      { primary: "cancelled", closeFails: true },
    ] as const
  ).map((scenario) => ({ name: carrier.name, carrier, ...scenario })),
);

it.each(admissionCases)(
  "$name awaits physical admission cleanup and preserves $primary (closeFails=$closeFails)",
  async ({ carrier, primary, closeFails }) => {
    const { path } = await carrierFile(carrier);
    const entered = createDeferred<void>();
    const release = createDeferred<void>();
    const controller = new AbortController();
    const admissionFailure = new Error("controlled descriptor stat failure");
    const cleanupFailure = new Error("controlled admission close failure");
    const cancellation = { request: "cancelled carrier admission" };
    let blocked = closeFails;
    control.onOpen = async (handle) => {
      if (primary === "io")
        vi.spyOn(handle, "stat").mockRejectedValueOnce(admissionFailure);
      else controller.abort(cancellation);
      const close = handle.close.bind(handle);
      vi.spyOn(handle, "close").mockImplementation(async () => {
        entered.resolve();
        await release.promise;
        if (blocked) throw cleanupFailure;
        await close();
      });
    };
    const reader = carrier.reader(path);
    let settled = false;
    let reading: Promise<unknown> | undefined;
    try {
      const operation = reader
        .entries(controller.signal)
        [Symbol.asyncIterator]()
        .next();
      reading = operation
        .catch((cause: unknown) => cause)
        .finally(() => {
          settled = true;
        });
      await awaitAcknowledgement(
        entered.promise,
        operation,
        "admission cleanup",
      );
      const handle = openedHandle();
      // An earlier metadata failure stays primary when cancellation arrives in close.
      controller.abort(cancellation);
      await setImmediate();
      expect(settled).toBe(false);
      expect(handle.fd).toBeGreaterThanOrEqual(0);
      release.resolve();
      const failure = await reading;
      if (!(failure instanceof ArtifactReaderFailure))
        throw new Error("Expected a typed carrier admission failure");
      expect(failure.reason).toBe(primary);
      const admission = closeFails ? failure.cause : failure;
      if (!(admission instanceof ArtifactReaderFailure))
        throw new Error("Missing the primary admission failure");
      expect(admission.cause).toBe(
        primary === "io" ? admissionFailure : cancellation,
      );
      expect(failure.cancellation).toEqual(
        primary === "cancelled" ? { reason: cancellation } : undefined,
      );
      if (closeFails) {
        expect(failure.cleanup).toEqual({
          reason: cleanupFailure.message,
          resources: [path],
        });
        expect(handle.fd).toBeGreaterThanOrEqual(0);
        await expect(reader.close()).rejects.toBe(cleanupFailure);
        expect(handle.close).toHaveBeenCalledTimes(2);
        blocked = false;
        await reader.close();
        expect(handle.close).toHaveBeenCalledTimes(3);
      } else {
        expect(failure.cleanup).toBeUndefined();
        expect(handle.fd).toBe(-1);
        await reader.close();
        expect(handle.close).toHaveBeenCalledOnce();
      }
      expect(handle.fd).toBe(-1);
      expect(control.handles.size).toBe(1);
    } finally {
      controller.abort(cancellation);
      blocked = false;
      release.resolve();
      await reading;
      await reader.close();
    }
  },
);

it("retries a failed reader without closing a successfully released peer again", async () => {
  const good = await carrierFile(carriers[0]);
  const failed = await carrierFile(carriers[1]);
  const cleanupFailure = new Error("controlled Node SEA peer close failure");
  let blocked = true;
  control.onOpen = async (handle, path) => {
    const close = handle.close.bind(handle);
    vi.spyOn(handle, "close").mockImplementation(async () => {
      if (path === failed.path && blocked) throw cleanupFailure;
      await close();
    });
  };
  const goodReader = carriers[0].reader(good.path);
  const failedReader = carriers[1].reader(failed.path);
  const scope = new ArtifactResourceScope();
  try {
    await goodReader.prepareContainer(good.sha256);
    await failedReader.prepareContainer(failed.sha256);
    const handles = [...control.handles.keys()];
    const [goodHandle, failedHandle] = handles;
    if (goodHandle === undefined || failedHandle === undefined)
      throw new Error("Missing the two exact admitted descriptors");
    expect(
      await scope.release({
        kind: "reader",
        resource: good.path,
        reader: goodReader,
      }),
    ).toEqual({ kind: "released" });
    const release = await scope.release({
      kind: "reader",
      resource: failed.path,
      reader: failedReader,
    });
    expect(release).toMatchObject({ kind: "failed", cause: cleanupFailure });
    expect(goodHandle.fd).toBe(-1);
    expect(failedHandle.fd).toBeGreaterThanOrEqual(0);
    expect(scope.cleanupResources).toEqual([failed.path]);
    blocked = false;
    await Promise.all([scope.close(), scope.close()]);
    await scope.close();
    expect(goodHandle.close).toHaveBeenCalledOnce();
    expect(failedHandle.close).toHaveBeenCalledTimes(2);
    expect(failedHandle.fd).toBe(-1);
    expect(scope.cleanupResources).toEqual([]);
    expect(control.handles.size).toBe(2);
  } finally {
    blocked = false;
    await scope.close();
    await goodReader.close();
    await failedReader.close();
  }
});
