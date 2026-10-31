import { createHash } from "node:crypto";
import { open, writeFile, symlink, truncate } from "node:fs/promises";
import { join } from "node:path";
import { expect, it, onTestFinished } from "vitest";
import { ModelArtifactProvider } from "../../../src/model/ModelArtifactProvider.js";
import { ModelHeaderReader } from "../../../src/model/ModelHeaderReader.js";
import {
  MODEL_JSON_NESTING,
  MODEL_METADATA_NESTING,
  MODEL_REPORT_BYTES,
  ModelFormatFailure,
  modelCapacityRemediation,
  modelCapacityReportedLimits,
} from "../../../src/model/ModelFormat.js";
import { readSafetensorsHeader } from "../../../src/model/SafetensorsHeader.js";
import { GgufHeader } from "../../../src/model/GgufHeader.js";
import { createModelArtifactService } from "../../../src/composition/model.js";
import { parseEvidence } from "../../../src/domain/evidence.js";
import { modelArtifactSchema } from "../../../src/domain/model/modelArtifact.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import {
  ggufFixture,
  ggufKLayouts,
  ggufShiftedTypeLayouts,
  safetensorsFixture,
} from "../../fixtures/model/model.js";

const hash = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
const providerAt = async (bytes: Buffer) => {
  const root = await createTestTempDirectory("rea-model-reader-");
  const path = join(root, "content.without-format-extension");
  await writeFile(path, bytes);
  const provider = new ModelArtifactProvider();
  onTestFinished(() => provider.close());
  return { provider, path, root };
};

it.each([
  ["01000000", 1, 16_777_216],
  ["00000001", 16_777_216, 1],
  ["04000000", 4, 67_108_864],
  ["00000004", 67_108_864, 4],
  ["e7030000", 999, 3_875_733_504],
  ["000003e7", 3_875_733_504, 999],
  ["00000000", 0, 0],
  ["ffffffff", 4_294_967_295, 4_294_967_295],
] as const)(
  "preserves unsupported GGUF version bytes %s without assuming byte order",
  async (versionBytes, little, big) => {
    // No counts are needed to explain a version refusal. Do not reinterpret
    // an unknown version's subsequent layout or publish a header observation.
    const { provider, path } = await providerAt(
      Buffer.from(`47475546${versionBytes}`, "hex"),
    );
    const result = await provider.inspect({ path, hash: "header" });
    if (result.ok) throw new Error("Unknown version admitted");
    expect(result.error).toMatchObject({
      _tag: "AnalysisUnsupportedTargetError",
      reason: `GGUF version bytes ${versionBytes} are unsupported (little-endian ${String(little)}, big-endian ${String(big)}; byte order unknown); supported versions are 2 and 3`,
    });
  },
);

it("continues reading little-endian GGUF v2 declarations", async () => {
  const { provider, path } = await providerAt(
    ggufFixture({ version: 2 }).bytes,
  );
  const result = await provider.inspect({ path, hash: "header" });
  if (!result.ok) throw result.error;
  expect(result.value).toMatchObject({ version: 2, byte_order: "little" });
  expect(result.value.tensors.map(({ name }) => name)).toEqual([
    "weight",
    "quant",
  ]);
});

it("continues refusing the unsupported big-endian GGUF v2 layout", async () => {
  const { provider, path } = await providerAt(
    ggufFixture({ version: 2, bigEndian: true }).bytes,
  );
  const result = await provider.inspect({ path, hash: "header" });
  if (result.ok) throw new Error("Big-endian GGUF v2 admitted");
  expect(result.error).toMatchObject({
    _tag: "BinaryTargetError",
    constraint: "file_format_rejected",
  });
});

it.each([false, true])(
  "reads exact GGUF declarations, endian=%s, without hashing tensor payload",
  async (bigEndian) => {
    const fixture = ggufFixture({ bigEndian });
    const { provider, path } = await providerAt(fixture.bytes);
    const result = await provider.inspect({ path, hash: "header" });
    if (!result.ok) throw result.error;
    expect(result.value.artifact).toEqual({
      path,
      file_size: fixture.bytes.length,
      header_sha256: hash(fixture.header),
      header_length: fixture.header.length,
      sha256: null,
      bytes_read: fixture.header.length,
      read_scope: "header",
    });
    expect(result.value.byte_order).toBe(bigEndian ? "big" : "little");
    expect(
      result.value.metadata.find((row) => row.key === "custom.exact")?.value,
    ).toBe("18446744073709551615");
    expect(
      result.value.metadata.find((row) => row.key === "tokenizer.ggml.tokens"),
    ).toMatchObject({
      element_type: "STRING",
      element_count: 10,
      preview_complete: false,
      value: Array.from({ length: 8 }, (_, n) => `token-${String(n)}`),
    });
    expect(
      result.value.tensors.map(({ name, shape, byte_length, file_offset }) => ({
        name,
        shape,
        byte_length,
        file_offset,
      })),
    ).toEqual([
      {
        name: "weight",
        shape: ["2", "2"],
        byte_length: 16,
        file_offset: fixture.dataOffset,
      },
      {
        name: "quant",
        shape: ["32"],
        byte_length: 18,
        file_offset: fixture.dataOffset + 32,
      },
    ]);
    expect(result.value.totals).toMatchObject({
      parameter_count: "36",
      tensor_bytes: 34,
    });
    const full = await provider.inspect({ path, hash: "full" });
    if (!full.ok) throw full.error;
    expect(full.value.artifact.sha256).toBe(hash(fixture.bytes));
    expect(full.value.artifact.header_sha256).toBe(
      result.value.artifact.header_sha256,
    );
  },
);

it.each([false, true])(
  "preserves GGUF empty extents, quantized empty rows and scalars, endian=%s",
  async (bigEndian) => {
    const declarations = [
      { name: "empty_first", type: 0, shape: [0n, 7n], offset: 0n, bytes: 0 },
      { name: "empty_later", type: 0, shape: [3n, 0n], offset: 0n, bytes: 0 },
      {
        name: "empty_quant_first",
        type: 2,
        shape: [0n, 32n],
        offset: 0n,
        bytes: 0,
      },
      {
        name: "empty_quant_later",
        type: 2,
        shape: [32n, 0n],
        offset: 0n,
        bytes: 0,
      },
      { name: "scalar", type: 0, shape: [], offset: 0n, bytes: 4 },
    ];
    const fixture = ggufFixture({ bigEndian, tensors: declarations });
    const { provider, path } = await providerAt(fixture.bytes);
    const result = await provider.inspect({ path, hash: "header" });
    if (!result.ok) throw result.error;
    expect(
      result.value.tensors.map(
        ({ name, shape, byte_length, parameter_count }) => ({
          name,
          shape,
          byte_length,
          parameter_count,
        }),
      ),
    ).toEqual(
      declarations.map(({ name, shape, bytes }) => ({
        name,
        shape: shape.map(String),
        byte_length: bytes,
        parameter_count: name === "scalar" ? "1" : "0",
      })),
    );
    expect(result.value.totals).toMatchObject({
      parameter_count: "1",
      tensor_bytes: 4,
    });
    expect(result.value.artifact.bytes_read).toBe(fixture.header.length);
  },
);

