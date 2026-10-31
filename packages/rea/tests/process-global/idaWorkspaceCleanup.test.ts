import { createHash } from "node:crypto";
import { access, readFile, writeFile, type FileHandle } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";

import { ArtifactFileCleanupFailure } from "../../src/artifacts/ArtifactFileOperation.js";
import { ArtifactReaderFailure } from "../../src/artifacts/ArtifactReader.js";
import { parseBinaryTarget } from "../../src/application/BinaryTargetResolver.js";
import { elf } from "../../src/domain/binaryTarget.fixture.js";
import { AnalysisProtocolError } from "../../src/domain/analysisErrorCore.js";
import { IdaWorkspace } from "../../src/ida/IdaWorkspace.js";
import { IdaSessionClient } from "../../src/ida/IdaSessionClient.js";
import { PrivateRuntimeRoot } from "../../src/process/PrivateRuntimeRoot.js";
import { RecordingIdaMcp } from "../fixtures/idaMcp.js";
import { createDeferred } from "../fixtures/binarySession.js";
import { awaitAcknowledgement } from "../fixtures/lifecycleAcknowledgement.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";

interface ObservedHandle {
  readonly path: string;
  readonly handle: FileHandle;
  readonly close: () => Promise<void>;
  closeAttempts: number;
}
interface CopyReadPort {
  read(
    buffer: Buffer,
    offset: number,
    length: number,
    position: number,
  ): Promise<{ bytesRead: number; buffer: Buffer }>;
}
const control = vi.hoisted(() => ({
  paths: new Set<string>(),
  handles: new Map<FileHandle, ObservedHandle>(),
  denied: new Map<string, unknown>(),
  install: undefined as ((record: ObservedHandle) => void) | undefined,
}));
vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...original,
    open: async (...args: Parameters<typeof original.open>) => {
      const handle = await original.open(...args);
      const path = String(args[0]);
      if (control.paths.has(path)) {
        const record = {
          handle,
          path,
          close: handle.close.bind(handle),
          closeAttempts: 0,
        };
        control.handles.set(handle, record);
        vi.spyOn(handle, "close").mockImplementation(async () => {
          record.closeAttempts++;
          if (control.denied.has(path)) throw control.denied.get(path);
          await record.close();
        });
        control.install?.(record);
      }
      return handle;
    },
  };
});
const workspaces = new Set<IdaWorkspace>();
const clients = new Set<IdaSessionClient>();
afterEach(async () => {
  control.install = undefined;
  control.denied.clear();
  vi.restoreAllMocks();
  for (const client of clients) {
    const closed = await client.close();
    if (!closed.ok) throw closed.error;
  }
  for (const workspace of workspaces) await workspace.remove();
  for (const record of control.handles.values())
    if (record.handle.fd >= 0) await record.close();
  control.handles.clear();
  control.paths.clear();
  workspaces.clear();
  clients.clear();
});

const fixture = async () => {
  const root = await createTestTempDirectory("rea-ida-copy-owner-");
  const path = join(root, "authored.elf");
  const bytes = elf(2, 1, 62);
  await writeFile(path, bytes);
  const resolved = await parseBinaryTarget(path);
  if (!resolved.ok) throw resolved.error;
  const workspace = await IdaWorkspace.allocate(resolved.value, root);
  workspaces.add(workspace);
  control.paths.add(resolved.value.path);
  control.paths.add(workspace.inputPath);
  return { root, workspace, target: resolved.value, bytes };
};
const failed = (operation: Promise<unknown>): Promise<unknown> =>
  operation.then(
    () => {
      throw new Error("Expected the controlled operation to fail");
    },
    (cause: unknown) => cause,
  );
const observed = (path: string): ObservedHandle => {
  const record = [...control.handles.values()].find(
    (record) => record.path === path,
  );
  if (record === undefined)
    throw new Error(`Selected descriptor was not observed: ${path}`);
  return record;
};

