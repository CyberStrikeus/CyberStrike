import { expect, it, vi } from "vitest";
import { open, writeFile, unlink, truncate } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { join } from "node:path";
import { GpuCodeObjectsProvider } from "../../src/gpu/GpuCodeObjectsProvider.js";
import { parseEvidence } from "../../src/domain/evidence.js";
import {
  gpuCodeObjectsPartialSchema,
  gpuCodeObjectsSchema,
} from "../../src/domain/gpu/gpuCodeObjects.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";
import { amdFixture, cudaFixture } from "../fixtures/gpu/codeObjects.js";
type ReadFile = (
  buffer: Buffer,
  offset: number,
  length: number,
  position: number,
) => Promise<{ bytesRead: number; buffer: Buffer }>;
const fixture = async () => {
  const root = await createTestTempDirectory("rea-gpu-lifetime-"),
    path = join(root, "cuda"),
    bytes = cudaFixture();
  await writeFile(path, bytes);
  const handle = await open(path, "r");
  const prototype = Object.getPrototypeOf(handle) as { read: ReadFile };
  await handle.close();
  return { path, bytes, prototype, provider: new GpuCodeObjectsProvider() };
};
const interceptClose = (
  prototype: { read: ReadFile },
  override: (close: () => Promise<void>) => Promise<void>,
): (() => void) => {
  const read = prototype.read;
  let attached = false,
    restoreHandle: (() => void) | undefined;
  const spy = vi.spyOn(prototype, "read").mockImplementation(async function (
    this: FileHandle,
    ...args: Parameters<ReadFile>
  ) {
    if (!attached) {
      attached = true;
      const close = this.close.bind(this);
      const closeSpy = vi
        .spyOn(this, "close")
        .mockImplementation(() => override(close));
      restoreHandle = () => closeSpy.mockRestore();
    }
    return read.apply(this, args);
  });
  return () => {
    spy.mockRestore();
    restoreHandle?.();
  };
};
it("reserves the inspection work budget before reading aliased HIP payloads", async () => {
  const root = await createTestTempDirectory("rea-gpu-aliased-hip-"),
    path = join(root, "aliased-hip"),
    payload = amdFixture(),
    payloadSize = 128 * 1024 * 1024,
    id = Buffer.from("hipv4-amdgcn-amd-amdhsa--gfx900"),
    count = 12,
    start = 32 + count * (24 + id.length),
    directory = Buffer.alloc(start);
  directory.write("__CLANG_OFFLOAD_BUNDLE__");
  directory.writeBigUInt64LE(BigInt(count), 24);
  for (let index = 0; index < count; index++) {
    const at = 32 + index * (24 + id.length);
    directory.writeBigUInt64LE(BigInt(start), at);
    directory.writeBigUInt64LE(BigInt(payloadSize), at + 8);
    directory.writeBigUInt64LE(BigInt(id.length), at + 16);
    id.copy(directory, at + 24);
  }
  const file = await open(path, "w+");
  try {
    await file.write(directory, 0, directory.length, 0);
    await file.write(payload, 0, payload.length, start);
    await file.truncate(start + payloadSize);
  } finally {
    await file.close();
  }
  const handle = await open(path, "r"),
    prototype = Object.getPrototypeOf(handle) as { read: ReadFile };
  await handle.close();
  const read = prototype.read;
  let payloadReads = 0;
  const spy = vi.spyOn(prototype, "read").mockImplementation(async function (
    this: FileHandle,
    ...args: Parameters<ReadFile>
  ) {
    if (args[3] === start && args[2] === payloadSize) payloadReads++;
    return read.apply(this, args);
  });
  const provider = new GpuCodeObjectsProvider();
  try {
    const result = await provider.inspect({ path, analysis: "kernels" });
    if (!result.ok) throw result.error;
    expect(payloadReads).toBe(4);
    expect(result.value.objects.map((row) => row.inspection)).toEqual([
      ...Array<string>(4).fill("complete"),
      ...Array<string>(8).fill("capacity"),
    ]);
    expect(result.value.coverage.payloads).toBe("partial");
    expect(result.value.kernels).toHaveLength(4);
    expect(result.value.objects[4]!.sha256).toBeNull();
    expect(result.value.objects[4]!.limitations.join(" ")).toContain(
      "512 MiB per inspection",
    );
  } finally {
    spy.mockRestore();
    await provider.close();
  }
});
it("retains completed PTX facts and unknown root identity when a later payload is cancelled", async () => {
  const { path, bytes, prototype, provider } = await fixture();
  const controller = new AbortController(),
    reason = { selected: "caller-cancel" };
  const read = prototype.read;
  const secondHeader = 16 + 64 + Number(bytes.readBigUInt64LE(24));
  const spy = vi.spyOn(prototype, "read").mockImplementation(async function (
    this: FileHandle,
    ...args: Parameters<ReadFile>
  ) {
    const result = await read.apply(this, args);
    if (args[3] === secondHeader && args[2] === 64) controller.abort(reason);
    return result;
  });
  try {
    const result = await provider.inspect(
      { path, analysis: "kernels" },
      { signal: controller.signal },
    );
    expect(result).toMatchObject({
      ok: false,
      error: { _tag: "AnalysisCancelledError", cause: reason },
    });
    if (result.ok) throw new Error("expected cancellation");
    const evidence = parseEvidence(result.error.partialObservation);
    const report = gpuCodeObjectsPartialSchema.parse(
      evidence.normalized_result,
    );
    expect(report.artifact).toMatchObject({
      sha256: null,
      file_identity: "unverified",
    });
    expect(report.kernels[0]!.name).toBe("add_one");
    expect(report.ptx_artifacts).toHaveLength(1);
  } finally {
    spy.mockRestore();
    await provider.close();
  }
});
it("retains a failed descriptor close, blocks admission until retry and clears the exact cleanup marker", async () => {
  const { path, prototype, provider } = await fixture();
  let failures = 2;
  const restore = interceptClose(prototype, async (close) => {
    if (failures-- > 0) throw new Error("owned close failure");
    await close();
  });
  try {
    const result = await provider.inspect({ path, analysis: "kernels" });
    if (result.ok) throw new Error("expected cleanup failure");
    expect(result.error.cleanupIncomplete).toBe(true);
    expect(
      gpuCodeObjectsSchema.parse(
        parseEvidence(result.error.partialObservation).normalized_result,
      ).kernels,
    ).toHaveLength(2);
    const blocked = await provider.inspect({ path, analysis: "inventory" });
    expect(blocked.ok).toBe(false);
    const reopened = await provider.inspect({ path, analysis: "inventory" });
    expect(reopened.ok).toBe(true);
    expect(result.error.cleanupIncomplete).toBe(false);
  } finally {
    restore();
    await provider.close();
  }
});
it("preserves completed observations when caller cancellation arrives during final close", async () => {
  const { path, prototype, provider } = await fixture();
  const controller = new AbortController();
  const reason = { selected: "final-close-cancel" };
  const restore = interceptClose(prototype, async (close) => {
    await close();
    controller.abort(reason);
  });
  try {
    const result = await provider.inspect(
      { path, analysis: "kernels" },
      { signal: controller.signal },
    );
    if (result.ok) throw new Error("expected final-close cancellation");
    expect(result.error).toMatchObject({
      _tag: "AnalysisCancelledError",
      cause: reason,
    });
    expect(
      gpuCodeObjectsSchema.parse(
        parseEvidence(result.error.partialObservation).normalized_result,
      ).kernels,
    ).toHaveLength(2);
    expect(result.error.cleanupIncomplete).toBe(false);
  } finally {
    restore();
    await provider.close();
  }
});