it.each([
  { name: "excess rank", type: 0, shape: [1n, 1n, 1n, 1n, 1n], bytes: 4 },
  { name: "quantized scalar", type: 2, shape: [], bytes: 0 },
  { name: "Q8_1 incomplete block", type: 9, shape: [31n], bytes: 40 },
])(
  "rejects GGUF $name without relaxing representation constraints",
  async (tensor) => {
    const fixture = ggufFixture({ tensors: [{ ...tensor, offset: 0n }] });
    const { provider, path } = await providerAt(fixture.bytes);
    const result = await provider.inspect({ path, hash: "header" });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected format refusal");
    expect(result.error).toMatchObject({
      constraint: "file_format_rejected",
    });
  },
);

it.each([8, 24, 40])(
  "accepts format-valid GGUF alignment %s and preserves exact offsets",
  async (alignment) => {
    const fixture = ggufFixture({ alignment });
    const { path, provider } = await providerAt(fixture.bytes);
    const result = await provider.inspect({ path, hash: "header" });
    if (!result.ok) throw result.error;
    expect(result.value.alignment).toBe(alignment);
    expect(result.value.tensor_data_offset).toBe(fixture.dataOffset);
    expect(
      result.value.tensors.every((row) => row.file_offset % alignment === 0),
    ).toBe(true);
    expect(result.value.tensors[1]?.file_offset).toBe(
      fixture.dataOffset + Math.ceil(16 / alignment) * alignment,
    );
  },
);

it("aligns the GGUF data section after an empty tensor directory", async () => {
  const base = ggufFixture({ tensors: [], metadata: [] });
  const dataOffset = Math.ceil(base.header.length / 32) * 32;
  const bytes = Buffer.concat([
    base.header,
    Buffer.alloc(dataOffset - base.header.length),
  ]);
  const { path, provider } = await providerAt(bytes);
  const result = await provider.inspect({ path, hash: "header" });
  if (!result.ok) throw result.error;
  expect(result.value.tensors).toEqual([]);
  expect(result.value.tensor_data_offset).toBe(dataOffset);
  expect(result.value.artifact.header_length).toBe(base.header.length);
});

it.each([0, 1, 2, 4, 12])(
  "rejects GGUF alignment %s outside positive multiples of eight",
  async (alignment) => {
    const base = ggufFixture();
    const fixture = ggufFixture({
      metadata: [
        { key: "general.alignment", type: 4, value: base.u32(alignment) },
      ],
    });
    const { path, provider } = await providerAt(fixture.bytes);
    const result = await provider.inspect({ path, hash: "header" });
    if (result.ok) throw new Error("Invalid alignment accepted");
    expect(result.error).toMatchObject({
      _tag: "BinaryTargetError",
      constraint: "file_format_rejected",
    });
  },
);

it.each([
  "General.name",
  "general.naïve",
  "general..name",
  "general/name",
  "general.-name",
  "general.name-",
  "general.double--name",
  "general.name_",
  "general.__name",
])(
  "rejects invalid GGUF metadata key %s before publishing facts",
  async (key) => {
    const fixture = ggufFixture({
      metadata: [{ key, type: 7, value: Buffer.from([1]) }],
    });
    const { path, provider } = await providerAt(fixture.bytes);
    const result = await provider.inspect({ path, hash: "header" });
    if (result.ok) throw new Error("Invalid metadata key accepted");
    expect(result.error).toMatchObject({
      _tag: "BinaryTargetError",
      constraint: "file_format_rejected",
    });
  },
);

it("accepts standardized GGUF metadata keys containing numeric hierarchy components", async () => {
  const base = ggufFixture();
  const fixture = ggufFixture({
    metadata: [
      { key: "general.base_model.0.name", type: 8, value: base.text("parent") },
    ],
  });
  const { path, provider } = await providerAt(fixture.bytes);
  const result = await provider.inspect({ path, hash: "header" });
  if (!result.ok) throw result.error;
  expect(result.value.metadata[0]).toMatchObject({
    key: "general.base_model.0.name",
    value: "parent",
  });
});

it.each([67_324_752, 67_324_760, 99_999_993, 100_000_000])(
  "admits safetensors declared header length %s before its independent representation limit",
  async (length) => {
    const bytes = Buffer.alloc(9);
    bytes.writeBigUInt64LE(BigInt(length));
    bytes[8] = 0x7b;
    const { path, provider } = await providerAt(bytes);
    const file = await open(path, "r+");
    try {
      await file.truncate(8 + length);
    } finally {
      await file.close();
    }
    const result = await provider.inspect({ path, hash: "header" });
    if (result.ok) throw new Error("Representation limit was bypassed");
    expect(result.error).toMatchObject({
      _tag: "AnalysisResourceConstraintError",
      reason: expect.stringContaining("32 MiB"),
    });
  },
);

it("retains the absolute header budget for GGUF without allocating that extent", async () => {
  const { path } = await providerAt(Buffer.alloc(0));
  const file = await open(path, "r+");
  onTestFinished(() => file.close());
  await file.truncate(100_000_009);
  const reader = new ModelHeaderReader(file, 100_000_009);
  expect(() => reader.guarantee(100_000_000)).not.toThrow();
  expect(() => reader.guarantee(100_000_001)).toThrow(ModelFormatFailure);
  try {
    reader.guarantee(100_000_001);
  } catch (cause) {
    expect(cause).toBeInstanceOf(ModelFormatFailure);
    if (!(cause instanceof ModelFormatFailure))
      throw new Error("Expected a model header capacity failure");
    expect(cause.limit).toBe("header-bytes");
    expect(cause.message).toContain("100,000,000 bytes");
    expect(cause.message).not.toContain("Safetensors");
  }
});

