import { createHash } from "node:crypto";
import { open, stat, writeFile, type FileHandle } from "node:fs/promises";
import { join } from "node:path";
import { expect, onTestFinished, test, vi } from "vitest";

import { ProviderCleanupError } from "../../../src/domain/providerCleanupError.js";
import { OwnedFileHandle } from "../../../src/filesystem/OwnedFileHandle.js";
import { PcapSnapshot } from "../../../src/pcap/PcapSnapshot.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

const opaqueCleanupReason = () =>
  new ProviderCleanupError(
    "caller-owned",
    ["caller-owned-resource"],
    { reason: "opaque abort reason" },
    { operation: "caller_operation" },
  );

const makeCapture = async () => {
  const parent = await createTestTempDirectory("rea-pcap-snapshot-cancel-");
  const path = join(parent, "capture.pcap");
  const contents = Buffer.from("capture bytes for snapshot cancellation");
  await writeFile(path, contents);
  return { parent, path, contents };
};

test.each([
  ["null", null],
  ["string", "caller stopped"],
  ["foreign typed error", opaqueCleanupReason()],
] as const)(
  "preserves the exact opaque %s reason at snapshot admission",
  async (_label, reason) => {
    const { path } = await makeCapture();
    const snapshot = await PcapSnapshot.create();
    onTestFinished(() => snapshot.close());
    const controller = new AbortController();
    controller.abort(reason);

    const error = await snapshot
      .capture(path, controller.signal)
      .catch((e) => e);
    expect(error).toMatchObject({ _tag: "AnalysisCancelledError" });
    expect(error.cause).toBe(reason);
    if (reason instanceof ProviderCleanupError) {
      expect(reason.cleanupIncomplete).toBe(true);
      expect(reason.cleanupResources).toEqual(["caller-owned-resource"]);
      expect(error.cleanupResources).not.toContain("caller-owned-resource");
    }
  },
);

test("keeps a physical read failure primary when abort arrives with it", async () => {
  const { path } = await makeCapture();
  const snapshot = await PcapSnapshot.create();
  onTestFinished(() => snapshot.close());
  const controller = new AbortController();
  const probe = await open(path, "r");
  const prototype = Object.getPrototypeOf(probe) as {
    read: FileHandle["read"];
  };
  await probe.close();
  const physicalFailure = new Error("injected source read failure");
  const read = vi.spyOn(prototype, "read").mockImplementationOnce(async () => {
    controller.abort("late caller cancellation");
    throw physicalFailure;
  });
  onTestFinished(() => read.mockRestore());

  const error = await snapshot.capture(path, controller.signal).catch((e) => e);
  expect(error).toMatchObject({ _tag: "AnalysisInputError" });
  expect(error.cause).toBe(physicalFailure);
});

test("maps cancellation observed after owned handle close exactly once", async () => {
  const { path } = await makeCapture();
  const snapshot = await PcapSnapshot.create();
  onTestFinished(() => snapshot.close());
  const controller = new AbortController();
  const reason = opaqueCleanupReason();
  const close = OwnedFileHandle.prototype.close;
  const closeSpy = vi
    .spyOn(OwnedFileHandle.prototype, "close")
    .mockImplementation(async function (this: OwnedFileHandle) {
      await close.call(this);
      if (!controller.signal.aborted) controller.abort(reason);
    });
  onTestFinished(() => closeSpy.mockRestore());

  const error = await snapshot.capture(path, controller.signal).catch((e) => e);
  expect(error).toMatchObject({ _tag: "AnalysisCancelledError" });
  expect(error.cause).toBe(reason);
});