it("joins an admitted file read during shutdown and rejects overlapping work", async () => {
  const { path, prototype, provider } = await fixture();
  let entered!: () => void, release!: () => void;
  const admitted = new Promise<void>((resolve) => {
      entered = resolve;
    }),
    barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
  const read = prototype.read;
  let blocked = false;
  const spy = vi.spyOn(prototype, "read").mockImplementation(async function (
    this: FileHandle,
    ...args: Parameters<ReadFile>
  ) {
    if (!blocked) {
      blocked = true;
      entered();
      await barrier;
    }
    return read.apply(this, args);
  });
  let active: ReturnType<GpuCodeObjectsProvider["inspect"]> | undefined;
  let closing: Promise<void> | undefined;
  try {
    active = provider.inspect({ path, analysis: "kernels" });
    await admitted;
    let closed = false;
    closing = provider.close().then(() => {
      closed = true;
    });
    const overlap = await provider.inspect({ path, analysis: "inventory" });
    expect(overlap).toMatchObject({
      ok: false,
      error: { _tag: "AnalysisResourceConstraintError" },
    });
    expect(closed).toBe(false);
    release();
    const result = await active;
    expect(result.ok).toBe(true);
    await closing;
    expect(closed).toBe(true);
  } finally {
    release();
    await active;
    await closing;
    spy.mockRestore();
    await provider.close();
  }
});

it("classifies removal of an admitted named source as changed identity", async () => {
  const { path, prototype, provider } = await fixture();
  const read = prototype.read;
  let removed = false;
  const spy = vi.spyOn(prototype, "read").mockImplementation(async function (
    this: FileHandle,
    ...args: Parameters<ReadFile>
  ) {
    const result = await read.apply(this, args);
    if (!removed) {
      removed = true;
      await unlink(path);
    }
    return result;
  });
  try {
    const result = await provider.inspect({ path, analysis: "kernels" });
    expect(result).toMatchObject({
      ok: false,
      error: { _tag: "AnalysisArtifactChangedError" },
    });
  } finally {
    spy.mockRestore();
    await provider.close();
  }
});
it("reports a source shortened during the streaming hash as changed identity", async () => {
  const { path, prototype, provider } = await fixture();
  await writeFile(path, Buffer.alloc(2 * 1024 * 1024));
  const read = prototype.read;
  let shortened = false;
  const spy = vi.spyOn(prototype, "read").mockImplementation(async function (
    this: FileHandle,
    ...args: Parameters<ReadFile>
  ) {
    const result = await read.apply(this, args);
    if (!shortened) {
      shortened = true;
      await truncate(path, 0);
    }
    return result;
  });
  try {
    const result = await provider.inspect({ path, analysis: "inventory" });
    expect(result).toMatchObject({
      ok: false,
      error: { _tag: "AnalysisArtifactChangedError" },
    });
  } finally {
    spy.mockRestore();
    await provider.close();
  }
});