it("names exact offset and nesting limits instead of the retained report allowance", async () => {
  const base = ggufFixture({ tensors: [] });
  const oversized = ggufFixture({
    metadata: [
      {
        key: "custom.length",
        type: 8,
        value: base.u64(BigInt(Number.MAX_SAFE_INTEGER) + 1n),
      },
    ],
    tensors: [],
  });
  let nested = Buffer.from([1]);
  for (let frame = 0; frame < 33; frame += 1)
    nested = Buffer.concat([
      base.u32(frame === 0 ? 7 : 9),
      base.u64(1n),
      nested,
    ]);
  const deep = ggufFixture({
    metadata: [{ key: "custom.nested", type: 9, value: nested }],
    tensors: [],
  });
  for (const [label, bytes, allowance] of [
    ["offset", oversized.bytes, String(Number.MAX_SAFE_INTEGER)],
    ["nesting", deep.bytes, "32 array frames"],
  ] as const) {
    const { path, provider } = await providerAt(bytes);
    const result = await provider.inspect({ path, hash: "header" });
    if (result.ok) throw new Error(`${label} capacity was accepted`);
    expect(result.error).toMatchObject({
      _tag: "AnalysisResourceConstraintError",
      retryable: false,
      remediationAction: expect.stringContaining(allowance),
    });
    const remediation =
      "remediationAction" in result.error ? result.error.remediationAction : "";
    expect(remediation).not.toContain(String(MODEL_REPORT_BYTES));
    expect(remediation).not.toContain("100,000,000");
    expect(result.error).toMatchObject({
      reportedLimits: expect.not.objectContaining({
        maximum_report_bytes: MODEL_REPORT_BYTES,
      }),
    });
  }
});

it("preserves safetensors scalar, empty and packed tensor declarations and raw string metadata", async () => {
  const fixture = safetensorsFixture();
  const { provider, path } = await providerAt(fixture.bytes);
  const result = await provider.inspect({ path, hash: "header" });
  if (!result.ok) throw result.error;
  expect(result.value.artifact.header_sha256).toBe(hash(fixture.header));
  expect(
    result.value.tensors.map((row) => [row.name, row.shape, row.byte_length]),
  ).toEqual([
    ["empty", ["0", "7"], 0],
    ["weight", ["2", "2"], 16],
  ]);
  expect(result.value.metadata.map((row) => [row.key, row.value])).toEqual([
    ["format", "pt"],
    ["license", "Apache-2.0"],
  ]);
  const packed = safetensorsFixture(
    JSON.stringify({
      scalar: { dtype: "F4", shape: [2], data_offsets: [0, 1] },
      empty: { dtype: "F32", shape: [0], data_offsets: [0, 0] },
    }),
    Buffer.alloc(1),
  );
  await writeFile(path, packed.bytes);
  const checked = await provider.inspect({ path, hash: "full" });
  if (!checked.ok) throw checked.error;
  expect(checked.value.totals).toMatchObject({
    parameter_count: "2",
    tensor_bytes: 1,
  });
});

it("returns unknown lengths for unknown GGUF types without inventing storage size", async () => {
  const fixture = ggufFixture({
    tensors: [{ name: "future", type: 999, shape: [1n], offset: 0n, bytes: 1 }],
  });
  const { provider, path } = await providerAt(fixture.bytes);
  const result = await provider.inspect({ path, hash: "header" });
  if (!result.ok) throw result.error;
  expect(result.value.tensors[0]).toMatchObject({
    type_id: 999,
    type: "UNKNOWN_999",
    byte_length: null,
    byte_length_state: "unknown",
  });
  expect(result.value.coverage.tensor_ranges).toBe("partial");
  expect(result.value.totals.tensor_bytes).toBeNull();
});

it.each([
  { version: 2, bigEndian: false, blockBytes: 36 },
  { version: 2, bigEndian: false, blockBytes: 40 },
  { version: 3, bigEndian: false, blockBytes: 36 },
  { version: 3, bigEndian: false, blockBytes: 40 },
  { version: 3, bigEndian: true, blockBytes: 36 },
  { version: 3, bigEndian: true, blockBytes: 40 },
])(
  "preserves unresolved Q8_1 storage for GGUF v$version, endian=$bigEndian, block bytes=$blockBytes",
  async ({ version, bigEndian, blockBytes }) => {
    const base = ggufFixture({ bigEndian });
    const fixture = ggufFixture({
      version,
      bigEndian,
      metadata: [
        { key: "general.quantization_version", type: 4, value: base.u32(2) },
      ],
      tensors: [
        { name: "control", type: 0, shape: [4n], offset: 0n, bytes: 16 },
        {
          name: "weight",
          type: 9,
          shape: [320n],
          offset: 32n,
          bytes: 10 * blockBytes,
        },
      ],
    });
    const { provider, path } = await providerAt(
      Buffer.concat([fixture.bytes, Buffer.alloc(16)]),
    );
    const result = await provider.inspect({ path, hash: "header" });
    if (!result.ok) throw result.error;
    expect(result.value.tensors).toMatchObject([
      { name: "control", byte_length: 16, storage_validation: "consistent" },
      {
        name: "weight",
        type: "Q8_1",
        type_id: 9,
        shape: ["320"],
        data_offset: 32,
        file_offset: fixture.dataOffset + 32,
        parameter_count: "320",
        byte_length: null,
        byte_length_state: "unknown",
        storage_validation: "unknown",
      },
    ]);
    expect(result.value.totals).toMatchObject({
      parameter_count: "324",
      tensor_bytes: null,
      by_type: [
        { type: "F32", bytes: 16, parameter_count: "4" },
        { type: "Q8_1", bytes: null, parameter_count: "320" },
      ],
    });
    expect(result.value.coverage).toMatchObject({
      header: "complete",
      tensor_ranges: "partial",
      storage_sizes: "partial",
    });
    expect(result.value.limitations).toContainEqual(
      expect.stringContaining("Q8_1 has released 40-byte and 36-byte layouts"),
    );
    expect(result.value.limitations.join(" ")).not.toContain(
      "Unknown tensor type Q8_1",
    );
    expect(result.value.artifact.bytes_read).toBe(fixture.header.length);
  },
);

it("derives empty Q8_1 storage without choosing a historical block layout", async () => {
  const fixture = ggufFixture({
    metadata: [],
    tensors: [
      { name: "empty", type: 9, shape: [32n, 0n], offset: 0n, bytes: 0 },
    ],
  });
  const { provider, path } = await providerAt(fixture.bytes);
  const result = await provider.inspect({ path, hash: "header" });
  if (!result.ok) throw result.error;
  expect(result.value.tensors[0]).toMatchObject({
    type: "Q8_1",
    parameter_count: "0",
    byte_length: 0,
    byte_length_state: "derived",
    storage_validation: "consistent",
  });
  expect(result.value.totals.tensor_bytes).toBe(0);
  expect(result.value.coverage).toMatchObject({
    tensor_ranges: "complete",
    storage_sizes: "complete",
  });
});