it("retains a source read failure and the exact refusing descriptor until workspace retry", async () => {
  const { workspace, target } = await fixture();
  const readFailure = new Error("selected source read EIO");
  const closeFailure = new Error("selected source close refused");
  control.denied.set(target.path, closeFailure);
  control.install = ({ handle, path }) => {
    if (path === target.path)
      vi.spyOn(handle, "read").mockRejectedValue(readFailure);
  };
  const failure = await failed(workspace.copyInput());
  if (!(failure instanceof ArtifactFileCleanupFailure)) throw failure;
  const outcome = failure.fileCleanupFailure.outcome;
  if (outcome.kind !== "failed")
    throw new Error("Source read failure became completed copy");
  expect(outcome.cause).toBe(readFailure);
  expect(failure.fileCleanupFailure.cleanupCause).toBe(closeFailure);
  const source = observed(target.path);
  expect(failure.fileCleanupFailure.owner.handle).toBe(source.handle);
  expect(source.handle.fd).toBeGreaterThanOrEqual(0);
  await expect(workspace.remove()).rejects.toBeInstanceOf(
    ArtifactReaderFailure,
  );
  await access(workspace.directory);
  control.denied.delete(target.path);
  await workspace.remove();
  expect(source.handle.fd).toBe(-1);
  await expect(access(workspace.directory)).rejects.toMatchObject({
    code: "ENOENT",
  });
});

it("keeps a private write failure primary and never retries a confirmed source close", async () => {
  const { workspace, target } = await fixture();
  const writeFailure = new Error("private write failed");
  control.denied.set(
    workspace.inputPath,
    new Error("private destination close refused"),
  );
  control.install = ({ handle, path }) => {
    if (path === workspace.inputPath)
      vi.spyOn(handle, "write").mockRejectedValue(writeFailure);
  };
  const failure = await failed(workspace.copyInput());
  if (!(failure instanceof ArtifactFileCleanupFailure)) throw failure;
  const outcome = failure.fileCleanupFailure.outcome;
  if (outcome.kind !== "failed")
    throw new Error("Private write failure became completed copy");
  expect(outcome.cause).toBe(writeFailure);
  const source = observed(target.path);
  const input = observed(workspace.inputPath);
  expect(source.handle.fd).toBe(-1);
  expect(input.handle.fd).toBeGreaterThanOrEqual(0);
  const confirmedSourceAttempts = source.closeAttempts;
  control.denied.delete(workspace.inputPath);
  await workspace.remove();
  expect(source.closeAttempts).toBe(confirmedSourceAttempts);
  expect(input.handle.fd).toBe(-1);
});

it("retains completed digest facts and both close owners, retrying only unresolved descriptors", async () => {
  const { workspace, target, bytes } = await fixture();
  control.denied.set(target.path, new Error("source close refused"));
  control.denied.set(
    workspace.inputPath,
    new Error("destination close refused"),
  );
  const failure = await failed(workspace.copyInput());
  if (!(failure instanceof ArtifactFileCleanupFailure)) throw failure;
  expect(workspace.inputSha256).toBe(
    createHash("sha256").update(bytes).digest("hex"),
  );
  expect(failure.cleanup?.resources.slice().sort()).toEqual(
    [target.path, workspace.inputPath].sort(),
  );
  const source = observed(target.path);
  const input = observed(workspace.inputPath);
  expect(source.handle.fd).toBeGreaterThanOrEqual(0);
  expect(input.handle.fd).toBeGreaterThanOrEqual(0);
  control.denied.delete(workspace.inputPath);
  await expect(workspace.remove()).rejects.toBeInstanceOf(
    ArtifactReaderFailure,
  );
  expect(input.handle.fd).toBe(-1);
  expect(source.handle.fd).toBeGreaterThanOrEqual(0);
  const confirmedInputAttempts = input.closeAttempts;
  control.denied.delete(target.path);
  await workspace.remove();
  expect(input.closeAttempts).toBe(confirmedInputAttempts);
  expect(source.handle.fd).toBe(-1);
});

it("preserves a digest mismatch through two rejected final closes", async () => {
  const { workspace, target } = await fixture();
  await writeFile(target.path, Buffer.from("changed after target admission"));
  control.denied.set(target.path, new Error("source close refused"));
  control.denied.set(
    workspace.inputPath,
    new Error("destination close refused"),
  );
  const failure = await failed(workspace.copyInput());
  if (!(failure instanceof ArtifactFileCleanupFailure)) throw failure;
  const sourceOutcome = failure.fileCleanupFailure.outcome;
  if (
    sourceOutcome.kind !== "failed" ||
    !(sourceOutcome.cause instanceof ArtifactFileCleanupFailure)
  )
    throw new Error(
      "Both descriptor failures did not retain the nested copy outcome",
    );
  const inputOutcome = sourceOutcome.cause.fileCleanupFailure.outcome;
  if (inputOutcome.kind !== "failed")
    throw new Error("Digest refusal became completed copy");
  expect(inputOutcome.cause).toBeInstanceOf(AnalysisProtocolError);
  expect(inputOutcome.cause).toMatchObject({
    message: expect.stringContaining("target changed"),
  });
  expect(workspace.inputSha256).toBeUndefined();
});

