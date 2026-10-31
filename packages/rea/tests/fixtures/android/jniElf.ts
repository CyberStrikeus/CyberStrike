type FixtureEncoding = "rel" | "rela" | "relr";

const fixtureWriter = (bytes: Buffer, bits: 32 | 64, little: boolean) => {
  const u16 = (at: number, value: number) =>
    little ? bytes.writeUInt16LE(value, at) : bytes.writeUInt16BE(value, at);
  const u32 = (at: number, value: number) =>
    little ? bytes.writeUInt32LE(value, at) : bytes.writeUInt32BE(value, at);
  const u64 = (at: number, value: bigint) =>
    little
      ? bytes.writeBigUInt64LE(value, at)
      : bytes.writeBigUInt64BE(value, at);
  const ptr = (at: number, value: bigint) =>
    bits === 64 ? u64(at, value) : u32(at, Number(value));
  return { u16, u32, u64, ptr };
};
type FixtureWriter = ReturnType<typeof fixtureWriter>;

/** Header declarations have one owner for both pointer widths. */
const writeHeaders = (
  input: {
    bytes: Buffer;
    bits: 32 | 64;
    little: boolean;
    machine: number;
    base: bigint;
    dynamicBytes: number;
  },
  writer: FixtureWriter,
) => {
  const { bytes, bits, little, machine, base, dynamicBytes } = input;
  const { u16, u32, u64, ptr } = writer;
  bytes.set([0x7f, 0x45, 0x4c, 0x46, bits === 64 ? 2 : 1, little ? 1 : 2, 1]);
  u16(16, 3);
  u16(18, machine);
  u32(20, 1);
  const ph = bits === 64 ? 64 : 52,
    phWidth = bits === 64 ? 56 : 32;
  if (bits === 64) {
    u64(32, BigInt(ph));
    u64(40, 0x1400n);
  } else {
    u32(28, ph);
    u32(32, 0x1400);
  }
  u16(bits === 64 ? 52 : 40, ph);
  u16(bits === 64 ? 54 : 42, phWidth);
  u16(bits === 64 ? 56 : 44, 3);
  u16(bits === 64 ? 58 : 46, bits === 64 ? 64 : 40);
  u16(bits === 64 ? 60 : 48, 10);
  u16(bits === 64 ? 62 : 50, 9);
  const program = (
    row: number,
    type: number,
    offset: number,
    size: number,
    flags: number,
  ) => {
    const at = ph + row * phWidth;
    u32(at, type);
    if (bits === 64) {
      u32(at + 4, flags);
      ptr(at + 8, BigInt(offset));
      ptr(at + 16, base + BigInt(offset));
      ptr(at + 32, BigInt(size));
      ptr(at + 40, BigInt(size));
      ptr(at + 48, 0x1000n);
    } else {
      u32(at + 4, offset);
      u32(at + 8, Number(base) + offset);
      u32(at + 16, size);
      u32(at + 20, size);
      u32(at + 24, flags);
      u32(at + 28, 0x1000);
    }
  };
  program(0, 1, 0, 0x400, 5);
  program(1, 1, 0x400, bytes.length - 0x400, 6);
  program(2, 2, 0xc00, dynamicBytes, 6);
};