it.each(ggufKLayouts)(
  "preserves $name identity while leaving released K64/K256 storage unresolved",
  async ({ id, name, bytes64, bytes256 }) => {
    // The released GGUF writer pads each tensor to 32 bytes. For 256 elements,
    // both layouts have the same padded extent, despite different byte lengths.
    expect(Math.ceil((4 * bytes64) / 32)).toBe(Math.ceil(bytes256 / 32));
    for (const [elements, bytes] of [
      [64, bytes64],
      [256, 4 * bytes64],
      [256, bytes256],
    ] as const) {
      const base = ggufFixture();
      const fixture = ggufFixture({
        metadata: [
          { key: "general.quantization_version", type: 4, value: base.u32(2) },
          { key: "general.file_type", type: 4, value: base.u32(15) },
        ],
        tensors: [
          {
            name: "weight",
            type: id,
            shape: [BigInt(elements)],
            offset: 0n,
            bytes,
          },
        ],
      });
      const { provider, path } = await providerAt(
        Buffer.concat([
          fixture.bytes,
          Buffer.alloc(Math.ceil(bytes / 32) * 32 - bytes),
        ]),
      );
      const result = await provider.inspect({ path, hash: "header" });
      if (!result.ok) throw result.error;
      expect(result.value.tensors[0]).toMatchObject({
        type: name,
        type_id: id,
        shape: [String(elements)],
        parameter_count: String(elements),
        byte_length: null,
        storage_validation: "unknown",
      });
      expect(result.value.coverage).toMatchObject({
        tensor_ranges: "partial",
        storage_sizes: "partial",
      });
      expect(result.value.totals.tensor_bytes).toBeNull();
      expect(result.value.limitations).toContainEqual(
        expect.stringContaining("common 64-element row constraint"),
      );
    }
    const { provider, path } = await providerAt(
      ggufFixture({
        tensors: [
          {
            name: "invalid",
            type: id,
            shape: [32n],
            offset: 0n,
            bytes: bytes64,
          },
        ],
      }).bytes,
    );
    const rejected = await provider.inspect({ path, hash: "header" });
    expect(rejected.ok).toBe(false);
    if (rejected.ok) throw new Error("Incomplete common K row admitted");
    expect(rejected.error).toMatchObject({
      constraint: "file_format_rejected",
      reason: expect.stringContaining("multiple of 64 elements"),
    });
  },
);

it.each(ggufShiftedTypeLayouts)(
  "retains ambiguous numeric type $id for released integer and $modernName bodies",
  async ({ id, integerBytes, modernName, modernBytes256 }) => {
    for (const [elements, bytes] of [
      [3, 3 * integerBytes],
      [256, 256 * integerBytes],
      [256, modernBytes256],
      [0, 0],
    ] as const) {
      const fixture = ggufFixture({
        tensors: [
          {
            name: "weight",
            type: id,
            shape: [BigInt(elements)],
            offset: 0n,
            bytes,
          },
        ],
      });
      const { provider, path } = await providerAt(fixture.bytes);
      const result = await provider.inspect({ path, hash: "header" });
      if (!result.ok) throw result.error;
      expect(result.value.tensors[0]).toMatchObject({
        type: `AMBIGUOUS_${String(id)}`,
        type_id: id,
        shape: [String(elements)],
        parameter_count: String(elements),
        byte_length: elements === 0 ? 0 : null,
        storage_validation: elements === 0 ? "consistent" : "unknown",
      });
      expect(result.value.limitations).toContainEqual(
        expect.stringContaining(`type ID ${String(id)} has released`),
      );
      expect(result.value.limitations.join(" ")).toContain(modernName);
      expect(result.value.totals.tensor_bytes).toBe(elements === 0 ? 0 : null);
    }
  },
);

it("retains established storage for stable GGUF types and zero-byte K declarations", async () => {
  const fixture = ggufFixture({
    tensors: [
      { name: "integer", type: 26, shape: [3n], offset: 0n, bytes: 12 },
      { name: "empty-k", type: 10, shape: [64n, 0n], offset: 32n, bytes: 0 },
      { name: "quant", type: 2, shape: [32n], offset: 32n, bytes: 18 },
    ],
  });
  const { provider, path } = await providerAt(fixture.bytes);
  const result = await provider.inspect({ path, hash: "header" });
  if (!result.ok) throw result.error;
  expect(result.value.tensors).toMatchObject([
    { type: "I32", byte_length: 12, storage_validation: "consistent" },
    { type: "Q2_K", byte_length: 0, storage_validation: "consistent" },
    { type: "Q4_0", byte_length: 18, storage_validation: "consistent" },
  ]);
  expect(result.value.totals.tensor_bytes).toBe(30);
  expect(result.value.coverage).toMatchObject({
    tensor_ranges: "complete",
    storage_sizes: "complete",
  });
});

it("keeps unknown safetensors storage validation separate from observed valid byte ranges", async () => {
  const fixture = safetensorsFixture(
    '{"future":{"dtype":"FUTURE4","shape":[2],"data_offsets":[0,4]}}',
    Buffer.alloc(4),
  );
  const { path, provider } = await providerAt(fixture.bytes);
  const result = await provider.inspect({ path, hash: "header" });
  if (!result.ok) throw result.error;
  expect(result.value.tensors[0]).toMatchObject({
    byte_length: 4,
    byte_length_state: "declared",
    storage_validation: "unknown",
  });
  expect(result.value.coverage).toMatchObject({
    tensor_ranges: "complete",
    storage_sizes: "partial",
  });
});

it("preserves nonfinite floating metadata and negative zero without JSON coercion", async () => {
  const values = [NaN, Infinity, -Infinity, -0];
  const fixture = ggufFixture({
    metadata: values.map((value, index) => {
      const b = Buffer.alloc(8);
      b.writeDoubleLE(value);
      return { key: `custom.float_${String(index)}`, type: 12, value: b };
    }),
  });
  const { path, provider } = await providerAt(fixture.bytes);
  const result = await provider.inspect({ path, hash: "header" });
  if (!result.ok) throw result.error;
  expect(result.value.metadata.map((row) => [row.type, row.value])).toEqual(
    ["NaN", "+Infinity", "-Infinity", "-0"].map((value) => ["FLOAT64", value]),
  );
});

