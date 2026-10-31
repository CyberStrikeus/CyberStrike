type GgmlType = readonly [
  name: string,
  rowElementMultiple: number,
  blockBytes: number | null,
  limitation?: {
    readonly kind: "storage" | "type-identity";
    readonly reason: string;
  },
];

const kStorageLimitation = {
  kind: "storage",
  reason:
    "K-quantization types (IDs 10–15) have released 64-element and 256-element block layouts with the same GGUF and quantization versions. The common 64-element row constraint does not establish a storage block size. Nonempty tensor byte lengths and storage validation remain unknown; file extents and general.file_type do not identify the layout.",
} as const;

const ambiguousGgmlType = (id: number, candidates: string): GgmlType => [
  `AMBIGUOUS_${String(id)}`,
  1,
  null,
  {
    kind: "type-identity",
    reason: `GGUF tensor type ID ${String(id)} has released ${candidates} meanings with the same GGUF and quantization versions. Textual identity and nonempty byte lengths remain unknown; file extents and general.file_type do not identify the per-tensor layout.`,
  },
];

/** Modern names/sizes: ggml da8e2a54 enum and block sizeof assertions.
 * Historical collisions: llama.cpp b1500/b1803/b1871/b2100/b2172/b2221/
 * b2253/b2275/b2300. Their GGUF v3 / quantization v2 do not select a layout.
 * A common row multiple is necessary, but need not be a known storage block.
 */
const GGML_TYPES: Readonly<Record<number, GgmlType>> = {
  0: ["F32", 1, 4],
  1: ["F16", 1, 2],
  2: ["Q4_0", 32, 18],
  3: ["Q4_1", 32, 20],
  6: ["Q5_0", 32, 22],
  7: ["Q5_1", 32, 24],
  8: ["Q8_0", 32, 34],
  // llama.cpp b1500 (57ad015d) uses two float32 scales (40 bytes), while
  // ggml da8e2a54 uses two float16 scales (36 bytes). Both declare
  // GGUF version 3 and quantization version 2; neither selects the layout.
  9: [
    "Q8_1",
    32,
    null,
    {
      kind: "storage",
      reason:
        "Q8_1 has released 40-byte and 36-byte layouts per 32 elements with the same GGUF and quantization versions. Nonempty tensor byte lengths and storage validation remain unknown; offsets and file padding do not identify the layout.",
    },
  ],
  10: ["Q2_K", 64, null, kStorageLimitation],
  11: ["Q3_K", 64, null, kStorageLimitation],
  12: ["Q4_K", 64, null, kStorageLimitation],
  13: ["Q5_K", 64, null, kStorageLimitation],
  14: ["Q6_K", 64, null, kStorageLimitation],
  15: ["Q8_K", 64, null, kStorageLimitation],
  16: ambiguousGgmlType(16, "I8 / IQ2_XXS"),
  17: ambiguousGgmlType(17, "I16 / I8 / IQ2_XS"),
  18: ambiguousGgmlType(18, "I32 / I16 / I8 / IQ3_XXS"),
  19: ambiguousGgmlType(19, "I32 / I16 / I8 / IQ1_S"),
  20: ambiguousGgmlType(20, "I32 / I16 / I8 / IQ4_NL"),
  21: ambiguousGgmlType(21, "I32 / I16 / I8 / IQ3_S"),
  22: ambiguousGgmlType(22, "I32 / I16 / I8 / IQ2_S"),
  23: ambiguousGgmlType(23, "I32 / I16 / I8 / IQ4_XS"),
  24: ambiguousGgmlType(24, "I32 / I16 / I8"),
  25: ambiguousGgmlType(25, "I32 / I16"),
  26: ["I32", 1, 4],
  27: ["I64", 1, 8],
  28: ["F64", 1, 8],
  29: ["IQ1_M", 256, 56],
  30: ["BF16", 1, 2],
  34: ["TQ1_0", 256, 54],
  35: ["TQ2_0", 256, 66],
  39: ["MXFP4", 32, 17],
  40: ["NVFP4", 64, 36],
  41: ["Q1_0", 128, 18],
  42: ["Q2_0", 64, 18],
};

export const ggmlType = (id: number): GgmlType | undefined => GGML_TYPES[id];

/** safetensors e246a256 Dtype::bitsize, including packed sub-byte types. */
const SAFETENSORS_BITS: Readonly<Record<string, number>> = {
  BOOL: 8,
  F4: 4,
  F6_E2M3: 6,
  F6_E3M2: 6,
  I8: 8,
  U8: 8,
  F8_E5M2: 8,
  F8_E4M3: 8,
  F8_E8M0: 8,
  F8_E4M3FNUZ: 8,
  F8_E5M2FNUZ: 8,
  I16: 16,
  U16: 16,
  F16: 16,
  BF16: 16,
  I32: 32,
  U32: 32,
  F32: 32,
  I64: 64,
  U64: 64,
  F64: 64,
  C64: 64,
};

export const safetensorsBits = (type: string): number | undefined =>
  Object.hasOwn(SAFETENSORS_BITS, type) ? SAFETENSORS_BITS[type] : undefined;
