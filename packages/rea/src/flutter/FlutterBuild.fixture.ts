import { Buffer } from "node:buffer";

/** The reference Gallery snapshot hash for synthetic fixtures. */
export const REFERENCE_HASH = "65817c30a78bb44c3dc3771876b6010a";

/** A synthetic AOT image with four symbols, two data sections, and a pool. */
export const aotFixtureImage = (hash: string = REFERENCE_HASH): Buffer => {
  const elf = buildElf64Image([
    { name: "_kDartVmSnapshotData", value: 0x1000, size: 52 },
    { name: "_kDartVmSnapshotInstructions", value: 0x1800, size: 16 },
    { name: "_kDartIsolateSnapshotData", value: 0x2000, size: 0x600 },
    { name: "_kDartIsolateSnapshotInstructions", value: 0x2600, size: 16 },
  ]);
  const pool = Buffer.concat([
    Buffer.from(
      "package:adaptive_breakpoints/src/adaptive_breakpoints.dart\x00",
    ),
    Buffer.from("package:animations/src/fade_scale_transition.dart\x00"),
    Buffer.from("dart:_http\x00dart:_http/crypto.dart\x00"),
    Buffer.from("AdaptiveBreakpoint\x00FadeScaleTransition\x00"),
  ]);
  const vmSection = snapshotSection(hash);
  const isolateSection = Buffer.concat([
    snapshotSection(hash),
    Buffer.from([0]),
    pool,
  ]);
  return Buffer.concat([
    elf,
    Buffer.alloc(0x1000 - elf.length),
    vmSection,
    Buffer.alloc(0x1800 - 0x1000 - vmSection.length),
    Buffer.alloc(16),
    Buffer.alloc(0x2000 - 0x1800 - 16),
    isolateSection,
    Buffer.alloc(0x600 - isolateSection.length),
    Buffer.alloc(16),
  ]);
};

export const buildElf64Image = (
  symbols: ReadonlyArray<{ name: string; value: number; size: number }>,
): Buffer => {
  const ELF_HEADER = 64;
  const PHENT = 56;
  const PHNUM = 1;
  const SHENT = 64;
  const phoff = ELF_HEADER;
  const shoffAligned = phoff + PHENT * PHNUM;
  // Place payload data after the three section headers so nothing overlaps.
  const dynsymOff = shoffAligned + 3 * SHENT + 16;
  const dynstrOff = dynsymOff + symbols.length * 24;
  const image = Buffer.alloc(dynstrOff + 256);
  // ELF header
  image.writeUInt32LE(0x464c457f, 0);
  image[4] = 2; // ELFCLASS64
  image[5] = 1; // little-endian
  image[6] = 1; // ELF identification version
  image.writeUInt16LE(3, 0x10);
  image.writeUInt16LE(0x003e, 0x12); // e_machine x86_64
  image.writeUInt32LE(1, 0x14); // e_version
  image.writeUInt16LE(ELF_HEADER, 0x34);
  image.writeBigUInt64LE(BigInt(phoff), 0x20);
  image.writeBigUInt64LE(BigInt(shoffAligned), 0x28);
  image.writeUInt16LE(PHENT, 0x36);
  image.writeUInt16LE(PHNUM, 0x38);
  image.writeUInt16LE(SHENT, 0x3a);
  image.writeUInt16LE(2, 0x3c); // e_shnum: null + dynsym
  // Program header: one PT_LOAD mapping identity
  const ph = phoff;
  image.writeUInt32LE(1, ph); // PT_LOAD
  image.writeBigUInt64LE(BigInt(0), ph + 8); // offset
  image.writeBigUInt64LE(BigInt(0), ph + 0x10); // vaddr
  image.writeBigUInt64LE(
    BigInt(
      Math.max(
        image.length,
        ...symbols.map((symbol) => symbol.value + symbol.size),
      ),
    ),
    ph + 0x20,
  ); // p_filesz covers the materialized payload
  // Section headers
  const sh = shoffAligned;
  // null section stays zero
  const dyn = sh + SHENT;
  image.writeUInt32LE(11, dyn + 4); // SHT_DYNSYM
  image.writeBigUInt64LE(BigInt(dynsymOff), dyn + 0x18);
  image.writeBigUInt64LE(BigInt(symbols.length * 24), dyn + 0x20);
  image.writeBigUInt64LE(BigInt(24), dyn + 0x38);
  image.writeUInt32LE(2, dyn + 0x28); // sh_link -> strtab section index
  // dynstr section header
  const str = dyn + SHENT;
  image.writeUInt32LE(3, str + 4); // SHT_STRTAB
  image.writeBigUInt64LE(BigInt(dynstrOff), str + 0x18);
  image.writeBigUInt64LE(BigInt(256), str + 0x20);
  image.writeUInt16LE(3, 0x3c); // e_shnum includes strtab
  // dynstr: leading NUL then names
  let strCursor = dynstrOff + 1;
  const nameOffsets = symbols.map((symbol) => {
    image.write(symbol.name, strCursor, "latin1");
    const at = strCursor - dynstrOff;
    strCursor += symbol.name.length + 1;
    return at;
  });
  // dynsym entries
  symbols.forEach((symbol, index) => {
    const base = dynsymOff + index * 24;
    image.writeUInt32LE(nameOffsets[index]!, base);
    image.writeBigUInt64LE(BigInt(symbol.value), base + 8);
    image.writeBigUInt64LE(BigInt(symbol.size), base + 16);
    image.writeUInt16LE(1, base + 6); // Defined export (not SHN_UNDEF).
    image[base + 4] = 0x10; // GLOBAL FUNC
  });
  return image;
};