it("validates booleans beyond an array preview without allocating the full value list", async () => {
  const base = ggufFixture();
  const values = Buffer.alloc(10000);
  values[9999] = 2;
  const fixture = ggufFixture({
    metadata: [
      {
        key: "custom.flags",
        type: 9,
        value: Buffer.concat([base.u32(7), base.u64(10000n), values]),
      },
    ],
  });
  const { path, provider } = await providerAt(fixture.bytes);
  const result = await provider.inspect({ path, hash: "header" });
  if (result.ok) throw new Error("Invalid omitted boolean was accepted");
  expect(result.error).toMatchObject({
    _tag: "BinaryTargetError",
    constraint: "file_format_rejected",
  });
});

it.each([false, true])(
  "validates omitted UTF-8 strings across chunk boundaries, big endian=%s",
  async (bigEndian) => {
    const base = ggufFixture({ bigEndian });
    const preview = Array.from({ length: 8 }, (_, n) => `\uFEFFtoken-${n} 🦙`);
    const strings = [
      ...preview,
      "",
      "a".repeat(65533) + "€",
      "a".repeat(65535) + "🦙",
      "\0tail",
    ];
    const fixture = ggufFixture({
      bigEndian,
      metadata: [
        {
          key: "custom.strings",
          type: 9,
          value: Buffer.concat([
            base.u32(8),
            base.u64(BigInt(strings.length)),
            ...strings.map(base.text),
          ]),
        },
      ],
    });
    const { path, provider } = await providerAt(fixture.bytes);
    const result = await provider.inspect({ path, hash: "header" });
    if (!result.ok) throw result.error;
    expect(result.value.metadata[0]).toMatchObject({
      value: preview,
      element_count: strings.length,
      preview_complete: false,
    });
    expect(result.value.artifact).toMatchObject({
      bytes_read: fixture.header.length,
      header_sha256: createHash("sha256").update(fixture.header).digest("hex"),
    });
    expect(result.value.tensors).toHaveLength(2);
  },
);

it.each([
  ["short", Buffer.from([0xc0, 0x80])],
  [
    "chunk-sized",
    Buffer.concat([Buffer.alloc(65535, 0x61), Buffer.from([0xe2])]),
  ],
  [
    "cross-chunk",
    Buffer.concat([
      Buffer.alloc(65535, 0x61),
      Buffer.from([0xf0, 0x9f, 0x61, 0x80]),
    ]),
  ],
] as const)(
  "rejects malformed omitted %s UTF-8 strings",
  async (_, invalid) => {
    const base = ggufFixture();
    const fixture = ggufFixture({
      metadata: [
        {
          key: "custom.strings",
          type: 9,
          value: Buffer.concat([
            base.u32(8),
            base.u64(9n),
            ...Array.from({ length: 8 }, () => base.text("valid")),
            base.u64(BigInt(invalid.length)),
            invalid,
          ]),
        },
      ],
    });
    const { path, provider } = await providerAt(fixture.bytes);
    const result = await provider.inspect({ path, hash: "header" });
    if (result.ok) throw new Error("Invalid omitted UTF-8 string was accepted");
    expect(result.error).toMatchObject({
      _tag: "BinaryTargetError",
      constraint: "file_format_rejected",
      message: expect.stringContaining("GGUF string is not valid UTF-8"),
    });
  },
);

it("chooses model recovery from the producing limit", () => {
  const header = modelCapacityRemediation("header-bytes");
  expect(header).toContain("100,000,000 bytes");
  expect(header).not.toContain("Safetensors");
  expect(header).not.toContain(String(MODEL_REPORT_BYTES));
  const report = modelCapacityRemediation("report-bytes");
  expect(report).toContain(`report allowance is ${String(MODEL_REPORT_BYTES)}`);
  expect(report).not.toContain("representation");
  const representation = modelCapacityRemediation("representation-bytes");
  expect(representation).toContain("representation allowance");
  expect(representation).not.toContain("report allowance");
  const offset = modelCapacityRemediation("exact-offset");
  expect(offset).toContain(String(Number.MAX_SAFE_INTEGER));
  expect(offset).not.toContain(String(MODEL_REPORT_BYTES));
  const nesting = modelCapacityRemediation("metadata-nesting");
  expect(nesting).toContain(`${String(MODEL_METADATA_NESTING)} array frames`);
  expect(nesting).not.toContain(String(MODEL_REPORT_BYTES));
  const jsonNesting = modelCapacityRemediation("json-nesting");
  expect(jsonNesting).toContain(`${String(MODEL_JSON_NESTING)} levels`);
  expect(jsonNesting).not.toContain(String(MODEL_REPORT_BYTES));
  expect(modelCapacityReportedLimits("report-bytes")).toEqual({
    maximum_report_bytes: MODEL_REPORT_BYTES,
  });
  expect(modelCapacityReportedLimits("exact-offset")).toEqual({
    maximum_exact_offset: Number.MAX_SAFE_INTEGER,
  });
  expect(modelCapacityReportedLimits("json-nesting")).toEqual({
    maximum_json_depth: MODEL_JSON_NESTING,
  });
});

it("refuses an oversized declared header before reading or expanding it", async () => {
  const bytes = Buffer.alloc(9);
  bytes.writeBigUInt64LE(100_000_001n);
  bytes[8] = 0x7b;
  const { path, provider } = await providerAt(bytes);
  const file = await open(path, "r+");
  try {
    await file.truncate(100_000_009);
  } finally {
    await file.close();
  }
  const result = await provider.inspect({ path, hash: "header" });
  if (result.ok) throw new Error("Oversized header was accepted");
  expect(result.error).toMatchObject({
    _tag: "AnalysisResourceConstraintError",
    retryable: false,
    reportedLimits: { maximum_header_bytes: 100_000_000 },
    remediationAction: expect.stringContaining("100,000,000"),
  });
  expect(result.error.message).not.toContain("Safetensors");
  expect(
    "remediationAction" in result.error ? result.error.remediationAction : "",
  ).not.toContain("Safetensors");
  expect(
    "reportedLimits" in result.error ? result.error.reportedLimits : {},
  ).not.toHaveProperty("maximum_report_bytes");
});

