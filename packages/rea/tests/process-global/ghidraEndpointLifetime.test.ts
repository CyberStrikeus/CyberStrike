import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import {
  access,
  readFile,
  rename,
  writeFile,
  type FileHandle,
} from "node:fs/promises";
import { basename, join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const fault = vi.hoisted(() => ({
  path: "",
  matchEndpoints: false,
  reads: 0,
  handles: [] as FileHandle[],
  blocked: false,
  abortClose: undefined as AbortController | undefined,
  readFailure: undefined as Error | undefined,
  abortRead: undefined as AbortController | undefined,
  readGate: undefined as (() => Promise<void>) | undefined,
}));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    open: async (...args: Parameters<typeof actual.open>) => {
      const handle = await actual.open(...args);
      if (
        args[0] !== fault.path &&
        !(
          fault.matchEndpoints &&
          typeof args[0] === "string" &&
          basename(args[0]) === "bridge-endpoint.json"
        )
      )
        return handle;
      fault.handles.push(handle);
      const close = handle.close.bind(handle);
      handle.close = async () => {
        fault.abortClose?.abort(null);
        if (fault.blocked) throw new Error("controlled endpoint close failure");
        await close();
      };
      const read = handle.read.bind(handle);
      handle.read = (async (...values: unknown[]) => {
        fault.reads += 1;
        await fault.readGate?.();
        if (fault.readFailure !== undefined) {
          fault.abortRead?.abort(null);
          throw fault.readFailure;
        }
        return await Reflect.apply(read, handle, values);
      }) as FileHandle["read"];
      const readFile = handle.readFile.bind(handle);
      handle.readFile = (async (...values: unknown[]) => {
        fault.reads += 1;
        await fault.readGate?.();
        if (fault.readFailure !== undefined) {
          fault.abortRead?.abort(null);
          throw fault.readFailure;
        }
        return await Reflect.apply(readFile, handle, values);
      }) as FileHandle["readFile"];
      return handle;
    },
  };
});

import { ArtifactResourceScope } from "../../src/artifacts/ArtifactResourceScope.js";
import {
  ArtifactFileCleanupFailure,
  artifactFilePrimaryFacts,
} from "../../src/artifacts/ArtifactFileOperation.js";
import { observeGhidraEndpoint } from "../../src/ghidra/GhidraTransport.js";
import { GhidraClient } from "../../src/ghidra/GhidraClient.js";
import {
  GhidraFixtureLauncher,
  ghidraFixturePath,
} from "../boundary/providers/ghidra/ghidraClient.fixture.js";
import { waitForExit } from "../support/process/processFixture.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";

const clients: GhidraClient[] = [];
const operations: Promise<unknown>[] = [];
let releaseRead: (() => void) | undefined;
beforeEach(() => {
  fault.path = "";
  fault.matchEndpoints = false;
  fault.reads = 0;
  fault.handles = [];
  fault.blocked = false;
  fault.abortClose = undefined;
  fault.readFailure = undefined;
  fault.abortRead = undefined;
  fault.readGate = undefined;
});
afterEach(async () => {
  fault.blocked = false;
  fault.abortClose = undefined;
  fault.readFailure = undefined;
  fault.abortRead = undefined;
  releaseRead?.();
  releaseRead = undefined;
  await Promise.allSettled(operations.splice(0));
  for (const client of clients.splice(0)) await client.close();
  for (const handle of fault.handles)
    if (handle.fd !== -1) await handle.close();
});

const fixture = async (text = '{"host":"127.0.0.1","port":49152}\n') => {
  const root = await createTestTempDirectory("rea-endpoint-lifetime-");
  fault.path = join(root, "bridge-endpoint.json");
  await writeFile(fault.path, text);
  return {
    endpoint: {
      transport: "authenticated-loopback-tcp" as const,
      path: fault.path,
    },
    resources: new ArtifactResourceScope(),
  };
};

it.skipIf(process.platform === "win32").each(["valid", "invalid"] as const)(
  "retains the exact descriptor and %s endpoint outcome after close failure",
  async (kind) => {
    const { endpoint, resources } = await fixture(
      kind === "valid" ? undefined : "{",
    );
    fault.blocked = true;
    const result = await observeGhidraEndpoint(endpoint, {
      resourceScope: resources,
    });
    expect(result).toMatchObject({
      ok: false,
      error: { kind: "start", cleanupFailure: { cleanupIncomplete: true } },
    });
    if (result.ok) throw new Error("Expected typed endpoint failure");
    const failure = result.error;
    if (kind === "invalid")
      expect(failure.message).toBe("Ghidra TCP endpoint is invalid");
    expect(fault.handles).toHaveLength(1);
    expect(fault.handles[0]?.fd).toBeGreaterThanOrEqual(0);
    expect(resources.hasPending).toBe(true);
    fault.blocked = false;
    await resources.retryCleanup();
    expect(fault.handles[0]?.fd).toBe(-1);
    expect(failure.cleanupFailure?.cleanupIncomplete).toBe(false);
  },
);

