import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, type FileHandle } from "node:fs/promises";
import { basename, join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const fault = vi.hoisted(() => ({
  source: "",
  handles: [] as FileHandle[],
  blocked: new Set<FileHandle>(),
  blockSource: false,
  controller: undefined as AbortController | undefined,
  readFailure: undefined as Error | undefined,
  writeFailure: undefined as Error | undefined,
  blockDestination: false,
  abortDestinationClose: false,
  destinations: [] as FileHandle[],
  onClose: undefined as ((handle: FileHandle) => Promise<void>) | undefined,
}));
vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...original,
    open: async (...args: Parameters<typeof original.open>) => {
      const handle = await original.open(...args);
      const source = args[0] === fault.source;
      const destination =
        fault.source !== "" &&
        args[1] === "wx" &&
        typeof args[0] === "string" &&
        basename(args[0]).startsWith("target-");
      if (!source && !destination) return handle;
      if (source) {
        fault.handles.push(handle);
        if (fault.blockSource) fault.blocked.add(handle);
        const read = handle.read.bind(handle);
        handle.read = (async (...readArgs: unknown[]) => {
          if (fault.readFailure !== undefined) {
            fault.controller?.abort(null);
            throw fault.readFailure;
          }
          return await Reflect.apply(read, handle, readArgs);
        }) as FileHandle["read"];
      } else {
        fault.destinations.push(handle);
        if (fault.blockDestination) fault.blocked.add(handle);
        const write = handle.writeFile.bind(handle);
        handle.writeFile = async (...writeArgs) => {
          if (fault.writeFailure !== undefined) {
            fault.controller?.abort(null);
            throw fault.writeFailure;
          }
          return await write(...writeArgs);
        };
      }
      const close = handle.close.bind(handle);
      handle.close = async () => {
        await fault.onClose?.(handle);
        if (source || fault.abortDestinationClose)
          fault.controller?.abort(null);
        if (fault.blocked.has(handle))
          throw new Error("controlled Ghidra import descriptor close failure");
        await close();
      };
      return handle;
    },
  };
});

import { createGhidraTargetSnapshot } from "../../src/ghidra/GhidraTargetSnapshot.js";
import {
  ArtifactFileCleanupFailure,
  bindArtifactFileCleanup,
} from "../../src/artifacts/ArtifactFileOperation.js";
import { ArtifactResourceScope } from "../../src/artifacts/ArtifactResourceScope.js";
import { ProviderCleanupError } from "../../src/domain/providerCleanupError.js";
import { GhidraClient } from "../../src/ghidra/GhidraClient.js";
import { GhidraProvider } from "../../src/ghidra/GhidraProvider.js";
import { ghidraProfileInstallationHost } from "../../src/ghidra/GhidraInstallation.fixture.js";
import { parseConfig } from "../../src/config/parseConfig.js";
import { parseBinaryTarget } from "../../src/application/BinaryTargetResolver.js";
import { elf } from "../../src/domain/binaryTarget.fixture.js";
import { silentLogger } from "../../src/logger.js";
import { projectAnalysisError } from "../../src/domain/analysisErrorProjection.js";
import type { AnalysisClient } from "../../src/application/AnalysisProvider.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";

beforeEach(() => {
  fault.source = "";
  fault.handles = [];
  fault.blocked.clear();
  fault.blockSource = false;
  fault.controller = undefined;
  fault.readFailure = undefined;
  fault.writeFailure = undefined;
  fault.blockDestination = false;
  fault.abortDestinationClose = false;
  fault.destinations = [];
  fault.onClose = undefined;
});

it.each(["read", "write"] as const)(
  "retains an existing %s IO failure when the final startup caller cancels",
  async (stage) => {
    const { client, launches } = await providerFixture();
    const controller = new AbortController();
    fault.controller = controller;
    const cause = Object.assign(new Error(`controlled ${stage} EIO`), {
      code: "EIO",
    });
    if (stage === "read") fault.readFailure = cause;
    else fault.writeFailure = cause;
    const result = await client.execute(
      "health",
      {},
      { signal: controller.signal },
    );
    if (result.ok) throw new Error("Expected existing IO failure");
    expect(result.error).toMatchObject({
      _tag: "ProviderAdapterError",
      cleanupIncomplete: false,
      diagnostics: { failure_kind: "start" },
    });
    expect(result.error.cause).toMatchObject({ kind: "start", cause });
    expect(fault.handles.every((handle) => handle.fd === -1)).toBe(true);
    expect(fault.destinations.every((handle) => handle.fd === -1)).toBe(true);
    expect(launches()).toBe(0);
  },
);
const clients: AnalysisClient[] = [];
afterEach(async () => {
  fault.blocked.clear();
  fault.controller = undefined;
  fault.onClose = undefined;
  for (const client of clients.splice(0)) await client.close();
  for (const handle of [...fault.handles, ...fault.destinations])
    if (handle.fd !== -1) await handle.close();
});

