// Released llama.cpp b1500 GGML_QKK_64 blocks and default/b3001 blocks.
// These are source-derived payload sizes, not output from historical binaries.
export const ggufKLayouts = [
  { id: 10, name: "Q2_K", bytes64: 24, bytes256: 84 },
  { id: 11, name: "Q3_K", bytes64: 28, bytes256: 110 },
  { id: 12, name: "Q4_K", bytes64: 38, bytes256: 144 },
  { id: 13, name: "Q5_K", bytes64: 46, bytes256: 176 },
  { id: 14, name: "Q6_K", bytes64: 54, bytes256: 210 },
  { id: 15, name: "Q8_K", bytes64: 76, bytes256: 292 },
] as const;

// Integer IDs shifted as IQ types were added, before upstream PR 6050 pinned
// integers at 24–26. Oldest colliding integer width and modern bytes/256 values
// are independent goldens from b1500/b1803/b1871/b2100/b2172/b2221/b2253/b2275
// and b3001. An authored body does not establish producer provenance.
export const ggufShiftedTypeLayouts = [
  { id: 16, integerBytes: 1, modernName: "IQ2_XXS", modernBytes256: 66 },
  { id: 17, integerBytes: 2, modernName: "IQ2_XS", modernBytes256: 74 },
  { id: 18, integerBytes: 4, modernName: "IQ3_XXS", modernBytes256: 98 },
  { id: 19, integerBytes: 4, modernName: "IQ1_S", modernBytes256: 50 },
  { id: 20, integerBytes: 4, modernName: "IQ4_NL", modernBytes256: 144 },
  { id: 21, integerBytes: 4, modernName: "IQ3_S", modernBytes256: 110 },
  { id: 22, integerBytes: 4, modernName: "IQ2_S", modernBytes256: 82 },
  { id: 23, integerBytes: 4, modernName: "IQ4_XS", modernBytes256: 136 },
  { id: 24, integerBytes: 4, modernName: "I8", modernBytes256: 256 },
  { id: 25, integerBytes: 4, modernName: "I16", modernBytes256: 512 },
] as const;

/** Source-built declarations with independent expected byte layouts; no model loader. */
export const ggufFixture = (
  options: {
    bigEndian?: boolean;
    version?: number;
    alignment?: number;
    metadata?: readonly { key: string; type: number; value: Buffer }[];
    tensors?: readonly {
      name: string;
      type: number;
      shape: readonly bigint[];
      offset: bigint;
      bytes: number;
    }[];
  } = {},
) => {
  const big = options.bigEndian ?? false;
  const alignment = options.alignment ?? 32;
  const u32 = (n: number) => {
    const b = Buffer.alloc(4);
    if (big) b.writeUInt32BE(n);
    else b.writeUInt32LE(n);
    return b;
  };
  const u64 = (n: bigint) => {
    const b = Buffer.alloc(8);
    if (big) b.writeBigUInt64BE(n);
    else b.writeBigUInt64LE(n);
    return b;
  };
  const text = (s: string) => {
    const b = Buffer.from(s);
    return Buffer.concat([u64(BigInt(b.length)), b]);
  };
  const metadata = options.metadata ?? [
    { key: "general.architecture", type: 8, value: text("llama") },
    { key: "general.name", type: 8, value: text("Tiny 🦙") },
    { key: "llama.context_length", type: 10, value: u64(2048n) },
    { key: "custom.exact", type: 10, value: u64(0xffffffffffffffffn) },
    {
      key: "tokenizer.ggml.tokens",
      type: 9,
      value: Buffer.concat([
        u32(8),
        u64(10n),
        ...Array.from({ length: 10 }, (_, n) => text(`token-${String(n)}`)),
      ]),
    },
    { key: "tokenizer.chat_template", type: 8, value: text("{{ messages }}") },
    ...(options.alignment === undefined
      ? []
      : [{ key: "general.alignment", type: 4, value: u32(alignment) }]),
  ];
  const tensors = options.tensors ?? [
    { name: "weight", type: 0, shape: [2n, 2n], offset: 0n, bytes: 16 },
    {
      name: "quant",
      type: 2,
      shape: [32n],
      offset: BigInt(Math.ceil(16 / alignment) * alignment),
      bytes: 18,
    },
  ];
  const header = Buffer.concat([
    Buffer.from("GGUF"),
    u32(options.version ?? 3),
    u64(BigInt(tensors.length)),
    u64(BigInt(metadata.length)),
    ...metadata.map((m) => Buffer.concat([text(m.key), u32(m.type), m.value])),
    ...tensors.map((t) =>
      Buffer.concat([
        text(t.name),
        u32(t.shape.length),
        ...t.shape.map(u64),
        u32(t.type),
        u64(t.offset),
      ]),
    ),
  ]);
  const dataOffset = Math.ceil(header.length / alignment) * alignment;
  const length = Math.max(
    dataOffset,
    ...tensors.map((t) => dataOffset + Number(t.offset) + t.bytes),
  );
  const bytes = Buffer.alloc(length, 0xa5);
  header.copy(bytes);
  bytes.fill(0, header.length, dataOffset);
  return { bytes, header, dataOffset, u32, u64, text };
};

export const safetensorsFixture = (
  header: string = JSON.stringify({
    __metadata__: { format: "pt", license: "Apache-2.0" },
    weight: { dtype: "F32", shape: [2, 2], data_offsets: [0, 16] },
    empty: { dtype: "F16", shape: [0, 7], data_offsets: [16, 16] },
  }),
  data: Buffer = Buffer.alloc(16, 0xa5),
) => {
  const text = Buffer.from(
    header + " ".repeat((8 - (Buffer.byteLength(header) % 8)) % 8),
  );
  const length = Buffer.alloc(8);
  length.writeBigUInt64LE(BigInt(text.length));
  return {
    bytes: Buffer.concat([length, text, data]),
    header: Buffer.concat([length, text]),
    dataOffset: 8 + text.length,
  };
};