const malformed = [
  ["truncated GGUF", () => ggufFixture().bytes.subarray(0, 21)],
  [
    "invalid UTF8",
    () => {
      const f = ggufFixture({
        metadata: [
          {
            key: "x",
            type: 8,
            value: Buffer.concat([
              Buffer.from([1, 0, 0, 0, 0, 0, 0, 0]),
              Buffer.from([0xff]),
            ]),
          },
        ],
      });
      return f.bytes;
    },
  ],
  [
    "duplicate GGUF metadata",
    () =>
      ggufFixture({
        metadata: [
          { key: "x", type: 7, value: Buffer.from([0]) },
          { key: "x", type: 7, value: Buffer.from([1]) },
        ],
      }).bytes,
  ],
  [
    "invalid boolean",
    () =>
      ggufFixture({
        metadata: [{ key: "x", type: 7, value: Buffer.from([2]) }],
      }).bytes,
  ],
  [
    "misaligned GGUF tensor",
    () =>
      ggufFixture({
        tensors: [{ name: "x", type: 0, shape: [1n], offset: 1n, bytes: 4 }],
      }).bytes,
  ],
  [
    "invalid quantization row",
    () =>
      ggufFixture({
        tensors: [
          { name: "x", type: 2, shape: [16n, 2n], offset: 0n, bytes: 18 },
        ],
      }).bytes,
  ],
  [
    "overlapping GGUF tensors",
    () =>
      ggufFixture({
        tensors: [
          { name: "a", type: 0, shape: [1n], offset: 0n, bytes: 4 },
          { name: "b", type: 0, shape: [1n], offset: 0n, bytes: 4 },
        ],
      }).bytes,
  ],
  [
    "duplicate JSON keys",
    () =>
      safetensorsFixture(
        '{"x":{"dtype":"F32","dtype":"F16","shape":[2],"data_offsets":[0,4]}}',
        Buffer.alloc(4),
      ).bytes,
  ],
  [
    "safetensors dimension exceeding uint64",
    () =>
      safetensorsFixture(
        '{"x":{"dtype":"F32","shape":[0,18446744073709551616],"data_offsets":[0,0]}}',
        Buffer.alloc(0),
      ).bytes,
  ],
  [
    "overlong safetensors integer",
    () =>
      safetensorsFixture(
        '{"x":{"dtype":"F32","shape":[0,100000000000000000000],"data_offsets":[0,0]}}',
        Buffer.alloc(0),
      ).bytes,
  ],
  [
    "safetensors shape product overflowing before a zero extent",
    () =>
      safetensorsFixture(
        '{"x":{"dtype":"F32","shape":[18446744073709551615,18446744073709551615,0],"data_offsets":[0,0]}}',
        Buffer.alloc(0),
      ).bytes,
  ],
  [
    "safetensors shape mismatch",
    () =>
      safetensorsFixture(
        '{"x":{"dtype":"F32","shape":[3],"data_offsets":[0,16]}}',
      ).bytes,
  ],
  [
    "safetensors gap",
    () =>
      safetensorsFixture(
        '{"x":{"dtype":"F32","shape":[3],"data_offsets":[4,16]}}',
      ).bytes,
  ],
  [
    "safetensors overlap",
    () =>
      safetensorsFixture(
        '{"a":{"dtype":"F32","shape":[4],"data_offsets":[0,16]},"b":{"dtype":"F32","shape":[1],"data_offsets":[0,4]}}',
      ).bytes,
  ],
  ["safetensors trailing data", () => safetensorsFixture("{}").bytes],
  [
    "safetensors non-string metadata",
    () => safetensorsFixture('{"__metadata__":{"x":1}}', Buffer.alloc(0)).bytes,
  ],
  [
    "safetensors decimal metadata container",
    () => safetensorsFixture('{"__metadata__":1.25}', Buffer.alloc(0)).bytes,
  ],
  [
    "safetensors negative metadata container",
    () => safetensorsFixture('{"__metadata__":-1}', Buffer.alloc(0)).bytes,
  ],
  [
    "safetensors overflowing metadata container",
    () =>
      safetensorsFixture(
        '{"__metadata__":18446744073709551616}',
        Buffer.alloc(0),
      ).bytes,
  ],
  [
    "safetensors noninteger shape sentinel",
    () =>
      safetensorsFixture(
        '{"x":{"dtype":"F32","shape":[1.25],"data_offsets":[0,0]}}',
        Buffer.alloc(0),
      ).bytes,
  ],
  [
    "safetensors negative data-offset sentinel",
    () =>
      safetensorsFixture(
        '{"x":{"dtype":"F32","shape":[1],"data_offsets":[-1,4]}}',
        Buffer.alloc(0),
      ).bytes,
  ],
  [
    "safetensors tensor missing a required declaration",
    () =>
      safetensorsFixture('{"x":{"dtype":"F32","shape":[1]}}', Buffer.alloc(0))
        .bytes,
  ],
  [
    "safetensors unpaired surrogate",
    () =>
      safetensorsFixture('{"__metadata__":{"x":"\\ud800"}}', Buffer.alloc(0))
        .bytes,
  ],
] as const;
it.each(malformed)(
  "rejects %s with typed file_format_rejected",
  async (_name, make) => {
    const { provider, path } = await providerAt(make());
    const result = await provider.inspect({ path, hash: "header" });
    if (result.ok) throw new Error("Malformed model was accepted");
    expect(result.error).toMatchObject({
      _tag: "BinaryTargetError",
      constraint: "file_format_rejected",
    });
  },
);

it("retains GGUF declarations and metadata when storage overlap is refused", async () => {
  const seed = ggufFixture();
  const fixture = ggufFixture({
    metadata: [{ key: "general.name", type: 8, value: seed.text("Overlap") }],
    tensors: [
      { name: "a", type: 0, shape: [1n], offset: 0n, bytes: 4 },
      { name: "b", type: 0, shape: [1n], offset: 0n, bytes: 4 },
    ],
  });
  const { provider, path } = await providerAt(fixture.bytes);
  const result = await provider.inspect({ path, hash: "header" });
  if (result.ok) throw new Error("Overlapping tensors admitted");
  expect(result.error).toMatchObject({
    _tag: "BinaryTargetError",
    constraint: "file_format_rejected",
  });
  const evidence = parseEvidence(result.error.partialObservation);
  expect(evidence.subject).toBeNull();
  expect(evidence.normalized_result).toMatchObject({
    artifact: {
      header_sha256: null,
      sha256: null,
      file_identity: "unverified",
    },
    coverage: { header: "partial", metadata: "complete", tensors: "partial" },
    metadata: [{ key: "general.name", value: "Overlap" }],
    tensors: [],
    tensor_declarations: [
      {
        name: "a",
        file_offset: fixture.dataOffset,
        storage_validation: "not-established",
      },
      {
        name: "b",
        file_offset: fixture.dataOffset,
        storage_validation: "not-established",
      },
    ],
  });
});