const fixture = async () => {
  const root = await createTestTempDirectory("rea-ghidra-import-lifetime-");
  const path = join(root, "source.bin");
  const runtime = join(root, "runtime");
  await mkdir(runtime);
  const bytes = Buffer.from("committed Ghidra import bytes");
  await writeFile(path, bytes);
  fault.source = path;
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  return { path, runtime, sha256 };
};

it.each(["completed", "mismatch"] as const)(
  "retains the exact source descriptor and %s import outcome when close fails",
  async (kind) => {
    const { path, runtime, sha256 } = await fixture();
    fault.blockSource = true;
    const failure = await createGhidraTargetSnapshot(
      path,
      runtime,
      kind === "completed" ? sha256 : "0".repeat(64),
      { platform: "linux" },
    ).catch((cause: unknown) => cause);
    expect(failure).toBeInstanceOf(ArtifactFileCleanupFailure);
    if (!(failure instanceof ArtifactFileCleanupFailure))
      throw new Error("Expected exact descriptor outcome and cleanup owner");
    expect(failure.fileCleanupFailure.owner.handle).toBe(fault.handles[0]);
    expect(failure.fileCleanupFailure.outcome).toMatchObject(
      kind === "completed"
        ? { kind: "completed", value: { sha256 } }
        : { kind: "failed", cause: { _tag: "AnalysisArtifactChangedError" } },
    );
    fault.blocked.clear();
    await failure.cleanupLease.release();
    expect(fault.handles[0]?.fd).toBe(-1);
  },
);

it("retains the exact caller reason when cancelled during import descriptor close", async () => {
  const { path, runtime, sha256 } = await fixture();
  const controller = new AbortController();
  fault.controller = controller;
  await expect(
    createGhidraTargetSnapshot(path, runtime, sha256, {
      platform: "linux",
      signal: controller.signal,
    }),
  ).rejects.toMatchObject({
    reason: "cancelled",
    cancellation: { reason: null },
  });
});

it("waits for mixed finalization and resolves cleanup only after both exact descriptors release", async () => {
  const { path, runtime, sha256 } = await fixture();
  fault.blockSource = true;
  fault.blockDestination = true;
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let entered = false;
  fault.onClose = async (handle) => {
    if (fault.destinations.includes(handle)) {
      entered = true;
      await gate;
    }
  };
  const resources = new ArtifactResourceScope();
  let settled = false;
  const running = createGhidraTargetSnapshot(path, runtime, sha256, {
    platform: "linux",
    resourceScope: resources,
  }).catch((cause: unknown) => {
    settled = true;
    return cause;
  });
  try {
    await expect.poll(() => entered).toBe(true);
    expect(settled).toBe(false);
    release();
    const failure = await running;
    expect(failure).toBeInstanceOf(ArtifactFileCleanupFailure);
    if (!(failure instanceof ArtifactFileCleanupFailure))
      throw new Error("Expected outer source owner");
    const physical = failure.fileCleanupFailure.outcome;
    if (
      physical.kind !== "failed" ||
      !(physical.cause instanceof ArtifactFileCleanupFailure)
    )
      throw new Error("Expected nested destination owner");
    const destination = physical.cause;
    expect(failure.fileCleanupFailure.owner.handle).toBe(fault.handles[0]);
    expect(destination.fileCleanupFailure.owner.handle).toBe(
      fault.destinations[0],
    );
    expect(failure.cleanupLeases).toHaveLength(2);
    const projected = new ProviderCleanupError(
      "ghidra",
      failure.cleanup?.resources ?? [],
      { reason: "controlled mixed cleanup" },
    );
    bindArtifactFileCleanup(failure, projected);
    fault.blocked.delete(fault.destinations[0]!);
    await destination.cleanupLease.release();
    expect(projected.cleanupIncomplete).toBe(true);
    expect(projected.cleanupResources).toEqual([path]);
    fault.blocked.clear();
    await resources.close();
    expect(projected.cleanupIncomplete).toBe(false);
  } finally {
    release();
    await running;
    fault.blocked.clear();
    await resources.close();
  }
});