/** The ELF32 (ARM) counterpart of {@link buildElf64Image}, with the same layout roles. */
export const buildElf32Image = (
  symbols: ReadonlyArray<{ name: string; value: number; size: number }>,
): Buffer => {
  const ELF_HEADER = 52;
  const PHENT = 32;
  const SHENT = 40;
  const SYMENT = 16;
  const phoff = ELF_HEADER;
  const shoff = phoff + PHENT;
  const dynsymOff = shoff + 3 * SHENT + 16;
  const dynstrOff = dynsymOff + symbols.length * SYMENT;
  const image = Buffer.alloc(dynstrOff + 256);
  image.writeUInt32LE(0x464c457f, 0);
  image[4] = 1; // ELFCLASS32
  image[5] = 1; // little-endian
  image[6] = 1;
  image.writeUInt16LE(3, 0x10);
  image.writeUInt16LE(0x0028, 0x12); // e_machine ARM
  image.writeUInt32LE(1, 0x14);
  image.writeUInt32LE(phoff, 0x1c);
  image.writeUInt32LE(shoff, 0x20);
  image.writeUInt16LE(ELF_HEADER, 0x28);
  image.writeUInt16LE(PHENT, 0x2a);
  image.writeUInt16LE(1, 0x2c);
  image.writeUInt16LE(SHENT, 0x2e);
  image.writeUInt16LE(3, 0x30); // null, dynsym, dynstr
  // One identity PT_LOAD covering the materialized payload.
  image.writeUInt32LE(1, phoff);
  image.writeUInt32LE(
    Math.max(image.length, ...symbols.map(({ value, size }) => value + size)),
    phoff + 0x10,
  );
  const dyn = shoff + SHENT;
  image.writeUInt32LE(11, dyn + 4); // SHT_DYNSYM
  image.writeUInt32LE(dynsymOff, dyn + 0x10);
  image.writeUInt32LE(symbols.length * SYMENT, dyn + 0x14);
  image.writeUInt32LE(2, dyn + 0x18); // sh_link -> strtab
  image.writeUInt32LE(SYMENT, dyn + 0x24);
  const str = dyn + SHENT;
  image.writeUInt32LE(3, str + 4); // SHT_STRTAB
  image.writeUInt32LE(dynstrOff, str + 0x10);
  image.writeUInt32LE(256, str + 0x14);
  let strCursor = dynstrOff + 1;
  symbols.forEach((symbol, index) => {
    image.write(symbol.name, strCursor, "latin1");
    const base = dynsymOff + index * SYMENT;
    image.writeUInt32LE(strCursor - dynstrOff, base);
    image.writeUInt32LE(symbol.value, base + 4);
    image.writeUInt32LE(symbol.size, base + 8);
    image[base + 0xc] = 0x10; // GLOBAL
    image.writeUInt16LE(1, base + 0xe); // Defined export.
    strCursor += symbol.name.length + 1;
  });
  return image;
};