/** Section and dynamic-symbol declarations refer to the fixture's fixed byte ranges. */
const writeDirectory = (
  input: {
    bytes: Buffer;
    bits: 32 | 64;
    word: number;
    base: bigint;
    encoding: FixtureEncoding;
    rowWidth: number;
    relocationSize: number;
    dynamicBytes: number;
    functions: readonly bigint[];
    unnamedData: boolean;
  },
  writer: FixtureWriter,
) => {
  const {
    bytes,
    bits,
    word,
    base,
    encoding,
    rowWidth,
    relocationSize,
    dynamicBytes,
    functions,
    unnamedData,
  } = input;
  const { u16, u32, ptr } = writer;
  const dynstr = Buffer.from("\0JNI_OnLoad\0Java_fixture_Owner_exported\0");
  bytes.set(dynstr, 0x1100);
  const symbolWidth = bits === 64 ? 24 : 16;
  for (const [i, name] of [1, 12].entries()) {
    const at = 0x1000 + (i + 1) * symbolWidth;
    u32(at, name);
    if (bits === 64) {
      bytes[at + 4] = 0x12;
      u16(at + 6, 1);
      ptr(at + 8, functions[0] ?? 0n);
      ptr(at + 16, 1n);
    } else {
      ptr(at + 4, functions[0] ?? 0n);
      ptr(at + 8, 1n);
      bytes[at + 12] = 0x12;
      u16(at + 14, 1);
    }
  }
  const names = [
    "",
    ".text",
    ".rodata",
    ".data",
    ".data.rel.ro",
    `.${encoding}.dyn`,
    ".dynamic",
    ".dynsym",
    ".dynstr",
    ".shstrtab",
  ];
  const shstrings = Buffer.from(names.join("\0") + "\0");
  bytes.set(shstrings, 0x1200);
  const rows = [
    [0, 0, 0, 0, 0, 0, 0],
    [1, 6, 0x100, 0x30, 0, 0, 0],
    [1, 2, 0x400, 0x100, 0, 0, 0],
    [1, 3, 0x500, word * 6, 0, 0, 0],
    [1, 3, 0x600, word * 3, 0, 0, 0],
    [
      encoding === "rela" ? 4 : encoding === "rel" ? 9 : 19,
      2,
      0x800,
      relocationSize,
      7,
      0,
      encoding === "relr" ? word : rowWidth,
    ],
    [6, 3, 0xc00, dynamicBytes, 8, 0, word * 2],
    [11, 2, 0x1000, symbolWidth * 3, 8, 1, symbolWidth],
    [3, 2, 0x1100, dynstr.length, 0, 0, 0],
    [3, 0, 0x1200, shstrings.length, 0, 0, 0],
  ];
  let nameOffset = 0;
  rows.forEach(
    (
      [
        type = 0,
        flags = 0,
        offset = 0,
        size = 0,
        link = 0,
        info = 0,
        entry = 0,
      ],
      i,
    ) => {
      if (i === 0) {
        nameOffset++;
        return;
      }
      const at = 0x1400 + i * (bits === 64 ? 64 : 40);
      u32(at, unnamedData === true && i === 3 ? 0 : nameOffset);
      u32(at + 4, type);
      if (bits === 64) {
        ptr(at + 8, BigInt(flags));
        ptr(at + 16, base + BigInt(offset));
        ptr(at + 24, BigInt(offset));
        ptr(at + 32, BigInt(size));
        u32(at + 40, link);
        u32(at + 44, info);
        ptr(at + 48, BigInt(word));
        ptr(at + 56, BigInt(entry));
      } else {
        u32(at + 8, flags);
        u32(at + 12, Number(base) + offset);
        u32(at + 16, offset);
        u32(at + 20, size);
        u32(at + 24, link);
        u32(at + 28, info);
        u32(at + 32, word);
        u32(at + 36, entry);
      }
      nameOffset += Buffer.byteLength(names[i] ?? "") + 1;
    },
  );
};