test("verify maps cancellation after final descriptor close exactly once", async () => {
  const { path, contents } = await makeCapture();
  const snapshot = await PcapSnapshot.create();
  onTestFinished(() => snapshot.close());
  const identity = {
    bytes: contents.length,
    sha256: createHash("sha256").update(contents).digest("hex"),
  };
  await snapshot.capture(path);
  const controller = new AbortController();
  const reason = opaqueCleanupReason();
  const close = OwnedFileHandle.prototype.close;
  const closeSpy = vi
    .spyOn(OwnedFileHandle.prototype, "close")
    .mockImplementation(async function (this: OwnedFileHandle) {
      await close.call(this);
      if (!controller.signal.aborted) controller.abort(reason);
    });
  onTestFinished(() => closeSpy.mockRestore());

  const error = await snapshot
    .verify(identity, path, controller.signal)
    .catch((e) => e);
  expect(error).toMatchObject({ _tag: "AnalysisCancelledError" });
  expect(error.cause).toBe(reason);
  expect(reason.cleanupIncomplete).toBe(true);
  expect(reason.cleanupResources).toEqual(["caller-owned-resource"]);
});

test("close failure during final cancellation retains owner and resolves its marker on retry", async () => {
  const { path, contents } = await makeCapture();
  const snapshot = await PcapSnapshot.create();
  onTestFinished(() => snapshot.close());
  const identity = {
    bytes: contents.length,
    sha256: createHash("sha256").update(contents).digest("hex"),
  };
  await snapshot.capture(path);
  const controller = new AbortController();
  const reason = opaqueCleanupReason();
  const closeFailure = new Error("injected final descriptor close failure");
  let retained: FileHandle | undefined;
  const closeSpy = vi
    .spyOn(OwnedFileHandle.prototype, "close")
    .mockImplementationOnce(async function (this: OwnedFileHandle) {
      retained = this.handle;
      controller.abort(reason);
      throw closeFailure;
    });
  onTestFinished(() => closeSpy.mockRestore());

  const error = await snapshot
    .verify(identity, path, controller.signal)
    .catch((e) => e);
  expect(error).toMatchObject({
    _tag: "AnalysisCancelledError",
    cleanupIncomplete: true,
  });
  expect(error.cause).toBe(reason);
  expect(error.cleanupResources).toContain(snapshot.path);
  expect(error.secondaryFailures).toHaveLength(1);
  expect(error.secondaryFailures[0]).toMatchObject({
    _tag: "ProviderAdapterError",
  });
  expect(error.secondaryFailures[0].cause).toBe(closeFailure);
  expect(retained?.fd).toBeGreaterThanOrEqual(0);
  expect(reason.cleanupIncomplete).toBe(true);
  expect(reason.cleanupResources).toEqual(["caller-owned-resource"]);

  closeSpy.mockRestore();
  await snapshot.close();
  expect(retained?.fd).toBe(-1);
  expect(error.cleanupIncomplete).toBe(false);
  expect(error.cleanupResources).toEqual([]);
  expect(reason.cleanupIncomplete).toBe(true);
  await expect(stat(snapshot.path)).rejects.toMatchObject({ code: "ENOENT" });
});

test("retains an open descriptor after failed close and releases it on retry", async () => {
  const { path, contents } = await makeCapture();
  const snapshot = await PcapSnapshot.create();
  onTestFinished(() => snapshot.close());
  const identity = {
    bytes: contents.length,
    sha256: createHash("sha256").update(contents).digest("hex"),
  };
  await snapshot.capture(path);
  const closeFailure = new Error("injected descriptor close failure");
  let retained: FileHandle | undefined;
  const closeSpy = vi
    .spyOn(OwnedFileHandle.prototype, "close")
    .mockImplementationOnce(async function (this: OwnedFileHandle) {
      retained = this.handle;
      throw closeFailure;
    });
  onTestFinished(() => closeSpy.mockRestore());

  const error = await snapshot.verify(identity, path).catch((e) => e);
  expect(error).toBeInstanceOf(ProviderCleanupError);
  expect(error.cause).toBe(closeFailure);
  expect(error.cleanupIncomplete).toBe(true);
  expect(error.cleanupResources).toContain(snapshot.path);
  expect(retained?.fd).toBeGreaterThanOrEqual(0);

  closeSpy.mockRestore();
  await snapshot.close();
  expect(retained?.fd).toBe(-1);
  expect(error.cleanupIncomplete).toBe(false);
  await expect(stat(snapshot.path)).rejects.toMatchObject({ code: "ENOENT" });
});