/**
 * Build a section-stripped ELF64 image (e_shnum 0, ET_DYN) whose exported
 * symbols are reachable only through the PT_DYNAMIC tag-value pairs, the
 * way release toolchains ship `libapp.so`.
 */
export const buildStrippedElf64Image = (
  symbols: ReadonlyArray<{ name: string; value: number; size: number }>,
  extraDynamicEntries: ReadonlyArray<readonly [number, bigint]> = [],
): Buffer => {
  const ELF_HEADER = 64;
  const PHENT = 56;
  const PHNUM = 2;
  const dynamicEntry = 16;
  // DT_SYMTAB, DT_STRTAB, DT_STRSZ, DT_SYMENT, DT_HASH, DT_NULL.
  const DYNAMIC_ENTRIES = 6 + extraDynamicEntries.length;
  const phoff = ELF_HEADER;
  const dynamicOff = phoff + PHENT * PHNUM;
  const dynsymOff = dynamicOff + DYNAMIC_ENTRIES * dynamicEntry;
  const dynstrOff = dynsymOff + symbols.length * 24;
  const strtabBytes = 256;
  const hashOff = dynstrOff + strtabBytes;
  const image = Buffer.alloc(hashOff + 8 + 4 * (1 + symbols.length));
  image.writeUInt32LE(1, hashOff);
  image.writeUInt32LE(symbols.length, hashOff + 4);
  // ELF header
  image.writeUInt32LE(0x464c457f, 0);
  image[4] = 2; // ELFCLASS64
  image[5] = 1; // little-endian
  image[6] = 1;
  image.writeUInt16LE(3, 0x10);
  image.writeUInt16LE(0x003e, 0x12); // e_machine x86_64
  image.writeUInt32LE(1, 0x14);
  image.writeUInt16LE(ELF_HEADER, 0x34);
  image.writeBigUInt64LE(BigInt(phoff), 0x20);
  image.writeUInt16LE(PHENT, 0x36);
  image.writeUInt16LE(PHNUM, 0x38);
  // e_shoff, e_shentsize, and e_shnum stay zero: no section headers exist.
  // PT_LOAD identity-maps the file so symbol vaddrs resolve to offsets.
  const load = phoff;
  image.writeUInt32LE(1, load);
  image.writeBigUInt64LE(BigInt(0), load + 8);
  image.writeBigUInt64LE(BigInt(0), load + 0x10);
  image.writeBigUInt64LE(
    BigInt(
      Math.max(
        image.length,
        ...symbols.map((symbol) => symbol.value + symbol.size),
      ),
    ),
    load + 0x20,
  ); // p_filesz covers fixture symbols
  // PT_DYNAMIC locates the symbol table for stripped images.
  const dyn = phoff + PHENT;
  image.writeUInt32LE(2, dyn);
  image.writeBigUInt64LE(BigInt(dynamicOff), dyn + 8); // p_offset
  image.writeBigUInt64LE(BigInt(dynamicOff), dyn + 0x10); // p_vaddr
  image.writeBigUInt64LE(BigInt(DYNAMIC_ENTRIES * dynamicEntry), dyn + 0x20);
  const pairs: ReadonlyArray<readonly [number, number | bigint]> = [
    [6, dynsymOff],
    [5, dynstrOff],
    [10, strtabBytes],
    [11, 24],
    [4, hashOff],
    ...extraDynamicEntries,
  ];
  pairs.forEach(([tag, value], index) => {
    const base = dynamicOff + index * dynamicEntry;
    image.writeBigUInt64LE(BigInt(tag), base);
    image.writeBigUInt64LE(BigInt(value), base + 8);
  });
  // The final entry stays zero: DT_NULL terminates the walk.
  // dynstr: leading NUL then names
  let strCursor = dynstrOff + 1;
  const nameOffsets = symbols.map((symbol) => {
    image.write(symbol.name, strCursor, "latin1");
    const at = strCursor - dynstrOff;
    strCursor += symbol.name.length + 1;
    return at;
  });
  symbols.forEach((symbol, index) => {
    const base = dynsymOff + index * 24;
    image.writeUInt32LE(nameOffsets[index]!, base);
    image.writeBigUInt64LE(BigInt(symbol.value), base + 8);
    image.writeBigUInt64LE(BigInt(symbol.size), base + 16);
    image.writeUInt16LE(1, base + 6); // Defined even when section headers are stripped.
  });
  return image;
};