it("honors exact cancellation during copying and closes both descriptors", async () => {
  const { workspace, target } = await fixture();
  const controller = new AbortController();
  const reason = { caller: "copy checkpoint" };
  control.install = ({ handle, path }) => {
    if (path !== target.path) return;
    const reading: CopyReadPort = handle;
    const read = reading.read.bind(handle);
    vi.spyOn(reading, "read").mockImplementation(async () => {
      const result = await read(Buffer.alloc(1), 0, 1, 0);
      controller.abort(reason);
      return result;
    });
  };
  const failure = await failed(workspace.copyInput(controller.signal));
  expect(failure).toBeInstanceOf(ArtifactReaderFailure);
  expect(failure).toMatchObject({ reason: "cancelled", cause: reason });
  expect(workspace.inputSha256).toBeUndefined();
  expect(observed(target.path).handle.fd).toBe(-1);
  expect(observed(workspace.inputPath).handle.fd).toBe(-1);
});

it("retains verified copied bytes when cancellation arrives during final close", async () => {
  const { workspace, target, bytes } = await fixture();
  const controller = new AbortController();
  const reason = { caller: "final destination close" };
  control.install = ({ handle, path, close }) => {
    if (path !== workspace.inputPath) return;
    vi.spyOn(handle, "close").mockImplementation(async () => {
      await close();
      controller.abort(reason);
    });
  };
  const failure = await failed(workspace.copyInput(controller.signal));
  expect(failure).toMatchObject({ reason: "cancelled", cause: reason });
  expect(workspace.inputSha256).toBe(target.sha256);
  expect((await readFile(workspace.inputPath)).equals(bytes)).toBe(true);
  expect(observed(target.path).handle.fd).toBe(-1);
  expect(observed(workspace.inputPath).handle.fd).toBe(-1);
});

it("projects retained workspace descriptors through the real IDA session and clears their original cleanup on retry", async () => {
  const { root, target } = await fixture();
  const producer = new RecordingIdaMcp(target, "headless");
  const client = new IdaSessionClient(
    {
      command: "fixture",
      args: [],
      env: {},
      mode: "headless",
      timeoutMs: 1000,
      workspaceRoot: root,
    },
    target,
    producer,
  );
  clients.add(client);
  const readFailure = new Error("source read primary");
  control.denied.set(target.path, new Error("source final close refused"));
  control.install = ({ handle, path }) => {
    if (path === target.path)
      vi.spyOn(handle, "read").mockRejectedValue(readFailure);
  };
  const result = await client.execute("procedure_pseudo_code", {
    procedure: "main",
  });
  if (result.ok)
    throw new Error("Failed copy reached a successful IDA operation");
  expect(result.error.cleanupIncomplete).toBe(true);
  expect(result.error.cleanupPrimary?.cause).toBe(readFailure);
  expect(result.error.cleanupResources).toContain(target.path);
  expect(producer.calls.some(({ name }) => name === "idb_open")).toBe(false);
  const blocked = await client.close();
  if (blocked.ok) throw new Error("Client dropped its retained descriptor");
  expect(blocked.error.cleanupIncomplete).toBe(true);
  expect(observed(target.path).handle.fd).toBeGreaterThanOrEqual(0);
  const workspacePath = blocked.error.cleanupResources[0];
  if (workspacePath === undefined) throw new Error("Client lost its workspace");
  const removeFailure = new Error("selected private workspace removal refused");
  const remove = PrivateRuntimeRoot.prototype.close;
  const closeRoot = vi
    .spyOn(PrivateRuntimeRoot.prototype, "close")
    .mockImplementation(function (this: PrivateRuntimeRoot) {
      if (this.path === workspacePath) return Promise.reject(removeFailure);
      return remove.call(this);
    });
  control.denied.delete(target.path);
  const retainedWorkspace = await client.close();
  if (retainedWorkspace.ok)
    throw new Error("Client dropped its retained workspace");
  expect(retainedWorkspace.error.cause).toBe(removeFailure);
  expect(observed(target.path).handle.fd).toBe(-1);
  expect(result.error.cleanupIncomplete).toBe(false);
  expect(blocked.error.cleanupIncomplete).toBe(true);
  expect(retainedWorkspace.error.cleanupIncomplete).toBe(true);
  expect(blocked.error.cleanupResources).toEqual([workspacePath]);
  await access(workspacePath);
  closeRoot.mockRestore();
  const closed = await client.close();
  if (!closed.ok) throw closed.error;
  expect(result.error.cleanupIncomplete).toBe(false);
  expect(blocked.error.cleanupIncomplete).toBe(false);
  expect(retainedWorkspace.error.cleanupIncomplete).toBe(false);
  expect(blocked.error.cleanupResources).toEqual([]);
  expect(retainedWorkspace.error.cleanupResources).toEqual([]);
  expect(observed(target.path).handle.fd).toBe(-1);
  await expect(access(workspacePath)).rejects.toMatchObject({ code: "ENOENT" });
});