it("accepts null safetensors metadata and ignores tensor extension fields", async () => {
  const fixture = safetensorsFixture(
    '{"__metadata__":null,"weight":{"dtype":"F32","shape":[1],"data_offsets":[0,4],"note":{"source":"local","flags":[null,false,-1,1.25]}}}',
    Buffer.alloc(4),
  );
  const { provider, path } = await providerAt(fixture.bytes);
  const result = await provider.inspect({ path, hash: "header" });
  if (!result.ok) throw result.error;
  expect(result.value.metadata).toEqual([]);
  expect(
    result.value.tensors.map(({ name, type, shape }) => ({
      name,
      type,
      shape,
    })),
  ).toEqual([{ name: "weight", type: "F32", shape: ["1"] }]);
});

it("accepts nested JSON values in ignored Safetensors extension fields", async () => {
  const nested = `${"[".repeat(12)}0${"]".repeat(12)}`;
  const fixture = safetensorsFixture(
    `{"weight":{"dtype":"F32","shape":[1],"data_offsets":[0,4],"note":${nested}}}`,
    Buffer.alloc(4),
  );
  const { provider, path } = await providerAt(fixture.bytes);
  const result = await provider.inspect({ path, hash: "header" });
  expect(result.ok).toBe(true);
});

it("classifies over-depth Safetensors extension JSON as a resource limit", async () => {
  const nested = `${"[".repeat(MODEL_JSON_NESTING + 1)}0${"]".repeat(MODEL_JSON_NESTING + 1)}`;
  const fixture = safetensorsFixture(
    `{"weight":{"dtype":"F32","shape":[1],"data_offsets":[0,4],"note":${nested}}}`,
    Buffer.alloc(4),
  );
  const { provider, path } = await providerAt(fixture.bytes);
  const result = await provider.inspect({ path, hash: "header" });
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Over-depth JSON was accepted");
  expect(result.error).toMatchObject({
    _tag: "AnalysisResourceConstraintError",
    resource: "memory",
    reason: expect.stringContaining("Safetensors JSON nesting"),
    reportedLimits: { maximum_json_depth: MODEL_JSON_NESTING },
  });
});

it.each([640, 896, 1152, 1408, 66_176])(
  "admits safetensors header length %s whose prefix bytes resemble a pickle protocol marker",
  async (length) => {
    const header = JSON.stringify({
      weight: { dtype: "F32", shape: [1], data_offsets: [0, 4] },
    });
    const fixture = safetensorsFixture(
      header.padEnd(length, " "),
      Buffer.alloc(4),
    );
    const { provider, path } = await providerAt(fixture.bytes);
    const result = await provider.inspect({ path, hash: "header" });
    if (!result.ok) throw result.error;
    expect(result.value).toMatchObject({ format: "safetensors" });
    expect(result.value.tensors.map(({ name }) => name)).toEqual(["weight"]);
  },
);

it.each([
  // Protocol 2 pickle of {"a": 1}: PROTO 2, EMPTY_DICT, BINPUT 0, ...
  ["a ZIP local header", Buffer.from("504b0304140000000000", "hex")],
  ["a short ZIP signature", Buffer.from("504b0304", "hex")],
  [
    "a ZIP signature followed by a brace and an inadmissible length",
    Buffer.from("504b0304140000007b", "hex"),
  ],
  ["a real pickle", Buffer.from("80027d710058010000006171014b01732e", "hex")],
  // Protocol 2 pickle of {}: six bytes, shorter than a safetensors prefix.
  ["an empty dict", Buffer.from("80027d71002e", "hex")],
  // Protocol 4 FRAME pickle of {"a": 1}.
  [
    "a protocol 4 frame",
    Buffer.from("8004950a000000000000007d948c0161944b01732e", "hex"),
  ],
  // The magic number torch.save writes first in its legacy format.
  [
    "the legacy torch.save magic",
    Buffer.from("80028a0a6cfc9c46f9206aa850192e", "hex"),
  ],
  // Protocol 2 pickle of "x{": its brace lands at offset 8.
  [
    "a brace after an inadmissible length",
    Buffer.from("80025802000000787b71002e", "hex"),
  ],
  [
    "an in-file length without a JSON brace",
    Buffer.concat([
      Buffer.from("8002000000000000", "hex"),
      Buffer.alloc(644, 0x2e),
    ]),
  ],
] as const)(
  "refuses pickle protocol bytes followed by %s",
  async (_case, bytes) => {
    const { provider, path } = await providerAt(bytes);
    const result = await provider.inspect({ path, hash: "header" });
    if (result.ok) throw new Error("Pickle admitted");
    expect(result.error).toMatchObject({
      _tag: "AnalysisUnsupportedTargetError",
      reason: expect.stringContaining("PyTorch pickle"),
    });
  },
);

it("reports a truncated safetensors header whose length resembles a pickle marker as malformed", async () => {
  const fixture = safetensorsFixture(
    JSON.stringify({
      weight: { dtype: "F32", shape: [1], data_offsets: [0, 4] },
    }).padEnd(896, " "),
    Buffer.alloc(4),
  );
  const { provider, path } = await providerAt(fixture.bytes.subarray(0, 500));
  const result = await provider.inspect({ path, hash: "header" });
  if (result.ok) throw new Error("Truncated model was accepted");
  expect(result.error).toMatchObject({
    _tag: "BinaryTargetError",
    constraint: "file_format_rejected",
  });
});

it("bounds expansion before allocation and distinguishes unsupported pickle, version and paths", async () => {
  const fixture = ggufFixture();
  fixture.bytes.writeBigUInt64LE(0xffffffffffffffffn, 8);
  const { provider, path, root } = await providerAt(fixture.bytes);
  const huge = await provider.inspect({ path, hash: "header" });
  if (huge.ok) throw new Error("Huge count admitted");
  expect(huge.error._tag).toBe("AnalysisResourceConstraintError");
  await writeFile(path, Buffer.from([0x80, 4, 0, 0]));
  const pickle = await provider.inspect({ path, hash: "header" });
  if (pickle.ok) throw new Error("Pickle admitted");
  expect(pickle.error._tag).toBe("AnalysisUnsupportedTargetError");
  await writeFile(path, ggufFixture({ version: 999 }).bytes);
  const version = await provider.inspect({ path, hash: "header" });
  if (version.ok) throw new Error("Unknown version admitted");
  expect(version.error._tag).toBe("AnalysisUnsupportedTargetError");
  const alias = join(root, "link");
  await symlink(path, alias);
  const linked = await provider.inspect({ path: alias, hash: "header" });
  expect(linked.ok).toBe(false);
  const service = createModelArtifactService();
  onTestFinished(() => service.close());
  const invalid = await service.inspect({
    path: "relative",
    detail: "complete",
  });
  if (invalid.ok) throw new Error("Relative path admitted");
  expect(invalid.error._tag).toBe("AnalysisInputError");
});