/** Four snapshot exports and their pool, discovered without section headers. */
export const strippedAotFixtureImage = (
  extraDynamicEntries: ReadonlyArray<readonly [number, bigint]> = [],
): Buffer => {
  const symbols = buildStrippedElf64Image(
    [
      { name: "_kDartVmSnapshotData", value: 0x1000, size: 52 },
      { name: "_kDartVmSnapshotInstructions", value: 0x1800, size: 16 },
      { name: "_kDartIsolateSnapshotData", value: 0x2000, size: 0x600 },
      { name: "_kDartIsolateSnapshotInstructions", value: 0x2600, size: 16 },
    ],
    extraDynamicEntries,
  );
  const vmSection = snapshotSection(REFERENCE_HASH);
  const isolateSection = Buffer.concat([
    snapshotSection(REFERENCE_HASH),
    Buffer.from([0]),
    Buffer.from("package:example/main.dart\0dart:core\0Example\0"),
  ]);
  return Buffer.concat([
    symbols,
    Buffer.alloc(0x1000 - symbols.length),
    vmSection,
    Buffer.alloc(0x1800 - 0x1000 - vmSection.length),
    Buffer.alloc(16),
    Buffer.alloc(0x2000 - 0x1800 - 16),
    isolateSection,
    Buffer.alloc(0x600 - isolateSection.length),
    Buffer.alloc(16),
  ]);
};

/** A minimal Dart snapshot data section carrying a 32-hex hash. */
export const snapshotSection = (hash: string): Buffer =>
  Buffer.concat([
    Buffer.from([
      0xf5, 0xf5, 0xdc, 0xdc, 48, 0, 0, 0, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0,
    ]),
    Buffer.from(hash, "latin1"),
  ]);

