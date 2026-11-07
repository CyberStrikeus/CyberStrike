import { mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { ModelArtifactProvider } from "../../../src/model/ModelArtifactProvider.js";
import { parseEvidence } from "../../../src/domain/evidence.js";
import { projectAnalysisError } from "../../../src/domain/analysisErrorProjection.js";
import { ggufFixture, safetensorsFixture } from "../../fixtures/model/model.js";

const cancelledArrayFixture = (alignment?: number) => {
  const seed = ggufFixture();
  const count = 200_000;
  const fixture = ggufFixture({
    tensors: [],
    metadata: [
      ...(alignment === undefined
        ? []
        : [{ key: "general.alignment", type: 4, value: seed.u32(alignment) }]),
      { key: "general.name", type: 8, value: seed.text("First row") },
      {
        key: "custom.bools",
        type: 9,
        value: Buffer.concat([
          seed.u32(7),
          seed.u64(BigInt(count)),
          Buffer.alloc(count),
        ]),
      },
    ],
  });
  return {
    fixture,
    count,
    arrayStart: fixture.header.length - count,
  };
};

it.each([undefined, 64])(
  "retains completed GGUF facts when cancellation interrupts a later value (alignment=%s)",
  async (alignment) => {
    const root = await mkdtemp(join(tmpdir(), "rea-model-partial-cancel-"));
    const path = join(root, "model.gguf");
    const { fixture, count, arrayStart } = cancelledArrayFixture(alignment);
    await writeFile(path, fixture.bytes);
    const sample = await open(path, "r");
    const handlePrototype = Object.getPrototypeOf(sample) as {
      read: (
        buffer: Buffer,
        offset: number,
        length: number,
        position: number,
      ) => Promise<{ bytesRead: number }>;
    };
    await sample.close();
    const originalRead = handlePrototype.read;
    const controller = new AbortController();
    const reason = { marker: "caller-selected-parser-cancel" };
    let arrayBytesObserved = 0;
    const readSpy = vi
      .spyOn(handlePrototype, "read")
      .mockImplementation(async function (
        this: unknown,
        buffer: Buffer,
        offset: number,
        length: number,
        position: number,
      ) {
        const result = await originalRead.call(
          this,
          buffer,
          offset,
          length,
          position,
        );
        if (position === arrayStart && result.bytesRead > 0) {
          arrayBytesObserved = result.bytesRead;
          controller.abort(reason);
        }
        return result;
      });
    const provider = new ModelArtifactProvider();
    try {
      const result = await provider.inspect(
        { path, hash: "header" },
        { signal: controller.signal },
      );
      if (result.ok) throw new Error("Expected parser cancellation");
      expect(arrayBytesObserved).toBeGreaterThan(0);
      expect(arrayBytesObserved).toBeLessThan(count);
      expect(result.error.cause).toBe(reason);
      const evidence = parseEvidence(result.error.partialObservation);
      expect(evidence.subject).toBeNull();
      expect(evidence.operation).toBe("inspect_model_artifact");
      expect(evidence.normalized_result).toMatchObject({
        kind: "model-artifact-partial",
        alignment: alignment ?? null,
        artifact: {
          path,
          header_sha256: null,
          sha256: null,
          file_identity: "unverified",
        },
        coverage: {
          header: "partial",
          metadata: "partial",
          tensors: "not-started",
        },
        metadata: [
          ...(alignment === undefined
            ? []
            : [{ index: 0, key: "general.alignment", value: alignment }]),
          {
            index: alignment === undefined ? 0 : 1,
            key: "general.name",
            value: "First row",
          },
        ],
        tensors: [],
      });
      const projected = projectAnalysisError(result.error);
      if (projected.details === undefined)
        throw new Error("Projected error omitted its partial observation");
      expect(parseEvidence(projected.details.partial_observation)).toEqual(
        evidence,
      );
    } finally {
      readSpy.mockRestore();
      await provider.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);

it("retains GGUF tensor declarations and layout limitations before later tensor bytes cancel", async () => {
  const root = await mkdtemp(join(tmpdir(), "rea-model-tensor-partial-"));
  const path = join(root, "model.gguf");
  const tensorCount = 4000;
  const fixture = ggufFixture({
    metadata: [],
    tensors: Array.from({ length: tensorCount }, (_, index) => ({
      name: `tensor-${String(index).padStart(4, "0")}`,
      type: index === 0 ? 9 : 0,
      shape: index === 0 ? [320n] : [1n],
      offset: 0n,
      bytes: index === 0 ? 400 : 4,
    })),
  });
  await writeFile(path, fixture.bytes);
  const sample = await open(path, "r");
  const handlePrototype = Object.getPrototypeOf(sample) as {
    read: (
      buffer: Buffer,
      offset: number,
      length: number,
      position: number,
    ) => Promise<{ bytesRead: number }>;
  };
  await sample.close();
  const originalRead = handlePrototype.read;
  const controller = new AbortController();
  const reason = { marker: "cancel-after-completed-tensor-declarations" };
  let laterHeaderChunkSeen = false;
  const readSpy = vi
    .spyOn(handlePrototype, "read")
    .mockImplementation(async function (
      this: unknown,
      buffer: Buffer,
      offset: number,
      length: number,
      position: number,
    ) {
      const result = await originalRead.call(
        this,
        buffer,
        offset,
        length,
        position,
      );
      if (position >= 24 + 65536 && result.bytesRead > 0) {
        laterHeaderChunkSeen = true;
        controller.abort(reason);
      }
      return result;
    });
  const provider = new ModelArtifactProvider();
  try {
    const result = await provider.inspect(
      { path, hash: "header" },
      { signal: controller.signal },
    );
    if (result.ok) throw new Error("Expected parser cancellation");
    expect(laterHeaderChunkSeen).toBe(true);
    expect(result.error.cause).toBe(reason);
    const evidence = parseEvidence(result.error.partialObservation);
    const partial = evidence.normalized_result as {
      tensor_declarations: Array<{
        index: number;
        file_offset: number | null;
        storage_validation: string;
      }>;
      tensors: unknown[];
      coverage: { tensors: string };
      artifact: {
        path: string;
        header_sha256: null;
        sha256: null;
        file_identity: string;
      };
    };
    expect(partial.tensor_declarations.length).toBeGreaterThan(0);
    expect(partial.tensor_declarations[0]).toMatchObject({
      index: 0,
      type: "Q8_1",
      byte_length: null,
      byte_length_state: "unknown",
      file_offset: null,
      storage_validation: "not-established",
    });
    expect(partial.tensors).toEqual([]);
    expect(partial.coverage.tensors).toBe("partial");
    expect(evidence.normalized_result).toMatchObject({ alignment: 32 });
    expect(evidence.limitations).toContainEqual(
      expect.stringContaining("Q8_1 has released 40-byte and 36-byte layouts"),
    );
    expect(partial.artifact).toMatchObject({
      path,
      header_sha256: null,
      sha256: null,
      file_identity: "unverified",
    });
  } finally {
    readSpy.mockRestore();
    await provider.close();
    await rm(root, { recursive: true, force: true });
  }
});

it.each([
  { format: "gguf", alignment: 32 },
  { format: "gguf", alignment: 64 },
  { format: "safetensors", alignment: null },
])(
  "retains parsed $format facts with alignment $alignment when full hashing is cancelled",
  async ({ format, alignment }) => {
    const root = await mkdtemp(join(tmpdir(), "rea-model-hash-cancel-"));
    const path = join(root, `model.${format}`);
    const fixture =
      format === "safetensors"
        ? safetensorsFixture(
            JSON.stringify({
              __metadata__: { author: "test" },
              weight: {
                dtype: "FUTURE_F32",
                shape: [524288],
                data_offsets: [0, 2 * 1024 * 1024],
              },
            }),
            Buffer.alloc(2 * 1024 * 1024),
          )
        : ggufFixture({
            ...(alignment === 64 ? { alignment } : {}),
            tensors: [
              {
                name: "weight",
                type: 0,
                shape: [524288n],
                offset: 0n,
                bytes: 2 * 1024 * 1024,
              },
            ],
          });
    await writeFile(path, fixture.bytes);
    const sample = await open(path, "r");
    const prototype = Object.getPrototypeOf(sample) as {
      read: (
        buffer: Buffer,
        offset: number,
        length: number,
        position: number,
      ) => Promise<{ bytesRead: number }>;
    };
    await sample.close();
    const originalRead = prototype.read;
    const controller = new AbortController();
    const reason = { marker: "cancel-during-full-model-hash" };
    let payloadRead = false;
    const readSpy = vi
      .spyOn(prototype, "read")
      .mockImplementation(async function (
        this: unknown,
        buffer: Buffer,
        offset: number,
        length: number,
        position: number,
      ) {
        const result = await originalRead.call(
          this,
          buffer,
          offset,
          length,
          position,
        );
        if (position >= fixture.header.length && result.bytesRead > 0) {
          payloadRead = true;
          controller.abort(reason);
        }
        return result;
      });
    const provider = new ModelArtifactProvider();
    try {
      const result = await provider.inspect(
        { path, hash: "full" },
        { signal: controller.signal },
      );
      if (result.ok) throw new Error("Expected full-hash cancellation");
      expect(payloadRead).toBe(true);
      expect(result.error.cause).toBe(reason);
      expect(
        parseEvidence(result.error.partialObservation).normalized_result,
      ).toMatchObject({
        kind: "model-artifact-partial",
        format,
        alignment,
        declared_tensor_count: 1,
        tensors: [
          expect.objectContaining({ name: "weight", shape: ["524288"] }),
        ],
        coverage: {
          header: "complete",
          metadata: "complete",
          tensors: "complete",
        },
        artifact: {
          sha256: null,
          header_sha256: null,
          file_identity: "unverified",
        },
      });
      if (format === "safetensors")
        expect(
          parseEvidence(result.error.partialObservation).limitations,
        ).toContainEqual(
          expect.stringContaining(
            "Unknown tensor types prevent storage-size validation: FUTURE_F32",
          ),
        );
    } finally {
      readSpy.mockRestore();
      await provider.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);