it("reads only the exact header, even when it ends in the middle of a normal buffer", async () => {
  const fixture = safetensorsFixture();
  const { path } = await providerAt(fixture.bytes);
  const file = await open(path, "r");
  onTestFinished(() => file.close());
  const requests: [number, number][] = [];
  const read = file.read.bind(file);
  const boundary = {
    read: async (
      buffer: Buffer,
      offset: number,
      length: number,
      position: number,
    ) => {
      requests.push([position, length]);
      expect(position + length).toBeLessThanOrEqual(fixture.header.length);
      return read(buffer, offset, length, position);
    },
  } as Pick<typeof file, "read">;
  const reader = new ModelHeaderReader(
    boundary as typeof file,
    fixture.bytes.length,
  );
  await readSafetensorsHeader(reader, await reader.take(4));
  expect(await reader.finish(false)).toMatchObject({
    bytes_read: fixture.header.length,
    header_sha256: hash(fixture.header),
  });
  expect(requests.reduce((n, [, length]) => n + length, 0)).toBe(
    fixture.header.length,
  );
});

it.each(["header", "full"] as const)(
  "classifies real truncation after admission during %s reading as an identity change",
  async (mode) => {
    const fixture = ggufFixture();
    const { path } = await providerAt(fixture.bytes);
    const file = await open(path, "r");
    onTestFinished(() => file.close());
    const admitted = await file.stat();
    const reader = new ModelHeaderReader(file, admitted.size);
    if (mode === "full") await reader.take(fixture.header.length);
    await truncate(path, mode === "header" ? 0 : fixture.header.length);
    const reading = mode === "header" ? reader.take(4) : reader.finish(true);
    await expect(reading).rejects.toMatchObject({ reason: "integrity" });
  },
);

it("keeps GGUF read-ahead inside the directory and hashes precisely that prefix", async () => {
  const fixture = ggufFixture();
  const { path } = await providerAt(fixture.bytes);
  const file = await open(path, "r");
  onTestFinished(() => file.close());
  const read = file.read.bind(file);
  let bytesRead = 0;
  const boundary = {
    read: async (
      buffer: Buffer,
      offset: number,
      length: number,
      position: number,
    ) => {
      expect(position + length).toBeLessThanOrEqual(fixture.header.length);
      const result = await read(buffer, offset, length, position);
      bytesRead += result.bytesRead;
      return result;
    },
  } as Pick<typeof file, "read">;
  const reader = new ModelHeaderReader(
    boundary as typeof file,
    fixture.bytes.length,
  );
  await reader.take(4);
  await new GgufHeader(reader).read();
  await reader.finish(false);
  expect(bytesRead).toBe(fixture.header.length);
});

it("inspects a 1 GiB sparse safetensors declaration using only its small header", async () => {
  const dataBytes = 1024 ** 3;
  const fixture = safetensorsFixture(
    JSON.stringify({
      weight: { dtype: "U8", shape: [dataBytes], data_offsets: [0, dataBytes] },
    }),
    Buffer.alloc(0),
  );
  const { path, provider } = await providerAt(fixture.header);
  const file = await open(path, "r+");
  try {
    await file.truncate(fixture.header.length + dataBytes);
  } finally {
    await file.close();
  }
  const result = await provider.inspect({ path, hash: "header" });
  if (!result.ok) throw result.error;
  expect(result.value.artifact.bytes_read).toBe(fixture.header.length);
  expect(result.value.tensors[0]).toMatchObject({
    byte_length: dataBytes,
    parameter_count: String(dataBytes),
  });
});

it("supports true scalar shapes and prototype-named metadata without changing their spelling", async () => {
  const fixture = safetensorsFixture(
    '{"__metadata__":{"__proto__":"raw","constructor":"kept"},"scalar":{"dtype":"F32","shape":[],"data_offsets":[0,4]}}',
    Buffer.alloc(4),
  );
  const { path, provider } = await providerAt(fixture.bytes);
  const result = await provider.inspect({ path, hash: "header" });
  if (!result.ok) throw result.error;
  expect(result.value.tensors[0]).toMatchObject({
    shape: [],
    parameter_count: "1",
    byte_length: 4,
  });
  expect(result.value.metadata.map(({ key, value }) => [key, value])).toEqual([
    ["__proto__", "raw"],
    ["constructor", "kept"],
  ]);
});

it("yields while validating a large metadata array, preserves cancellation and releases admission", async () => {
  const f = ggufFixture();
  const count = 1_000_000;
  const fixture = ggufFixture({
    metadata: [
      {
        key: "custom.bools",
        type: 9,
        value: Buffer.concat([
          f.u32(7),
          f.u64(BigInt(count)),
          Buffer.alloc(count),
        ]),
      },
    ],
  });
  const { path, provider } = await providerAt(fixture.bytes);
  const controller = new AbortController();
  const reason = new Error("stop large array");
  const pending = provider.inspect(
    { path, hash: "header" },
    { signal: controller.signal },
  );
  setTimeout(() => controller.abort(reason), 0);
  const result = await pending;
  if (result.ok) throw new Error("Cancellation ignored");
  expect(result.error).toMatchObject({
    _tag: "AnalysisCancelledError",
    cause: reason,
  });
  await writeFile(path, ggufFixture().bytes);
  const recovered = await provider.inspect({ path, hash: "header" });
  if (!recovered.ok) throw recovered.error;
  expect(recovered.value.tensors).toHaveLength(2);
});

it("retains explicit scoped identity through shared service and preserves caller abort reasons", async () => {
  const fixture = ggufFixture();
  const { path } = await providerAt(fixture.bytes);
  const service = createModelArtifactService();
  onTestFinished(() => service.close());
  const result = await service.inspect({ path, detail: "complete" });
  if (!result.ok) throw result.error;
  expect(result.value.subject).toBeNull();
  expect(
    modelArtifactSchema.parse(result.value.normalized_result).artifact.sha256,
  ).toBeNull();
  const full = await service.inspect({
    path,
    hash: "full",
    detail: "complete",
  });
  if (!full.ok) throw full.error;
  expect(full.value.subject?.digest.sha256).toBe(hash(fixture.bytes));
  const controller = new AbortController();
  const reason = new Error("selected caller stop");
  controller.abort(reason);
  const stopped = await service.inspect(
    { path, detail: "complete" },
    { signal: controller.signal },
  );
  if (stopped.ok) throw new Error("Cancellation ignored");
  expect(stopped.error.cause).toBe(reason);
});