/** A real ELF container declaring GNU note ownership, with an unrelated payload prefix. */
export const engineFixtureImage = (options: {
  readonly notes: Buffer;
  readonly prefix?: Buffer;
  readonly labels?: readonly string[];
  readonly bits?: 32 | 64;
  readonly ownership?: "program" | "section" | "both";
}): Buffer => {
  const is64 = options.bits !== 32;
  const ownership = options.ownership ?? "program";
  const program = ownership !== "section";
  const section = ownership !== "program";
  const header = is64 ? 64 : 52;
  const phent = is64 ? 56 : 32;
  const shent = is64 ? 64 : 40;
  const noteAt = 0x400;
  const labels = Buffer.from(`\0${(options.labels ?? []).join("\0")}\0`);
  const image = Buffer.alloc(noteAt + options.notes.length + labels.length);
  image.writeUInt32LE(0x464c457f);
  image[4] = is64 ? 2 : 1;
  image[5] = 1;
  image[6] = 1;
  image.writeUInt16LE(3, 0x10);
  image.writeUInt32LE(1, 0x14);
  image.writeUInt16LE(header, is64 ? 0x34 : 0x28);
  const word = (value: number, offset: number): void => {
    if (is64) image.writeBigUInt64LE(BigInt(value), offset);
    else image.writeUInt32LE(value, offset);
  };
  word(header, is64 ? 0x20 : 0x1c);
  image.writeUInt16LE(phent, is64 ? 0x36 : 0x2a);
  image.writeUInt16LE(program ? 2 : 1, is64 ? 0x38 : 0x2c);
  image.writeUInt32LE(1, header); // PT_LOAD
  word(image.length, header + (is64 ? 0x20 : 0x10));
  if (program) {
    const ph = header + phent;
    image.writeUInt32LE(4, ph); // PT_NOTE
    word(noteAt, ph + (is64 ? 8 : 4));
    word(options.notes.length, ph + (is64 ? 0x20 : 0x10));
  }
  if (section) {
    word(0x100, is64 ? 0x28 : 0x20);
    image.writeUInt16LE(shent, is64 ? 0x3a : 0x2e);
    image.writeUInt16LE(2, is64 ? 0x3c : 0x30);
    const sh = 0x100 + shent;
    image.writeUInt32LE(7, sh + 4); // SHT_NOTE
    word(noteAt, sh + (is64 ? 0x18 : 0x10));
    word(options.notes.length, sh + (is64 ? 0x20 : 0x14));
  }
  options.prefix?.copy(image, 0x300, 0, 0x100);
  options.notes.copy(image, noteAt);
  labels.copy(image, noteAt + options.notes.length);
  return image;
};

/** Relocate one table and append declarations without disturbing payload bytes. */
export const appendElfRanges = (
  image: Buffer,
  table: "program" | "section",
  ranges: readonly {
    type: number;
    offset: number;
    size: number;
    address?: number;
  }[],
): Buffer => {
  const is64 = image[4] === 2;
  const program = table === "program";
  const offsetAt = program ? (is64 ? 0x20 : 0x1c) : is64 ? 0x28 : 0x20;
  const widthAt = program ? (is64 ? 0x36 : 0x2a) : is64 ? 0x3a : 0x2e;
  const countAt = widthAt + 2;
  const oldOffset = is64
    ? Number(image.readBigUInt64LE(offsetAt))
    : image.readUInt32LE(offsetAt);
  const oldWidth = image.readUInt16LE(widthAt);
  const oldCount = image.readUInt16LE(countAt);
  const width = oldWidth || (is64 ? 64 : 40);
  const count = oldCount || 1; // A section table starts with its null entry.
  const offset = Math.ceil(image.length / 8) * 8;
  const result = Buffer.alloc(offset + (count + ranges.length) * width);
  image.copy(result);
  image.copy(result, offset, oldOffset, oldOffset + oldCount * oldWidth);
  const word = (value: number, at: number): void => {
    if (is64) result.writeBigUInt64LE(BigInt(value), at);
    else result.writeUInt32LE(value, at);
  };
  word(offset, offsetAt);
  result.writeUInt16LE(width, widthAt);
  result.writeUInt16LE(count + ranges.length, countAt);
  ranges.forEach((range, index) => {
    const at = offset + (count + index) * width;
    result.writeUInt32LE(range.type, at + (program ? 0 : 4));
    word(range.offset, at + (program ? (is64 ? 8 : 4) : is64 ? 0x18 : 0x10));
    word(
      range.size,
      at + (program ? (is64 ? 0x20 : 0x10) : is64 ? 0x20 : 0x14),
    );
    if (program) word(range.address ?? 0, at + (is64 ? 0x10 : 8));
  });
  return result;
};
