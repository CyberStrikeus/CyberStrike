import { access, mkdir, open, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { createPackage } from "@electron/asar";
import { expect, it, onTestFinished, vi } from "vitest";

import { ArtifactProvider } from "../../../../src/artifacts/ArtifactProvider.js";
import { parseBinaryTarget } from "../../../../src/application/BinaryTargetResolver.js";
import { ArtifactReaderFailure } from "../../../../src/artifacts/ArtifactReader.js";
import { AsarArtifactReader } from "../../../../src/artifacts/AsarArtifactReader.js";
import { SafeOutputTree } from "../../../../src/artifacts/SafeOutputTree.js";
import { ProviderCleanupError } from "../../../../src/domain/providerCleanupError.js";
import { createTestTempDirectory } from "../../../fixtures/temporaryDirectory.js";

const deferred = () => {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

const createArchive = async () => {
  const root = await createTestTempDirectory("rea-artifact-cleanup-retry-");
  const contents = join(root, "contents");
  await mkdir(contents);
  await writeFile(join(contents, "payload.txt"), "payload\n");
  const archive = join(root, "fixture.asar");
  await createPackage(contents, archive);
  return { root, archive };
};

const createClient = async (path: string) => {
  const target = await parseBinaryTarget(path);
  if (!target.ok) throw target.error;
  return new ArtifactProvider(process.env).createClient(target.value);
};

it("retains a failed reader close, blocks new work, and retries the same reader", async () => {
  const { root, archive } = await createArchive();
  const output = join(root, "output");
  const client = await createClient(archive);
  const originalClose = AsarArtifactReader.prototype.close;
  const closeOwners: AsarArtifactReader[] = [];
  let readerCloseBlocked = true;
  onTestFinished(async () => {
    readerCloseBlocked = false;
    try {
      await client.close();
    } finally {
      vi.restoreAllMocks();
    }
  });
  vi.spyOn(AsarArtifactReader.prototype, "close").mockImplementation(
    async function (this: AsarArtifactReader) {
      closeOwners.push(this);
      if (closeOwners[1] === this && readerCloseBlocked)
        throw new ArtifactReaderFailure(
          "unavailable",
          "injected reader close failure",
        );
      await originalClose.call(this);
    },
  );

  const extraction = await client.execute("extract_artifact", {
    output_root: output,
  });
  expect(extraction).toMatchObject({
    ok: false,
    error: {
      _tag: "ArtifactOperationError",
      reason: "unavailable",
      cleanup: { resources: [expect.stringContaining("artifact reader")] },
    },
  });
  await expect(access(output)).rejects.toThrow();
  expect(closeOwners).toHaveLength(2);

  const blocked = await client.execute("inventory_artifact", {});
  expect(blocked).toMatchObject({
    ok: false,
    error: { _tag: "ArtifactOperationError", reason: "unavailable" },
  });
  expect(closeOwners).toHaveLength(3);
  expect(closeOwners[2]).toBe(closeOwners[1]);

  const incompleteClose = await client.close();
  expect(incompleteClose.ok).toBe(false);
  if (incompleteClose.ok) throw new Error("Expected reader cleanup failure");
  expect(incompleteClose.error).toBeInstanceOf(ProviderCleanupError);
  expect(closeOwners).toHaveLength(4);
  expect(closeOwners[3]).toBe(closeOwners[1]);
  readerCloseBlocked = false;
  expect(await client.close()).toMatchObject({ ok: true });
  expect(closeOwners).toHaveLength(5);
  expect(closeOwners[4]).toBe(closeOwners[1]);
  if (!extraction.ok) expect(extraction.error.cleanupIncomplete).toBe(false);
  expect(incompleteClose.error.cleanupIncomplete).toBe(false);
  const closed = await client.execute("inventory_artifact", {});
  expect(closed).toMatchObject({
    ok: false,
    error: { _tag: "ArtifactOperationError", reason: "unavailable" },
  });
});

it("retains a failed rollback owner and preserves the materialization failure", async () => {
  const { root, archive } = await createArchive();
  const output = join(root, "output");
  const client = await createClient(archive);
  const originalWrite = SafeOutputTree.prototype.write;
  const originalRollback = SafeOutputTree.prototype.rollback;
  const rollbackOwners: SafeOutputTree[] = [];
  let failRollback = true;
  onTestFinished(async () => {
    await client.close();
    vi.restoreAllMocks();
  });
  vi.spyOn(SafeOutputTree.prototype, "write").mockImplementation(
    async function (
      this: SafeOutputTree,
      ...args: Parameters<SafeOutputTree["write"]>
    ) {
      const [relativePath, stream, expected, signal] = args;
      const written = await originalWrite.call(
        this,
        relativePath,
        stream,
        expected,
        signal,
      );
      expect(written.bytesWritten).toBeGreaterThan(0);
      throw new ArtifactReaderFailure(
        "unavailable",
        "primary materialization failure",
      );
    },
  );
  vi.spyOn(SafeOutputTree.prototype, "rollback").mockImplementation(
    async function (this: SafeOutputTree) {
      rollbackOwners.push(this);
      if (failRollback) {
        failRollback = false;
        throw new Error("injected rollback failure");
      }
      return originalRollback.call(this);
    },
  );

  const extraction = await client.execute("extract_artifact", {
    output_root: output,
  });
  expect(extraction).toMatchObject({
    ok: false,
    error: {
      _tag: "ArtifactOperationError",
      reason: "unavailable",
      detail: expect.stringContaining("primary materialization failure"),
      cleanup: { resources: [output] },
    },
  });
  expect(rollbackOwners).toHaveLength(1);
  await access(output);
  expect(await client.close()).toMatchObject({ ok: true });
  expect(rollbackOwners).toHaveLength(2);
  expect(rollbackOwners[1]).toBe(rollbackOwners[0]);
  await expect(access(output)).rejects.toThrow();
});

it("retains a tree whose setup failed after root identity was captured", async () => {
  const { root, archive } = await createArchive();
  const output = join(root, "output");
  const blocker = join(output, "unowned.txt");
  const client = await createClient(archive);
  const prototypeHandle = await open(join(root, "prototype-handle"), "w");
  const handlePrototype = Object.getPrototypeOf(prototypeHandle) as Pick<
    typeof prototypeHandle,
    "chmod"
  >;
  await prototypeHandle.close();
  await rm(join(root, "prototype-handle"));
  onTestFinished(async () => {
    vi.restoreAllMocks();
    await rm(blocker, { force: true });
    await client.close();
  });
  vi.spyOn(handlePrototype, "chmod").mockImplementationOnce(async function (
    this: typeof prototypeHandle,
  ) {
    await writeFile(blocker, "keep until owner retry");
    throw new Error("injected output setup failure");
  });

  const extraction = await client.execute("extract_artifact", {
    output_root: output,
  });
  expect(extraction).toMatchObject({
    ok: false,
    error: {
      _tag: "ArtifactOperationError",
      detail: expect.stringContaining("injected output setup failure"),
      cleanup: { resources: [output] },
    },
  });
  expect(await readFile(blocker, "utf8")).toBe("keep until owner retry");
  await rm(blocker);
  expect(await client.close()).toMatchObject({ ok: true });
  await expect(access(output)).rejects.toThrow();
});

it("waits for admitted extraction before close and rejects later work", async () => {
  const { root, archive } = await createArchive();
  const output = join(root, "output");
  const client = await createClient(archive);
  const originalWrite = SafeOutputTree.prototype.write;
  const started = deferred();
  const finish = deferred();
  let writeCalls = 0;
  let closeFinished = false;
  onTestFinished(async () => {
    finish.resolve();
    await client.close();
    vi.restoreAllMocks();
  });
  vi.spyOn(SafeOutputTree.prototype, "write").mockImplementation(
    async function (
      this: SafeOutputTree,
      ...args: Parameters<SafeOutputTree["write"]>
    ) {
      const [relativePath, stream, expected, signal] = args;
      writeCalls += 1;
      const written = await originalWrite.call(
        this,
        relativePath,
        stream,
        expected,
        signal,
      );
      started.resolve();
      await finish.promise;
      return written;
    },
  );

  const extraction = client.execute("extract_artifact", {
    output_root: output,
  });
  await Promise.race([
    started.promise,
    extraction.then((result) => {
      if (!result.ok) throw result.error;
      throw new Error("Extraction completed before reaching its write stage");
    }),
  ]);
  const closing = client.close().then((result) => {
    closeFinished = true;
    return result;
  });
  const concurrent = await client.execute("extract_artifact", {
    output_root: join(root, "rejected-output"),
  });
  expect(concurrent).toMatchObject({
    ok: false,
    error: { _tag: "ArtifactOperationError", reason: "unavailable" },
  });
  expect(writeCalls).toBe(1);
  await Promise.resolve();
  expect(closeFinished).toBe(false);
  finish.resolve();
  const completed = await extraction;
  expect(completed.ok).toBe(true);
  expect(await closing).toMatchObject({ ok: true });
  expect(await readFile(join(output, "payload.txt"), "utf8")).toBe("payload\n");
});