/** Hand-produced loader/section fixture, independent of the JNI parser. Never executed. */
export const jniElfFixture = (
  options: {
    readonly bits?: 32 | 64;
    readonly machine?: number;
    readonly encoding?: "rel" | "rela" | "relr";
    readonly little?: boolean;
    readonly symbolicFirstFunction?: boolean;
    readonly packed?: boolean;
    readonly unnamedData?: boolean;
  } = {},
) => {
  const bits = options.bits ?? 64,
    word = bits / 8;
  const little = options.little ?? true;
  const machine = options.machine ?? (bits === 64 ? 183 : 40);
  const encoding = options.encoding ?? (bits === 64 ? "rela" : "rel");
  const bytes = Buffer.alloc(0x1800);
  const base = 0x10000n;
  const writer = fixtureWriter(bytes, bits, little);
  const { ptr } = writer;
  const functions = [base + 0x100n, base + 0x110n, base + 0x120n].map((x) =>
    machine === 40 ? x | 1n : x,
  );
  bytes[0x100] = 0xc3;
  bytes[0x110] = 0xc3;
  bytes[0x120] = 0xc3;
  const mutf = (text: string) => {
    const encoded: number[] = [];
    for (let at = 0; at < text.length; at++) {
      const c = text.charCodeAt(at);
      if (c > 0 && c < 128) encoded.push(c);
      else if (c < 2048) encoded.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      else
        encoded.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return Buffer.from([...encoded, 0]);
  };
  const stringOffsets = [0x400, 0x420, 0x440, 0x460, 0x480, 0x4a0];
  ["call_猫", "()V", "overload", "(I)I", "𐐀", "([Ljava/lang/String;)J"].forEach(
    (s, i) => bytes.set(mutf(s), stringOffsets[i] ?? 0),
  );
  const slots = [
    [0x500, base + 0x400n],
    [0x500 + word, base + 0x420n],
    [0x500 + word * 2, functions[0] ?? 0n],
    [0x500 + word * 3, base + 0x440n],
    [0x500 + word * 4, base + 0x460n],
    [0x500 + word * 5, functions[1] ?? 0n],
    [0x600, base + 0x480n],
    [0x600 + word, base + 0x4a0n],
    [0x600 + word * 2, functions[2] ?? 0n],
  ] as const;
  const relative = machine === 183 ? 1027 : machine === 40 ? 23 : 8;
  const rowWidth = word * (encoding === "rela" ? 3 : 2);
  if (encoding === "relr") {
    slots.forEach(([at, value]) => ptr(at, value));
    [base + 0x500n, 63n, base + 0x600n, 7n].forEach((value, i) =>
      ptr(0x800 + i * word, value),
    );
  } else
    slots.forEach(([at, value], i) => {
      const row = 0x800 + i * rowWidth;
      const symbolic = options.symbolicFirstFunction === true && i === 2;
      const kind = symbolic
        ? machine === 183
          ? 1025
          : machine === 40
            ? 21
            : 6
        : relative;
      ptr(row, base + BigInt(at));
      ptr(
        row + word,
        bits === 64
          ? BigInt(kind) | (symbolic ? 1n << 32n : 0n)
          : BigInt(kind | (symbolic ? 1 << 8 : 0)),
      );
      if (encoding === "rela") ptr(row + word * 2, value);
      else ptr(at, value);
    });
  const relocationSize =
    encoding === "relr" ? word * 4 : rowWidth * slots.length;
  const tags: [bigint, bigint][] =
    encoding === "relr"
      ? [
          [36n, base + 0x800n],
          [35n, BigInt(relocationSize)],
          [37n, BigInt(word)],
        ]
      : encoding === "rela"
        ? [
            [7n, base + 0x800n],
            [8n, BigInt(relocationSize)],
            [9n, BigInt(rowWidth)],
          ]
        : [
            [17n, base + 0x800n],
            [18n, BigInt(relocationSize)],
            [19n, BigInt(rowWidth)],
          ];
  if (options.packed === true) tags.push([0x60000011n, base + 0x800n]);
  tags.push([0n, 0n]);
  tags.forEach(([tag, value], i) => {
    ptr(0xc00 + i * word * 2, tag);
    ptr(0xc00 + i * word * 2 + word, value);
  });
  const dynamicBytes = tags.length * word * 2;
  writeHeaders({ bytes, bits, little, machine, base, dynamicBytes }, writer);
  writeDirectory(
    {
      bytes,
      bits,
      word,
      base,
      encoding,
      rowWidth,
      relocationSize,
      dynamicBytes,
      functions,
      unnamedData: options.unnamedData === true,
    },
    writer,
  );
  return { bytes, base, word, functions, slots, relocationSize };
};