it("keeps final-close cancellation, completed digest facts and rejected source cleanup together", async () => {
  const { workspace, target } = await fixture();
  const controller = new AbortController();
  const reason = { caller: "source finalization" };
  const closeFailure = new Error("source close rejected during cancellation");
  let restore: (() => void) | undefined;
  control.install = ({ handle, path }) => {
    if (path !== target.path) return;
    const close = vi.spyOn(handle, "close").mockImplementation(async () => {
      controller.abort(reason);
      throw closeFailure;
    });
    restore = () => close.mockRestore();
  };
  const failure = await failed(workspace.copyInput(controller.signal));
  if (!(failure instanceof ArtifactFileCleanupFailure)) throw failure;
  expect(failure.fileCleanupFailure.outcome.kind).toBe("completed");
  expect(failure.fileCleanupFailure.completionCancellation?.reason).toBe(
    reason,
  );
  expect(failure.fileCleanupFailure.cleanupCause).toBe(closeFailure);
  expect(workspace.inputSha256).toBe(target.sha256);
  expect(observed(target.path).handle.fd).toBeGreaterThanOrEqual(0);
  restore?.();
  await workspace.remove();
  expect(observed(target.path).handle.fd).toBe(-1);
});

it("keeps shared IDA startup owned when the caller leaves during source finalization", async () => {
  const { root, target } = await fixture();
  const producer = new RecordingIdaMcp(target, "headless");
  const client = new IdaSessionClient(
    {
      command: "fixture",
      args: [],
      env: {},
      mode: "headless",
      timeoutMs: 1000,
      workspaceRoot: root,
    },
    target,
    producer,
  );
  clients.add(client);
  const controller = new AbortController();
  const reason = { caller: "shared startup finalization" };
  control.install = ({ handle, path, close }) => {
    if (path !== target.path) return;
    vi.spyOn(handle, "close").mockImplementation(async () => {
      await close();
      controller.abort(reason);
    });
  };
  const result = await client.execute(
    "procedure_pseudo_code",
    { procedure: "main" },
    { signal: controller.signal },
  );
  if (result.ok)
    throw new Error("Caller cancellation became a successful IDA operation");
  expect(result.error).toMatchObject({
    _tag: "AnalysisCancelledError",
    cause: reason,
  });
  const closed = await client.close();
  if (!closed.ok) throw closed.error;
  expect(observed(target.path).handle.fd).toBe(-1);
});

it("joins an admitted copy before removing its root and refuses new copy admission", async () => {
  const { workspace, target } = await fixture();
  const entered = createDeferred<void>();
  const release = createDeferred<void>();
  control.install = ({ handle, path }) => {
    if (path !== target.path) return;
    const reading: CopyReadPort = handle;
    const read = reading.read.bind(handle);
    vi.spyOn(reading, "read").mockImplementation(async (...args) => {
      entered.resolve();
      await release.promise;
      return read(...args);
    });
  };
  const copying = workspace.copyInput();
  let removing: Promise<void> | undefined;
  try {
    await awaitAcknowledgement(entered.promise, copying, "selected copy read");
    let removed = false;
    removing = workspace.remove().then(() => {
      removed = true;
    });
    await expect(workspace.copyInput()).rejects.toMatchObject({
      message: "Artifact resource scope is closed",
    });
    expect(removed).toBe(false);
    await access(workspace.directory);
    release.resolve();
    await copying;
    await removing;
    expect(workspace.inputSha256).toBe(target.sha256);
  } finally {
    release.resolve();
    await Promise.allSettled([copying, removing]);
  }
});