it.skipIf(process.platform === "win32")(
  "observes exact null cancellation during the endpoint's final close",
  async () => {
    const { endpoint, resources } = await fixture();
    const controller = new AbortController();
    fault.abortClose = controller;
    const result = await observeGhidraEndpoint(endpoint, {
      resourceScope: resources,
      signal: controller.signal,
    });
    expect(result).toMatchObject({
      ok: false,
      error: { kind: "cancelled", cancellation: { reason: null } },
    });
    expect(fault.handles.every((handle) => handle.fd === -1)).toBe(true);
  },
);

it.skipIf(process.platform === "win32").each(["released", "failed"] as const)(
  "preserves endpoint IO failure during cancellation and %s close",
  async (closing) => {
    const { endpoint, resources } = await fixture();
    const controller = new AbortController();
    const cause = Object.assign(new Error("controlled endpoint EIO"), {
      code: "EIO",
    });
    fault.readFailure = cause;
    fault.abortRead = controller;
    fault.blocked = closing === "failed";
    const result = await observeGhidraEndpoint(endpoint, {
      resourceScope: resources,
      signal: controller.signal,
    });
    if (result.ok) throw new Error("Expected IO failure");
    expect(result.error.kind).toBe("start");
    expect(controller.signal.aborted).toBe(true);
    expect(controller.signal.reason).toBe(null);
    const endpointCause = result.error.cause;
    expect(artifactFilePrimaryFacts(endpointCause).cause).toBe(cause);
    if (closing === "failed") {
      if (!(endpointCause instanceof ArtifactFileCleanupFailure))
        throw new Error("Expected the retained endpoint descriptor owner");
      expect(endpointCause.reason).toBe("io");
      expect(endpointCause.cancellation).toBeUndefined();
      // The descriptor reader retains native EIO directly, without an opaque
      // callback marker; the wrapper still owns the failed operation and close.
      expect(artifactFilePrimaryFacts(endpointCause).origin).toBe(
        "owned-or-classified",
      );
      expect(endpointCause.fileCleanupFailure.owner.handle).toBe(
        fault.handles[0],
      );
      expect(endpointCause.cleanupLease.released).toBe(false);
      expect(resources.hasPending).toBe(true);
      expect(result.error.cleanupFailure?.cleanupIncomplete).toBe(true);
      expect(result.error.cleanupFailure?.cleanupResources).toEqual([
        endpoint.path,
      ]);
    } else {
      expect(endpointCause).toBe(cause);
      expect(resources.hasPending).toBe(false);
    }
    fault.blocked = false;
    await resources.retryCleanup();
    if (endpointCause instanceof ArtifactFileCleanupFailure)
      expect(endpointCause.cleanupLease.released).toBe(true);
    expect(resources.hasPending).toBe(false);
    expect(result.error.cleanupFailure?.cleanupIncomplete ?? false).toBe(false);
    expect(fault.handles.every((handle) => handle.fd === -1)).toBe(true);
  },
);

it.skipIf(process.platform === "win32")(
  "keeps endpoint observation admitted until its read and close finish",
  async () => {
    const { endpoint, resources } = await fixture();
    let entered: (() => void) | undefined;
    const observed = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      releaseRead = resolve;
    });
    fault.readGate = async () => {
      entered?.();
      await gate;
    };
    const pending = observeGhidraEndpoint(endpoint, {
      resourceScope: resources,
    });
    operations.push(pending);
    await observed;
    let closed = false;
    const closing = resources.close().then(() => {
      closed = true;
    });
    operations.push(closing);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(closed).toBe(false);
    releaseRead?.();
    await expect(pending).resolves.toMatchObject({ ok: true });
    await closing;
    expect(fault.handles.every((handle) => handle.fd === -1)).toBe(true);
  },
);

