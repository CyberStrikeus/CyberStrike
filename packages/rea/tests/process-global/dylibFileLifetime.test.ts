import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, rename, writeFile, type FileHandle } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const fault = vi.hoisted(() => ({
  path: "",
  handles: [] as FileHandle[],
  blocked: new Set<FileHandle>(),
  blockClose: false,
  readFailure: undefined as Error | undefined,
  controller: undefined as AbortController | undefined,
  abortOnRead: false,
  abortClose: 0,
  closeCount: 0,
  onClose: undefined as (() => Promise<void>) | undefined,
  beforeOpen: undefined as (() => Promise<void>) | undefined,
  onRead: undefined as (() => Promise<void>) | undefined,
}));
vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...original,
    open: async (...args: Parameters<typeof original.open>) => {
      if (args[0] === fault.path) await fault.beforeOpen?.();
      const handle = await original.open(...args);
      if (args[0] !== fault.path) return handle;
      fault.handles.push(handle);
      if (fault.blockClose) fault.blocked.add(handle);
      const read = handle.read.bind(handle);
      handle.read = (async (...readArgs: unknown[]) => {
        if (fault.abortOnRead) fault.controller?.abort(null);
        if (fault.readFailure !== undefined) throw fault.readFailure;
        const result = await Reflect.apply(read, handle, readArgs);
        await fault.onRead?.();
        return result;
      }) as FileHandle["read"];
      const close = handle.close.bind(handle);
      handle.close = async () => {
        fault.closeCount += 1;
        await fault.onClose?.();
        if (fault.closeCount === fault.abortClose)
          fault.controller?.abort(null);
        if (fault.blocked.has(handle))
          throw new Error("controlled dyld close failure");
        await close();
      };
      return handle;
    },
  };
});

import { traceDylibResolution } from "../../src/artifacts/apple/DylibResolutionReader.js";
import { machoImage } from "../../src/artifacts/apple/MachoImage.fixture.js";
import { ArtifactFileCleanupFailure } from "../../src/artifacts/ArtifactFileOperation.js";
import { ArtifactReaderFailure } from "../../src/artifacts/ArtifactReader.js";
import { ArtifactProvider } from "../../src/artifacts/ArtifactProvider.js";
import type { AnalysisClient } from "../../src/application/AnalysisProvider.js";
import { parseBinaryTarget } from "../../src/application/BinaryTargetResolver.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";

const clients: AnalysisClient[] = [];

beforeEach(() => {
  fault.path = "";
  fault.handles = [];
  fault.blocked.clear();
  fault.blockClose = false;
  fault.readFailure = undefined;
  fault.controller = undefined;
  fault.abortOnRead = false;
  fault.abortClose = 0;
  fault.closeCount = 0;
  fault.onClose = undefined;
  fault.beforeOpen = undefined;
  fault.onRead = undefined;
});
afterEach(async () => {
  fault.blocked.clear();
  fault.onClose = undefined;
  for (const client of clients.splice(0)) await client.close();
  for (const handle of fault.handles)
    if (handle.fd !== -1) await handle.close();
});

const fixture = async () => {
  const root = await createTestTempDirectory("rea-dyld-lifetime-");
  const path = join(root, "Main");
  const bytes = machoImage({});
  await writeFile(path, bytes);
  const target = await parseBinaryTarget(path);
  if (!target.ok) throw target.error;
  const controller = new AbortController();
  fault.path = path;
  fault.controller = controller;
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const client = new ArtifactProvider({}).createClient(target.value);
  clients.push(client);
  return {
    controller,
    client,
    trace: () =>
      traceDylibResolution({
        rootPath: root,
        targetPath: path,
        targetSha256: sha256,
        enumerateRoots: false,
        parameters: { roots: ["Main"] },
        signal: controller.signal,
      }),
  };
};

it("preserves a dyld read failure when the same read observes cancellation", async () => {
  const { trace } = await fixture();
  const cause = Object.assign(new Error("controlled dyld EIO"), {
    code: "EIO",
  });
  fault.readFailure = cause;
  fault.abortOnRead = true;
  await expect(trace()).rejects.toBe(cause);
  expect(fault.handles.every((handle) => handle.fd === -1)).toBe(true);
});

it("retains the original dyld I/O cause through provider translation", async () => {
  const { client } = await fixture();
  const cause = Object.assign(new Error("controlled dyld EIO"), {
    code: "EIO",
    path: fault.path,
  });
  fault.readFailure = cause;
  const result = await client.execute("trace_dylib_resolution", {
    roots: ["Main"],
  });
  if (result.ok) throw new Error("Expected failed dyld read");
  expect(result.error).toMatchObject({ reason: "io" });
  expect(result.error.cause).toBe(cause);
  expect(fault.handles.every((handle) => handle.fd === -1)).toBe(true);
  await expect(client.close()).resolves.toMatchObject({ ok: true });
});

