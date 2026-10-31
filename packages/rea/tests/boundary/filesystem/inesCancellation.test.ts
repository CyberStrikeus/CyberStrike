import { createHash } from "node:crypto";
import { open, writeFile, type FileHandle } from "node:fs/promises";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { parseBinaryTarget } from "../../../src/application/BinaryTargetResolver.js";
import { InesArtifactReader } from "../../../src/artifacts/InesArtifactReader.js";
import { scanReader } from "../../../src/artifacts/inventory/scanReader.js";
import { hashStableRootArtifactHandle } from "../../../src/artifacts/inventory/hashStableRootArtifact.js";
import { inventoryArtifact } from "../../fixtures/artifactInventory.js";
import { inesFixture } from "../../fixtures/ines.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { RetainedRegularFileCleanupFailure } from "../../../src/application/RegularFileRead.js";

// Complete the real I/O, then cancel while its caller is still awaiting it.
const cancelAfterNextStat = (
  handle: FileHandle,
  controller: AbortController,
  mutate?: () => Promise<void>,
) => {
  const original = handle.stat.bind(handle);
  const stat = vi
    .spyOn(handle, "stat")
    .mockImplementationOnce(async (...args) => {
      await mutate?.();
      const observed = await original(...args);
      controller.abort();
      return observed;
    });
  return () => stat.mockRestore();
};

const malformed = (format: string) => {
  if (format === "UNIF") return Buffer.from("UNIF");
  const bytes = inesFixture();
  if (format === "NES 2.0") {
    bytes[7] = 8;
    return bytes;
  }
  return bytes.subarray(0, 20);
};

it.each(["default", "caller-error", "failed-close"])(
  "preserves cancellation and descriptor ownership during %s admission",
  async (reasonKind) => {
    const root = await createTestTempDirectory("rea-ines-cancel-admission-");
    const path = join(root, "source.nes");
    await writeFile(path, inesFixture());
    const sample = await open(path, "r");
    const prototype = Object.getPrototypeOf(sample) as Pick<FileHandle, "stat">;
    await sample.close();
    const original = prototype.stat;
    const controller = new AbortController();
    let admitted: FileHandle | undefined;
    const cleanupFailure = new Error("descriptor close failed");
    const callerReason = new Error("caller stopped admission");
    let restoreClose = () => {};
    const stat = vi
      .spyOn(prototype, "stat")
      .mockImplementationOnce(async function (this: FileHandle, ...args) {
        admitted = this;
        const observed = await original.call(this, ...args);
        if (reasonKind === "failed-close") {
          const close = vi
            .spyOn(this, "close")
            .mockRejectedValueOnce(cleanupFailure);
          restoreClose = () => close.mockRestore();
        }
        controller.abort(
          reasonKind === "caller-error" ? callerReason : undefined,
        );
        return observed;
      });
    try {
      const result = parseBinaryTarget(path, { signal: controller.signal });
      if (reasonKind === "failed-close") {
        const failure = await result;
        if (failure.ok) throw new Error("Expected a retained cleanup failure");
        expect(failure.error.cleanupIncomplete).toBe(true);
        expect(failure.error.cause).toBeInstanceOf(
          RetainedRegularFileCleanupFailure,
        );
        const retained = failure.error
          .cause as RetainedRegularFileCleanupFailure;
        expect(retained.cleanupCause).toBe(cleanupFailure);
        expect(retained.outcome).toMatchObject({ kind: "failed" });
        await retained.cleanupLease.release();
        expect(failure.error.cleanupIncomplete).toBe(false);
      } else {
        const cancelled = await result;
        expect(cancelled).toMatchObject({
          ok: false,
          error: {
            _tag: "AnalysisCancelledError",
            operation: "resolve_binary_target",
          },
        });
        if (cancelled.ok) throw new Error("Expected cancellation");
        if (reasonKind === "caller-error")
          expect(cancelled.error.cause).toBe(callerReason);
      }
      if (admitted === undefined)
        throw new Error("Admission descriptor was not observed");
      await expect(admitted.stat()).rejects.toMatchObject({ code: "EBADF" });
    } finally {
      restoreClose();
      stat.mockRestore();
    }
  },
);

it.each([
  ["truncated", "read"],
  ["NES 2.0", "read"],
  ["UNIF", "read"],
  ["truncated", "validation"],
  ["NES 2.0", "validation"],
  ["UNIF", "validation"],
])("honors cancellation during %s root prefix %s", async (format, phase) => {
  const root = await createTestTempDirectory("rea-ines-cancel-prefix-");
  const path = join(root, "source.nes");
  await writeFile(path, malformed(format));
  const sample = await open(path, "r");
  const prototype = Object.getPrototypeOf(sample) as Pick<FileHandle, "read">;
  await sample.close();
  const original = prototype.read;
  const controller = new AbortController();
  let admitted: FileHandle | undefined;
  let restoreStat = () => {};
  const read = vi
    .spyOn(prototype, "read")
    .mockImplementationOnce(async function (this: FileHandle, ...args) {
      admitted = this;
      const observed = await original.call(this, ...args);
      if (phase === "read") controller.abort();
      else restoreStat = cancelAfterNextStat(this, controller);
      return observed;
    });
  try {
    await expect(
      inventoryArtifact(path, { signal: controller.signal }),
    ).rejects.toMatchObject({ reason: "cancelled" });
    expect(controller.signal.aborted).toBe(true);
    if (admitted === undefined)
      throw new Error("Prefix descriptor was not observed");
    await expect(admitted.stat()).rejects.toMatchObject({ code: "EBADF" });
  } finally {
    restoreStat();
    read.mockRestore();
  }
});