it
  .skipIf(process.platform === "win32")
  .each(["completed", "cancelled"] as const)(
  "preserves endpoint and provider cleanup owners through %s startup and retry",
  async (kind) => {
    const launcher = new GhidraFixtureLauncher();
    const controller = new AbortController();
    fault.matchEndpoints = true;
    fault.blocked = true;
    if (kind === "cancelled") fault.abortClose = controller;
    const client = new GhidraClient({
      launcher,
      targetPath: ghidraFixturePath,
      targetSha256: createHash("sha256")
        .update(await readFile(ghidraFixturePath))
        .digest("hex"),
      transport: "authenticated-loopback-tcp",
      providerVersion: "12.1.4",
      profileDigest: "a".repeat(64),
      startupTimeoutMs: 5000,
    });
    clients.push(client);
    const result = await client.start(controller.signal);
    if (result.ok) throw new Error("Expected endpoint finalization failure");
    expect(result.error.kind).toBe(
      kind === "cancelled" ? "cancelled" : "start",
    );
    if (kind === "cancelled")
      expect(result.error.cancellation?.reason).toBe(null);
    expect(result.error.cleanupFailure?.cleanupIncomplete).toBe(true);
    expect(result.error.cleanupFailure?.cleanupResources).toContain(
      launcher.endpointPaths[0],
    );
    expect(fault.handles.some((handle) => handle.fd !== -1)).toBe(true);
    fault.blocked = false;
    fault.abortClose = undefined;
    await expect(client.close()).resolves.toEqual({ ok: true, value: null });
    expect(result.error.cleanupFailure?.cleanupIncomplete).toBe(false);
    expect(fault.handles.every((handle) => handle.fd === -1)).toBe(true);
    const child = launcher.processes[0];
    if (child === undefined)
      throw new Error("Expected admitted fixture process");
    expect(await waitForExit(child, 5000)).toBe(true);
    await expect(access(launcher.runtimeRoots[0] ?? "")).rejects.toMatchObject({
      code: "ENOENT",
    });
  },
);

it.skipIf(process.platform === "win32")(
  "rejects endpoint pathname replacement instead of reporting readiness",
  async () => {
    const { endpoint, resources } = await fixture();
    fault.readGate = async () => {
      fault.readGate = undefined;
      await rename(endpoint.path, endpoint.path + ".old");
      await writeFile(endpoint.path, '{"host":"127.0.0.1","port":49153}\n');
    };
    await expect(
      observeGhidraEndpoint(endpoint, { resourceScope: resources }),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        kind: "start",
        message: "Ghidra TCP endpoint changed during observation",
      },
    });
    expect(fault.handles.every((handle) => handle.fd === -1)).toBe(true);
  },
);

it.skipIf(process.platform === "win32")(
  "rejects an oversized endpoint before reading its contents",
  async () => {
    const { endpoint, resources } = await fixture(" ".repeat(65537));
    await expect(
      observeGhidraEndpoint(endpoint, { resourceScope: resources }),
    ).resolves.toMatchObject({
      ok: false,
      error: { kind: "start", cause: { reason: "limit" } },
    });
    expect(fault.reads).toBe(0);
    expect(fault.handles.every((handle) => handle.fd === -1)).toBe(true);
  },
);

it.skipIf(process.platform === "win32")(
  "rejects a FIFO endpoint through the compiled observer without a writer",
  async () => {
    const { endpoint } = await fixture();
    await rename(endpoint.path, endpoint.path + ".old");
    await promisify(execFile)("mkfifo", [endpoint.path]);
    const module = pathToFileURL(
      join(process.cwd(), "dist/ghidra/GhidraTransport.js"),
    ).href;
    const script = `
    const { observeGhidraEndpoint } = await import(${JSON.stringify(module)});
    const result = await observeGhidraEndpoint({ transport: "authenticated-loopback-tcp", path: process.argv[1] });
    if (result.ok) throw new Error("Unexpected FIFO readiness");
    process.stdout.write(JSON.stringify({ kind: result.error.kind, code: result.error.cause.code }));
  `;
    const result = await promisify(execFile)(
      process.execPath,
      ["--input-type=module", "--eval", script, endpoint.path],
      { timeout: 5000 },
    );
    expect(JSON.parse(result.stdout)).toEqual({
      kind: "start",
      code: "ENOTFILE",
    });
  },
);

it
  .skipIf(process.platform === "win32")
  .each([null, "caller stopped", new Error("caller stopped")])(
  "rejects pre-aborted endpoint admission with exact reason %j",
  async (reason) => {
    const { endpoint, resources } = await fixture();
    const controller = new AbortController();
    controller.abort(reason);
    const result = await observeGhidraEndpoint(endpoint, {
      resourceScope: resources,
      signal: controller.signal,
    });
    if (result.ok) throw new Error("Expected pre-admission cancellation");
    expect(result.error.kind).toBe("cancelled");
    expect(result.error.cancellation?.reason).toBe(reason);
    expect(fault.handles).toEqual([]);
  },
);
