import { expect, it } from "vitest";
import { GpuInventory } from "./GpuInventory.js";
import { GpuBufferSource } from "./GpuSource.js";
import { assertArtifactReadActive } from "../artifacts/ArtifactFileOperation.js";
import {
  ccobFixture,
  cubinFixture,
  cudaFixture,
} from "../../tests/fixtures/gpu/codeObjects.js";

it.each(["cuda", "ccob", "ccob-v1"] as const)(
  "refuses oversized %s output before reading compressed input",
  async (kind) => {
    const bytes =
      kind === "cuda"
        ? cudaFixture("zstd", [{ kind: 2, target: 80, bytes: cubinFixture() }])
        : kind === "ccob"
          ? ccobFixture(3)
          : Buffer.concat([ccobFixture(1), ccobFixture(2)]);
    const payloadOffset = kind === "cuda" ? 80 : kind === "ccob" ? 32 : 20;
    if (kind === "ccob-v1") bytes.writeUInt32LE(128 * 1024 * 1024 + 1, 8);
    else
      bytes.writeBigUInt64LE(
        BigInt(128 * 1024 * 1024 + 1),
        kind === "cuda" ? 72 : 16,
      );
    const source = new GpuBufferSource(bytes, "fixture"),
      reads: number[] = [],
      inventory = new GpuInventory({ path: "/fixture", analysis: "kernels" });
    await inventory.inspect({
      size: source.size,
      containerId: source.containerId,
      read: async (offset, size) => {
        reads.push(offset);
        return source.read(offset, size);
      },
    });
    expect(reads).not.toContain(payloadOffset);
    expect(inventory.objects[0]).toMatchObject({
      inspection: "capacity",
      sha256: null,
    });
    expect(inventory.kernels).toEqual([]);
    if (kind === "ccob-v1") {
      expect(inventory.objects).toHaveLength(1);
      expect(inventory.objects[0]!.location.size).toBe(bytes.length - 20);
      expect(inventory.objects[0]!.limitations.join(" ")).toContain(
        "only the containing tail",
      );
      expect(inventory.objects[0]!.limitations.join(" ")).toContain(
        "Later siblings were not inferred",
      );
    }
  },
);
it.each(["zlib", "zstd"] as const)(
  "omits an unfinished v1 %s extent when cancellation interrupts its source read",
  async (codec) => {
    const first = ccobFixture(2, codec),
      second = ccobFixture(1, codec),
      source = new GpuBufferSource(Buffer.concat([first, second]), "fixture"),
      controller = new AbortController(),
      reason = { selected: "cancel-v1-payload-read" },
      inventory = new GpuInventory(
        { path: "/fixture", analysis: "inventory" },
        controller.signal,
      );
    let interrupted = false;
    const result = inventory.inspect({
      size: source.size,
      containerId: source.containerId,
      read: async (offset, size) => {
        if (offset === first.length + 20) {
          interrupted = true;
          controller.abort(reason);
          assertArtifactReadActive(controller.signal);
        }
        return source.read(offset, size);
      },
    });
    await expect(result).rejects.toMatchObject({
      reason: "cancelled",
      cause: reason,
    });
    expect(interrupted).toBe(true);
    const wrappers = inventory.objects.filter(
      ({ kind }) => kind === "hip-bundle",
    );
    expect(wrappers).toHaveLength(1);
    expect(wrappers[0]).toMatchObject({
      id: "fixture@0",
      inspection: "complete",
      encoded_size: first.length - 24,
      location: { offset: 24, size: first.length - 24 },
    });
    expect(
      inventory.objects.every(
        ({ id, parent_id }) =>
          id !== `fixture@${first.length.toString(16)}` &&
          parent_id !== `fixture@${first.length.toString(16)}`,
      ),
    ).toBe(true);
  },
);
it("observes cancellation while walking flat empty bundles in a decoded buffer", async () => {
  const empty = Buffer.alloc(32);
  empty.write("__CLANG_OFFLOAD_BUNDLE__");
  const bytes = Buffer.concat(Array.from({ length: 4096 }, () => empty));
  const controller = new AbortController(),
    reason = { selected: "cancel-buffer-walk" };
  const inventory = new GpuInventory(
    { path: "/fixture", analysis: "inventory" },
    controller.signal,
  );
  const result = inventory.inspect(new GpuBufferSource(bytes, "fixture"));
  setImmediate(() => controller.abort(reason));
  await expect(result).rejects.toMatchObject({
    reason: "cancelled",
    cause: reason,
  });
});
it.each(["zlib", "zstd"] as const)(
  "reuses observed %s input across multiple valid legacy CCOB siblings",
  async (codec) => {
    const count = 16,
      bytes = Buffer.concat(
        Array.from({ length: count }, () => ccobFixture(1, codec)),
      ),
      source = new GpuBufferSource(bytes, "fixture"),
      inventory = new GpuInventory({ path: "/fixture", analysis: "inventory" });
    let observedReadBytes = 0;
    await inventory.inspect({
      size: source.size,
      containerId: source.containerId,
      read: async (offset, size) => {
        observedReadBytes += size;
        return source.read(offset, size);
      },
    });
    const bundles = inventory.objects.filter(
      ({ kind }) => kind === "hip-bundle",
    );
    expect(bundles).toHaveLength(count);
    expect(bundles.every(({ inspection }) => inspection === "complete")).toBe(
      true,
    );
    expect(inventory.discovery).toBe("complete");
    // Includes prefix/alignment reads. Re-reading every suffix grows with the
    // square of the sibling count and exceeds this physical-input allowance.
    expect(observedReadBytes).toBeLessThan(2 * bytes.length);
  },
);