it("observes cancellation during the final dyld digest close", async () => {
  const { trace } = await fixture();
  fault.abortClose = 2;
  await expect(trace()).rejects.toMatchObject({
    reason: "cancelled",
    cancellation: { reason: null },
  });
  expect(fault.handles.every((handle) => handle.fd === -1)).toBe(true);
});

it.each(["completed", "failed", "cancelled"] as const)(
  "retains the exact dyld descriptor and %s outcome when close fails",
  async (kind) => {
    const { trace } = await fixture();
    fault.blockClose = true;
    const cause = new ArtifactReaderFailure("io", "controlled primary");
    if (kind === "failed") fault.readFailure = cause;
    if (kind === "cancelled") fault.abortClose = 1;
    const failure = await trace().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ArtifactFileCleanupFailure);
    if (!(failure instanceof ArtifactFileCleanupFailure))
      throw new Error("Expected exact descriptor cleanup capability");
    expect(failure.fileCleanupFailure.owner.handle).toBe(fault.handles[0]);
    if (kind === "cancelled")
      expect(failure).toMatchObject({
        reason: "cancelled",
        cancellation: { reason: null },
      });
    expect(failure.fileCleanupFailure.outcome.kind).toBe(
      kind === "failed" ? "failed" : "completed",
    );
    if (kind === "failed")
      expect(failure.fileCleanupFailure.outcome).toEqual({
        kind: "failed",
        cause,
      });
    fault.blocked.clear();
    await failure.cleanupLease.release();
    expect(fault.handles[0]?.fd).toBe(-1);
  },
);

it("projects cancellation with cleanup uncertainty when dyld final close fails", async () => {
  const { client, controller } = await fixture();
  fault.abortClose = 1;
  fault.blockClose = true;
  const result = await client.execute(
    "trace_dylib_resolution",
    { roots: ["Main"] },
    { signal: controller.signal },
  );
  if (result.ok) throw new Error("Expected interruption during finalization");
  expect(result.error).toMatchObject({
    reason: "cancelled",
    cause: null,
    cleanupIncomplete: true,
  });
  fault.blocked.clear();
  await expect(client.close()).resolves.toMatchObject({ ok: true });
  expect(result.error.cleanupIncomplete).toBe(false);
});

it.skipIf(process.platform === "win32")(
  "retains nonregular admission classification and its exact failed close",
  async () => {
    const { client } = await fixture();
    fault.beforeOpen = async () => {
      fault.beforeOpen = undefined;
      await rename(fault.path, `${fault.path}.old`);
      await mkdir(fault.path);
    };
    fault.blockClose = true;
    const result = await client.execute("trace_dylib_resolution", {
      roots: ["Main"],
    });
    if (result.ok) throw new Error("Expected nonregular admission failure");
    expect(result.error).toMatchObject({
      reason: "format",
      cleanupIncomplete: true,
    });
    expect(result.error.cause).toBeInstanceOf(ArtifactFileCleanupFailure);
    expect(fault.handles).toHaveLength(1);
    fault.blocked.clear();
    await expect(client.close()).resolves.toMatchObject({ ok: true });
    expect(result.error.cleanupIncomplete).toBe(false);
    expect(fault.handles[0]?.fd).toBe(-1);
  },
);

it.each(["EACCES", "EPERM"])(
  "retains %s semantics alongside failed cleanup",
  async (code) => {
    const { client } = await fixture();
    fault.readFailure = Object.assign(
      new Error("controlled permission failure"),
      { code },
    );
    fault.blockClose = true;
    const result = await client.execute("trace_dylib_resolution", {
      roots: ["Main"],
    });
    if (result.ok) throw new Error("Expected permission failure");
    expect(result.error).toMatchObject({
      reason: "unavailable",
      cleanupIncomplete: true,
    });
    expect(result.error.cause).toBeInstanceOf(ArtifactFileCleanupFailure);
    fault.blocked.clear();
    await expect(client.close()).resolves.toMatchObject({ ok: true });
    expect(result.error.cleanupIncomplete).toBe(false);
  },
);

it("rejects a substituted pathname after parsing the original descriptor", async () => {
  const { trace } = await fixture();
  fault.onRead = async () => {
    fault.onRead = undefined;
    await rename(fault.path, `${fault.path}.old`);
    await writeFile(fault.path, machoImage({}));
  };
  await expect(trace()).rejects.toMatchObject({ reason: "integrity" });
  expect(fault.handles.every((handle) => handle.fd === -1)).toBe(true);
});