it("honors cancellation during malformed reader header validation", async () => {
  const root = await createTestTempDirectory("rea-ines-cancel-header-");
  const path = join(root, "source.nes");
  await writeFile(path, malformed("truncated"));
  const handle = await open(path, "r");
  const reader = new InesArtifactReader(path, {
    handle,
    initial: await handle.stat(),
  });
  const controller = new AbortController();
  const original = handle.read.bind(handle);
  let restoreStat = () => {};
  const read = vi
    .spyOn(handle, "read")
    .mockImplementationOnce(async (...args) => {
      const observed = await original(...args);
      restoreStat = cancelAfterNextStat(handle, controller);
      return observed;
    });
  try {
    await expect(
      reader.entries(controller.signal)[Symbol.asyncIterator]().next(),
    ).rejects.toMatchObject({ reason: "cancelled" });
    expect(controller.signal.aborted).toBe(true);
  } finally {
    restoreStat();
    read.mockRestore();
    await reader.close();
    await handle.close();
  }
});

it.each(["stream", "reconstruction"])(
  "does not complete %s after cancellation in the final region validation",
  async (operation) => {
    const root = await createTestTempDirectory("rea-ines-cancel-region-");
    const path = join(root, "source.nes");
    const bytes = inesFixture();
    await writeFile(path, bytes);
    const handle = await open(path, "r");
    const reader = new InesArtifactReader(path, {
      handle,
      initial: await handle.stat(),
    });
    const controller = new AbortController();
    let restoreStat = () => {};
    const original = handle.read.bind(handle);
    const read = vi
      .spyOn(handle, "read")
      .mockImplementation(async (...args) => {
        const observed = await original(...args);
        const arguments_: readonly unknown[] = args;
        const position = arguments_[3];
        if (
          (typeof position === "number" || typeof position === "bigint") &&
          observed.bytesRead > 0 &&
          Number(position) + observed.bytesRead === bytes.length
        )
          restoreStat = cancelAfterNextStat(handle, controller);
        return observed;
      });
    try {
      const entries = [];
      for await (const entry of reader.entries()) entries.push(entry);
      const last = entries.at(-1);
      if (last === undefined) throw new Error("Missing last iNES region");
      const result =
        operation === "reconstruction"
          ? (async () => {
              const { inesRegionScan } = await scanReader(
                reader,
                [reader],
                controller.signal,
              );
              if (inesRegionScan === undefined)
                throw new Error("Missing region scan");
              return reader.verifyReconstruction(
                createHash("sha256").update(bytes).digest("hex"),
                inesRegionScan,
                controller.signal,
              );
            })()
          : (async () => {
              for await (const chunk of await reader.open(
                last,
                controller.signal,
              ))
                expect(Buffer.isBuffer(chunk)).toBe(true);
            })();
      await expect(result).rejects.toMatchObject({ reason: "cancelled" });
      expect(controller.signal.aborted).toBe(true);
    } finally {
      restoreStat();
      read.mockRestore();
      await reader.close();
      await handle.close();
    }
  },
);

it("does not publish a root digest cancelled during its final state check", async () => {
  const root = await createTestTempDirectory("rea-ines-cancel-hash-");
  const path = join(root, "source.nes");
  await writeFile(path, inesFixture());
  const handle = await open(path, "r");
  const initial = await handle.stat();
  const controller = new AbortController();
  const restore = cancelAfterNextStat(handle, controller);
  try {
    await expect(
      hashStableRootArtifactHandle(path, handle, initial, controller.signal),
    ).rejects.toMatchObject({ reason: "cancelled" });
    expect(controller.signal.aborted).toBe(true);
  } finally {
    restore();
    await handle.close();
  }
});

it.each([
  ["prefix", false],
  ["prefix", true],
  ["hash", false],
  ["hash", true],
] as const)(
  "cancels target %s validation with concurrent change=%s",
  async (phase, changed) => {
    const root = await createTestTempDirectory("rea-ines-cancel-target-");
    const path = join(root, "source.nes");
    await writeFile(path, inesFixture());
    const sample = await open(path, "r");
    const prototype = Object.getPrototypeOf(sample) as Pick<FileHandle, "read">;
    await sample.close();
    const original = prototype.read;
    const controller = new AbortController();
    let admitted: FileHandle | undefined;
    let restoreStat = () => {};
    const read = vi.spyOn(prototype, "read").mockImplementation(async function (
      this: FileHandle,
      ...args
    ) {
      const observed = await original.call(this, ...args);
      if (
        admitted === undefined &&
        (phase === "prefix" || observed.bytesRead === 0)
      ) {
        admitted = this;
        restoreStat = cancelAfterNextStat(
          this,
          controller,
          changed ? () => writeFile(path, "changed cartridge") : undefined,
        );
      }
      return observed;
    });
    try {
      expect(
        await parseBinaryTarget(path, { signal: controller.signal }),
      ).toMatchObject({ ok: false, error: { _tag: "AnalysisCancelledError" } });
      expect(controller.signal.aborted).toBe(true);
      if (admitted === undefined)
        throw new Error("Hash descriptor was not observed");
      await expect(admitted.stat()).rejects.toMatchObject({ code: "EBADF" });
    } finally {
      restoreStat();
      read.mockRestore();
    }
  },
);