const providerFixture = async () => {
  const { path } = await fixture();
  fault.source = "";
  await writeFile(path, elf(2, 1, 62));
  const target = await parseBinaryTarget(path);
  if (!target.ok) throw target.error;
  const config = parseConfig({ GHIDRA_INSTALL_DIR: "/simulated-ghidra" });
  if (!config.ok) throw config.error;
  let launches = 0;
  const provider = new GhidraProvider(
    config.value,
    silentLogger,
    {},
    ghidraProfileInstallationHost,
    (options) =>
      new GhidraClient({
        ...options,
        launcher: {
          launch: async () => {
            launches += 1;
            throw new Error("Snapshot failure must prevent engine launch");
          },
        },
      }),
  );
  const resolved = await provider.resolveAnalysisProfile(target.value);
  if (!resolved.ok || resolved.value.profile === null)
    throw new Error("Expected simulated profile admission");
  const client = provider.createClient(target.value, resolved.value.profile);
  clients.push(client);
  fault.source = path;
  return { client, path, launches: () => launches };
};

it.each([null, "caller reason", new Error("caller cancellation")])(
  "preserves pre-admission startup cancellation reason: %s",
  async (reason) => {
    const { client, launches } = await providerFixture();
    const controller = new AbortController();
    controller.abort(reason);
    const result = await client.execute(
      "health",
      {},
      { signal: controller.signal },
    );
    if (result.ok) throw new Error("Expected cancelled admission");
    expect(result.error).toMatchObject({ _tag: "AnalysisCancelledError" });
    expect(result.error.cause).toBe(reason);
    expect(fault.handles).toHaveLength(0);
    expect(launches()).toBe(0);
  },
);

it.each([
  "mismatch",
  "denied",
  "cancelled",
  "cancelled_after_failed_close",
] as const)(
  "preserves public %s classification and live cleanup recovery",
  async (kind) => {
    const { client, path, launches } = await providerFixture();
    fault.blockSource = true;
    fault.blockDestination = true;
    const controller = new AbortController();
    if (kind === "mismatch")
      await writeFile(path, "changed after target admission");
    if (kind === "denied")
      fault.readFailure = Object.assign(
        new Error("controlled source permission failure"),
        { code: "EACCES", path },
      );
    if (kind.startsWith("cancelled")) fault.controller = controller;
    if (kind === "cancelled") fault.abortDestinationClose = true;
    const result = await client.execute(
      "health",
      {},
      { signal: controller.signal },
    );
    if (result.ok) throw new Error("Expected failed snapshot admission");
    expect(projectAnalysisError(result.error)).toMatchObject({
      code: "cleanup_incomplete",
      details: {
        diagnostics: {
          primary_error: {
            code:
              kind === "mismatch"
                ? "artifact_changed"
                : kind === "denied"
                  ? "access_denied"
                  : kind === "cancelled"
                    ? "cancelled"
                    : "execution_failure",
          },
        },
      },
    });
    if (kind === "cancelled") {
      expect(result.error.cause).toBeInstanceOf(AggregateError);
      if (!(result.error.cause instanceof AggregateError))
        throw new Error("Expected composed primary");
      expect(result.error.cause.cause).toMatchObject({
        _tag: "AnalysisCancelledError",
        cause: null,
      });
    }
    const close = await client.close();
    expect(close.ok).toBe(false);
    fault.blocked.clear();
    await expect(client.close()).resolves.toMatchObject({ ok: true });
    expect(result.error.cleanupIncomplete).toBe(false);
    if (!close.ok) expect(close.error.cleanupIncomplete).toBe(false);
    expect(fault.handles.every((handle) => handle.fd === -1)).toBe(true);
    expect(launches()).toBe(0);
  },
);

it("copies every byte across chunk boundaries through the destination owner", async () => {
  const { path, runtime } = await fixture();
  const bytes = Buffer.alloc(256 * 1024 + 37);
  for (let index = 0; index < bytes.length; index++)
    bytes[index] = (index * 37 + Math.floor(index / 65536)) % 251;
  await writeFile(path, bytes);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const snapshot = await createGhidraTargetSnapshot(path, runtime, sha256, {
    platform: "linux",
  });
  expect(Buffer.compare(await readFile(snapshot.path), bytes)).toBe(0);
  expect(snapshot.sha256).toBe(sha256);
  expect(fault.handles.length).toBeGreaterThan(0);
  expect(fault.destinations.length).toBeGreaterThan(0);
  expect(
    [...fault.handles, ...fault.destinations].every(
      (handle) => handle.fd === -1,
    ),
  ).toBe(true);
});