it.skipIf(process.platform === "win32").each(["magic", "image", "digest"])(
  "rejects a FIFO substituted at the compiled dyld %s open without a writer",
  async (stage) => {
    await fixture();
    const path = fault.path;
    fault.path = "";
    const module = pathToFileURL(
      join(process.cwd(), "dist/artifacts/apple/DylibResolutionReader.js"),
    ).href;
    const script = `
      import fs from 'node:fs';
      import { syncBuiltinESMExports } from 'node:module';
      import { execFileSync } from 'node:child_process';
      import { createHash } from 'node:crypto';
      import { dirname } from 'node:path';
      const [stage, path] = process.argv.slice(1);
      const sha256 = createHash('sha256').update(await fs.promises.readFile(path)).digest('hex');
      const nativeOpen = fs.promises.open;
      let opens = 0;
      let substituted = false;
      fs.promises.open = async (selected, ...args) => {
        if (selected === path && ++opens === (stage === 'digest' ? 2 : 1)) {
          await fs.promises.rename(path, path + '.old');
          execFileSync('mkfifo', [path]);
          substituted = true;
        }
        return await nativeOpen(selected, ...args);
      };
      syncBuiltinESMExports();
      const { traceDylibResolution } = await import(${JSON.stringify(module)});
      try {
        await traceDylibResolution({ rootPath: dirname(path), targetPath: path,
          targetSha256: sha256, enumerateRoots: stage === 'magic',
          parameters: stage === 'magic' ? {} : { roots: ['Main'] } });
        throw new Error('Unexpected FIFO success');
      } catch (error) {
        if (error.reason !== 'format') throw error;
        process.stdout.write(JSON.stringify({ stage, opens, substituted, reason: error.reason }));
      }
    `;
    const result = await promisify(execFile)(
      process.execPath,
      ["--input-type=module", "--eval", script, stage, path],
      { timeout: 5000 },
    );
    expect(JSON.parse(result.stdout)).toEqual({
      stage,
      opens: stage === "digest" ? 2 : 1,
      substituted: true,
      reason: "format",
    });
  },
);

it("binds both dyld failure and failed provider-close projections to the same descriptor", async () => {
  const { client } = await fixture();
  fault.blockClose = true;
  fault.readFailure = new ArtifactReaderFailure("io", "controlled primary");
  const result = await client.execute("trace_dylib_resolution", {
    roots: ["Main"],
  });
  if (result.ok) throw new Error("Expected failed dyld read");
  expect(result.error).toMatchObject({ reason: "io", cleanupIncomplete: true });
  expect(result.error.cause).toBeInstanceOf(ArtifactFileCleanupFailure);
  const close = await client.close();
  if (close.ok) throw new Error("Expected retained descriptor");
  expect(close.error.cleanupIncomplete).toBe(true);
  expect(fault.handles).toHaveLength(1);
  fault.blocked.clear();
  await expect(client.close()).resolves.toMatchObject({ ok: true });
  expect(result.error.cleanupIncomplete).toBe(false);
  expect(close.error.cleanupIncomplete).toBe(false);
  expect(fault.handles[0]?.fd).toBe(-1);
});

it("preserves the caller's explicit null cancellation reason through dyld provider projection", async () => {
  const { client, controller } = await fixture();
  fault.abortOnRead = true;
  fault.blockClose = true;
  const result = await client.execute(
    "trace_dylib_resolution",
    { roots: ["Main"] },
    { signal: controller.signal },
  );
  if (result.ok) throw new Error("Expected cancelled dyld read");
  expect(result.error).toMatchObject({
    reason: "cancelled",
    cleanupIncomplete: true,
  });
  expect(result.error.cause).toBeNull();
  fault.blocked.clear();
  await expect(client.close()).resolves.toMatchObject({ ok: true });
  expect(result.error.cleanupIncomplete).toBe(false);
  expect(fault.handles[0]?.fd).toBe(-1);
});

it("waits for an in-flight final dyld close before completing provider close", async () => {
  const { client, controller } = await fixture();
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  fault.onClose = async () => {
    if (fault.closeCount === 2) await gate;
  };
  const running = client.execute(
    "trace_dylib_resolution",
    { roots: ["Main"] },
    { signal: controller.signal },
  );
  try {
    await expect.poll(() => fault.closeCount).toBe(2);
    let closed = false;
    const closing = client.close().then((result) => {
      closed = true;
      return result;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(closed).toBe(false);
    controller.abort(null);
    release();
    await expect(running).resolves.toMatchObject({
      ok: false,
      error: { reason: "cancelled", cause: null },
    });
    await expect(closing).resolves.toMatchObject({ ok: true });
    expect(fault.handles.every((handle) => handle.fd === -1)).toBe(true);
  } finally {
    release();
    await running;
  }
});

it.each(["image", "digest"] as const)(
  "retains the path and filesystem cause when the pathname disappears during the dyld %s read",
  async (stage) => {
    const { client } = await fixture();
    fault.onRead = async () => {
      if (fault.handles.length !== (stage === "image" ? 1 : 2)) return;
      fault.onRead = undefined;
      await rename(fault.path, `${fault.path}.old`);
    };
    const result = await client.execute("trace_dylib_resolution", {
      roots: ["Main"],
    });
    expect(result).toMatchObject({
      ok: false,
      error: {
        reason: "integrity",
        detail: expect.stringContaining(fault.path),
        cause: {
          reason: "integrity",
          cause: { code: "ENOENT", path: fault.path },
        },
      },
    });
    expect(fault.handles).toHaveLength(stage === "image" ? 1 : 2);
    expect(fault.handles.every((handle) => handle.fd === -1)).toBe(true);
    await expect(client.close()).resolves.toMatchObject({ ok: true });
  },
);
