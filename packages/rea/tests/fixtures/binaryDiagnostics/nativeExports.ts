/** One PE export-address-table slot: code RVA, forwarder text, or unused. */
export type PeFixtureFunction =
  | { readonly rva: number }
  | { readonly forwarder: string }
  | null;

const SECTION_RVA = 0x1000;
const SECTION_OFFSET = 0x400;
const SECTION_BYTES = 0x400;
/** SizeOfHeaders; header RVAs map to the same file offsets. */
const HEADER_BYTES = 0x400;

/**
 * Minimal PE32/PE32+ image whose only section holds an export directory at
 * RVA 0x1000. Name entries point at `functions` by index.
 */
export const peExportImage = (options: {
  readonly bits?: 32 | 64;
  readonly ordinalBase?: number;
  readonly functions?: readonly PeFixtureFunction[];
  readonly names?: readonly { readonly name: string; readonly index: number }[];
  /** Replace one name's RVA, e.g. with an unmapped one. */
  readonly nameRvaOverride?: {
    readonly position: number;
    readonly rva: number;
  };
  readonly exportDirectory?: boolean;
  readonly declaredFunctions?: number;
  /** Store the export directory and its tables in the PE headers. */
  readonly inHeaders?: boolean;
}): Buffer => {
  const bits = options.bits ?? 64;
  const bytes = Buffer.alloc(SECTION_OFFSET + SECTION_BYTES);
  const wide = bits === 64;
  bytes.write("MZ", 0, "ascii");
  bytes.writeUInt32LE(128, 60);
  bytes.write("PE\0\0", 128, "ascii");
  bytes.writeUInt16LE(wide ? 0x8664 : 0x14c, 132);
  bytes.writeUInt16LE(1, 134);
  const directoriesAt = wide ? 112 : 96;
  const optionalSize = directoriesAt + 16 * 8;
  bytes.writeUInt16LE(optionalSize, 148);
  const optional = 152;
  bytes.writeUInt16LE(wide ? 0x20b : 0x10b, optional);
  if (wide) bytes.writeBigUInt64LE(0x180000000n, optional + 24);
  else bytes.writeUInt32LE(0x10000000, optional + 28);
  bytes.writeUInt32LE(16, optional + directoriesAt - 4);
  bytes.writeUInt32LE(HEADER_BYTES, optional + 60);
  const section = optional + optionalSize;
  bytes.write(".edata", section, "ascii");
  bytes.writeUInt32LE(SECTION_BYTES, section + 8);
  bytes.writeUInt32LE(SECTION_RVA, section + 12);
  bytes.writeUInt32LE(SECTION_BYTES, section + 16);
  bytes.writeUInt32LE(SECTION_OFFSET, section + 20);
  bytes.writeUInt32LE(0x40000040, section + 36);
  if (options.exportDirectory === false) return bytes;

  const at = (rva: number) =>
    rva < HEADER_BYTES ? rva : rva - SECTION_RVA + SECTION_OFFSET;
  const base = options.inHeaders === true ? 0x200 : SECTION_RVA;
  const functions = options.functions ?? [];
  const names = options.names ?? [];
  // Directory, address table, name table, ordinals, then strings; forwarders
  // stay inside the 0x200-byte declared directory range.
  const eat = base + 0x40;
  const nameTable = base + 0x80;
  const ordinalTable = base + 0xc0;
  let forwarderText = base + 0x100;
  let text = base + (options.inHeaders === true ? 0x180 : 0x200);
  const string = (value: string, inside: boolean): number => {
    const rva = inside ? forwarderText : text;
    bytes.write(`${value}\0`, at(rva), "latin1");
    if (inside) forwarderText += value.length + 1;
    else text += value.length + 1;
    return rva;
  };
  bytes.writeUInt32LE(base, optional + directoriesAt);
  bytes.writeUInt32LE(0x200, optional + directoriesAt + 4);
  const directory = at(base);
  bytes.writeUInt32LE(0x5f5e0ff, directory + 4);
  bytes.writeUInt32LE(string("fixture.dll", false), directory + 12);
  bytes.writeUInt32LE(options.ordinalBase ?? 1, directory + 16);
  bytes.writeUInt32LE(
    options.declaredFunctions ?? functions.length,
    directory + 20,
  );
  bytes.writeUInt32LE(names.length, directory + 24);
  bytes.writeUInt32LE(eat, directory + 28);
  bytes.writeUInt32LE(nameTable, directory + 32);
  bytes.writeUInt32LE(ordinalTable, directory + 36);
  functions.forEach((entry, index) => {
    const value =
      entry === null
        ? 0
        : "rva" in entry
          ? entry.rva
          : string(entry.forwarder, true);
    bytes.writeUInt32LE(value, at(eat) + index * 4);
  });
  names.forEach(({ name, index }, position) => {
    const rva =
      options.nameRvaOverride?.position === position
        ? options.nameRvaOverride.rva
        : string(name, false);
    bytes.writeUInt32LE(rva, at(nameTable) + position * 4);
    bytes.writeUInt16LE(index, at(ordinalTable) + position * 2);
  });
  return bytes;
};

/** Compact PE whose name-table aliases all select one shared 4096-byte name. */
export const peRepeatedExportNamesImage = (
  targetRva: number,
  count = 4100,
): Buffer => {
  const names = 0x500;
  const ordinals = names + count * 4;
  const text = ordinals + count * 2;
  const bytes = Buffer.alloc(text + 4097);
  peExportImage({ functions: [{ rva: targetRva }] }).copy(bytes);
  const section = 152 + 240;
  bytes.writeUInt32LE(bytes.length - SECTION_OFFSET, section + 8);
  bytes.writeUInt32LE(bytes.length - SECTION_OFFSET, section + 16);
  const rva = (offset: number): number => offset - SECTION_OFFSET + SECTION_RVA;
  bytes.writeUInt32LE(count, SECTION_OFFSET + 24);
  bytes.writeUInt32LE(rva(names), SECTION_OFFSET + 32);
  bytes.writeUInt32LE(rva(ordinals), SECTION_OFFSET + 36);
  for (let index = 0; index < count; index++)
    bytes.writeUInt32LE(rva(text), names + index * 4);
  bytes.fill(0x6e, text, text + 4096);
  return bytes;
};

/** One `.dynsym` entry; `version` is its raw `.gnu.version` half-word. */
export interface ElfFixtureSymbol {
  readonly name: string;
  readonly binding?: number;
  readonly type?: number;
  readonly visibility?: number;
  readonly section?: number;
  readonly value?: bigint;
  readonly size?: bigint;
  readonly version?: number;
  /** Replace the symbol's string-table offset. */
  readonly nameOffset?: number;
}

export interface ElfFixtureVersionRequirement {
  readonly index: number;
  readonly name: string;
}

const elfStringHash = (value: string): number => {
  let hash = 0;
  for (const character of value) {
    hash = (hash << 4) + character.charCodeAt(0);
    const high = hash & 0xf0000000;
    if (high !== 0) hash ^= high >>> 24;
    hash &= ~high;
  }
  return hash >>> 0;
};

const writeVersionRequirementTable = (input: {
  readonly offset: number;
  readonly requirements: readonly ElfFixtureVersionRequirement[];
  readonly nameOffsets: readonly number[];
  readonly fileOffset: number;
  readonly writeU16: (offset: number, value: number) => void;
  readonly writeU32: (offset: number, value: number) => void;
}): void => {
  const { offset, requirements, nameOffsets, fileOffset, writeU16, writeU32 } =
    input;
  if (requirements.length === 0) return;
  writeU16(offset, 1);
  writeU16(offset + 2, requirements.length);
  writeU32(offset + 4, fileOffset);
  writeU32(offset + 8, 16);
  requirements.forEach((requirement, index) => {
    const at = offset + 16 + index * 16;
    writeU32(at, elfStringHash(requirement.name));
    writeU16(at + 6, requirement.index);
    writeU32(at + 8, nameOffsets[index]!);
    writeU32(at + 12, index + 1 < requirements.length ? 16 : 0);
  });
};

const writeVersionDefinitionTable = (input: {
  readonly offset: number;
  readonly definitions: readonly string[];
  readonly nameOffsets: readonly number[];
  readonly truncated: boolean;
  readonly writeU16: (offset: number, value: number) => void;
  readonly writeU32: (offset: number, value: number) => void;
}): void => {
  const { offset, definitions, nameOffsets, truncated, writeU16, writeU32 } =
    input;
  definitions.forEach((_, index) => {
    const at = offset + index * 28;
    writeU16(at, 1);
    writeU16(at + 2, index === 0 ? 1 : 0);
    writeU16(at + 4, index + 1);
    writeU16(at + 6, 1);
    writeU32(at + 12, 20);
    writeU32(
      at + 16,
      truncated && index === 0 ? 0 : index + 1 === definitions.length ? 0 : 28,
    );
    writeU32(at + 20, nameOffsets[index]!);
  });
};

const writeElfSymbol = (input: {
  readonly bytes: Buffer;
  readonly symbol: ElfFixtureSymbol;
  readonly index: number;
  readonly at: number;
  readonly wide: boolean;
  readonly nameOffset: number;
  readonly writeU16: (offset: number, value: number) => void;
  readonly writeU32: (offset: number, value: number) => void;
  readonly writeWord: (offset: number, value: bigint) => void;
}): void => {
  const {
    bytes,
    symbol,
    index,
    at,
    wide,
    nameOffset,
    writeU16,
    writeU32,
    writeWord,
  } = input;
  const info = ((symbol.binding ?? 1) << 4) | (symbol.type ?? 2);
  const value = symbol.value ?? BigInt(0x1000 + index * 16);
  writeU32(at, nameOffset);
  if (wide) {
    bytes[at + 4] = info;
    bytes[at + 5] = symbol.visibility ?? 0;
    writeU16(at + 6, symbol.section ?? 1);
    writeWord(at + 8, value);
    writeWord(at + 16, symbol.size ?? 16n);
  } else {
    writeWord(at + 4, value);
    writeWord(at + 8, symbol.size ?? 16n);
    bytes[at + 12] = info;
    bytes[at + 13] = symbol.visibility ?? 0;
    writeU16(at + 14, symbol.section ?? 1);
  }
};

/**
 * Minimal ELF image with `.dynsym`, `.dynstr`, `.gnu.version`, definitions and
 * requirements, laid out in order.
 */
export const elfExportImage = (options: {
  readonly bits?: 32 | 64;
  readonly little?: boolean;
  readonly machine?: number;
  readonly symbols: readonly ElfFixtureSymbol[];
  readonly versionDefinitions?: readonly string[];
  readonly versionRequirements?: readonly ElfFixtureVersionRequirement[];
  /** End the definition chain before its declared record count. */
  readonly truncatedVersionDefinitions?: boolean;
  /** Declare a `.gnu.version` table that is one entry short. */
  readonly truncatedVersions?: boolean;
  /** Shorten the GNU version-requirement section by one byte. */
  readonly truncatedVersionRequirements?: boolean;
  /** Point `.gnu.version` past the end of the file. */
  readonly versionsOutsideFile?: boolean;
  /** Declare a zero-byte `.dynsym`, without its null entry. */
  readonly emptyDynamicSymbols?: boolean;
  readonly sectionHeaders?: boolean | "null-only";
  readonly dynamicSegment?: boolean;
  readonly dynamicSymbols?: boolean;
}): Buffer => {
  const bits = options.bits ?? 64;
  const little = options.little ?? true;
  const wide = bits === 64;
  const symbolWidth = wide ? 24 : 16;
  const sectionWidth = wide ? 64 : 40;
  const symbols = [null, ...options.symbols];
  const definitions = options.versionDefinitions ?? [];
  const requirements = options.versionRequirements ?? [];

  const dynstr: string[] = ["\0"];
  let dynstrBytes = 1;
  const strings = new Map<string, number>();
  const intern = (value: string): number => {
    const known = strings.get(value);
    if (known !== undefined) return known;
    const offset = dynstrBytes;
    strings.set(value, offset);
    dynstr.push(`${value}\0`);
    dynstrBytes += value.length + 1;
    return offset;
  };
  const definitionNames = definitions.map(intern);
  const requirementNames = requirements.map(({ name }) => intern(name));
  const requirementFile = requirements.length === 0 ? 0 : intern("libc.so.6");
  const symbolNames = symbols.map((symbol) =>
    symbol === null ? 0 : (symbol.nameOffset ?? intern(symbol.name)),
  );
  const shstrtab =
    "\0.dynsym\0.dynstr\0.gnu.version\0.gnu.version_d\0.gnu.version_r\0.shstrtab\0";
  let cursor = 0x100;
  const place = (size: number): number => {
    const offset = cursor;
    cursor = Math.ceil((cursor + size) / 16) * 16;
    return offset;
  };
  const dynsymAt = place(symbols.length * symbolWidth);
  const dynstrAt = place(dynstrBytes);
  const versymAt = place(symbols.length * 2);
  const verdefAt = place(definitions.length * 28);
  const verneedAt = place(
    requirements.length === 0 ? 0 : 16 + requirements.length * 16,
  );
  const shstrtabAt = place(shstrtab.length);
  const sectionAt = place(7 * sectionWidth);
  const bytes = Buffer.alloc(cursor);

  const u16 = (offset: number, value: number) =>
    little
      ? bytes.writeUInt16LE(value, offset)
      : bytes.writeUInt16BE(value, offset);
  const u32 = (offset: number, value: number) =>
    little
      ? bytes.writeUInt32LE(value, offset)
      : bytes.writeUInt32BE(value, offset);
  const word = (offset: number, value: bigint) => {
    if (!wide) u32(offset, Number(value));
    else if (little) bytes.writeBigUInt64LE(value, offset);
    else bytes.writeBigUInt64BE(value, offset);
  };
  bytes.set([0x7f, 0x45, 0x4c, 0x46, wide ? 2 : 1, little ? 1 : 2, 1]);
  u16(16, 3);
  u16(18, options.machine ?? (wide ? 62 : 40));
  u32(20, 1);
  u16(wide ? 52 : 40, wide ? 64 : 52);
  u16(wide ? 54 : 42, wide ? 56 : 32);
  u16(wide ? 58 : 46, sectionWidth);
  if (options.dynamicSegment === true)
    writeElfDynamicSegment(bytes, bits, little);
  if (options.sectionHeaders === false) return bytes;

  symbols.forEach((symbol, index) => {
    if (symbol !== null)
      writeElfSymbol({
        bytes,
        symbol,
        index,
        at: dynsymAt + index * symbolWidth,
        wide,
        nameOffset: symbolNames[index]!,
        writeU16: u16,
        writeU32: u32,
        writeWord: word,
      });
  });
  Buffer.from(dynstr.join(""), "latin1").copy(bytes, dynstrAt);
  symbols.forEach((symbol, index) =>
    u16(versymAt + index * 2, symbol?.version ?? (index === 0 ? 0 : 1)),
  );
  writeVersionDefinitionTable({
    offset: verdefAt,
    definitions,
    nameOffsets: definitionNames,
    truncated: options.truncatedVersionDefinitions === true,
    writeU16: u16,
    writeU32: u32,
  });
  writeVersionRequirementTable({
    offset: verneedAt,
    requirements,
    nameOffsets: requirementNames,
    fileOffset: requirementFile,
    writeU16: u16,
    writeU32: u32,
  });
  bytes.write(shstrtab, shstrtabAt, "latin1");
  const sections = elfSectionRows(options, {
    dynsymAt,
    dynsym: symbols.length * symbolWidth,
    symbolWidth,
    dynstrAt,
    dynstrBytes,
    versymAt,
    versym: symbols.length * 2,
    verdefAt,
    definitions: definitions.length,
    verneedAt,
    requirements: requirements.length,
    shstrtabAt,
    shstrtab: shstrtab.length,
    end: cursor,
  });
  sections.forEach(([name, type, offset, size, link, info, entsize], index) => {
    const at = sectionAt + index * sectionWidth;
    u32(at, name);
    u32(at + 4, type);
    word(at + (wide ? 24 : 16), BigInt(offset));
    word(at + (wide ? 32 : 20), BigInt(size));
    u32(at + (wide ? 40 : 24), link);
    u32(at + (wide ? 44 : 28), info);
    word(at + (wide ? 56 : 36), BigInt(entsize));
  });
  word(wide ? 40 : 32, BigInt(sectionAt));
  const nullOnly = options.sectionHeaders === "null-only";
  u16(wide ? 60 : 48, nullOnly ? 1 : sections.length);
  u16(wide ? 62 : 50, nullOnly ? 0 : sections.length - 1);
  return bytes;
};

/** Small source table whose headers replay one shared maximum-length auxiliary chain. */
export const elfAliasedVersionImage = (
  kind: "requirements" | "definitions",
  nameLength = 1,
): Buffer => {
  const name = "V".repeat(nameLength);
  const original = elfExportImage({
    symbols: [{ name: "versioned_export", version: 2 }],
    versionDefinitions: ["BASE", name],
  });
  const sectionAt = Number(original.readBigUInt64LE(40));
  const namesAt = Number(original.readBigUInt64LE(sectionAt + 2 * 64 + 24));
  const nameOffset =
    original.indexOf(Buffer.from(name + "\0"), namesAt) - namesAt;
  if (nameOffset < 0) throw new Error("Version fixture name not found");
  const headers = 10_000,
    auxiliaries = 65_535;
  const headerBytes = kind === "requirements" ? 16 : 20;
  const auxBytes = kind === "requirements" ? 16 : 8;
  const start = Math.ceil(original.length / 16) * 16;
  const tableBytes = headers * headerBytes + auxiliaries * auxBytes;
  const bytes = Buffer.alloc(start + tableBytes);
  original.copy(bytes);
  const section = sectionAt + (kind === "requirements" ? 5 : 4) * 64;
  bytes.writeBigUInt64LE(BigInt(start), section + 24);
  bytes.writeBigUInt64LE(BigInt(tableBytes), section + 32);
  bytes.writeUInt32LE(headers, section + 44);
  // The other version table is absent, so a refusal cannot recover through it.
  const other = sectionAt + (kind === "requirements" ? 4 : 5) * 64;
  bytes.writeUInt32LE(0, other + 4);
  for (let index = 0; index < headers; index++) {
    const at = start + index * headerBytes;
    bytes.writeUInt16LE(1, at);
    bytes.writeUInt16LE(auxiliaries, at + (kind === "requirements" ? 2 : 6));
    if (kind === "definitions") bytes.writeUInt16LE(2, at + 4);
    bytes.writeUInt32LE(
      headers * headerBytes - index * headerBytes,
      at + (kind === "requirements" ? 8 : 12),
    );
    bytes.writeUInt32LE(
      index + 1 < headers ? headerBytes : 0,
      at + (kind === "requirements" ? 12 : 16),
    );
  }
  for (let index = 0; index < auxiliaries; index++) {
    const at = start + headers * headerBytes + index * auxBytes;
    if (kind === "requirements") bytes.writeUInt16LE(2, at + 6);
    bytes.writeUInt32LE(nameOffset, at + (kind === "requirements" ? 8 : 0));
    bytes.writeUInt32LE(
      index + 1 < auxiliaries ? auxBytes : 0,
      at + (kind === "requirements" ? 12 : 4),
    );
  }
  return bytes;
};

type ElfSectionRow = readonly [
  name: number,
  type: number,
  offset: number,
  size: number,
  link: number,
  info: number,
  entsize: number,
];

/** Section header rows for the fixture layout, with the requested defects. */
const elfSectionRows = (
  options: Parameters<typeof elfExportImage>[0],
  layout: {
    readonly dynsymAt: number;
    readonly dynsym: number;
    readonly symbolWidth: number;
    readonly dynstrAt: number;
    readonly dynstrBytes: number;
    readonly versymAt: number;
    readonly versym: number;
    readonly verdefAt: number;
    readonly definitions: number;
    readonly verneedAt: number;
    readonly requirements: number;
    readonly shstrtabAt: number;
    readonly shstrtab: number;
    readonly end: number;
  },
): readonly ElfSectionRow[] => [
  [0, 0, 0, 0, 0, 0, 0],
  ...(options.dynamicSymbols === false
    ? []
    : ([
        [
          1,
          11,
          layout.dynsymAt,
          options.emptyDynamicSymbols === true ? 0 : layout.dynsym,
          2,
          1,
          layout.symbolWidth,
        ],
        [9, 3, layout.dynstrAt, layout.dynstrBytes, 0, 0, 0],
        [
          17,
          0x6fffffff,
          options.versionsOutsideFile === true
            ? layout.end + 64
            : layout.versymAt,
          layout.versym - (options.truncatedVersions === true ? 2 : 0),
          1,
          0,
          2,
        ],
        [
          30,
          0x6ffffffd,
          layout.verdefAt,
          layout.definitions * 28,
          2,
          layout.definitions,
          0,
        ],
        [
          45,
          0x6ffffffe,
          layout.verneedAt,
          (layout.requirements === 0 ? 0 : 16 + layout.requirements * 16) -
            (options.truncatedVersionRequirements === true ? 1 : 0),
          2,
          layout.requirements === 0 ? 0 : 1,
          0,
        ],
      ] satisfies ElfSectionRow[])),
  [60, 3, layout.shstrtabAt, layout.shstrtab, 0, 0, 0],
];

/** Two program headers: an empty load segment followed by a dynamic segment. */
const writeElfDynamicSegment = (
  bytes: Buffer,
  bits: 32 | 64,
  little: boolean,
): void => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const wide = bits === 64;
  const programAt = wide ? 64 : 52;
  if (wide) view.setBigUint64(32, BigInt(programAt), little);
  else view.setUint32(28, programAt, little);
  view.setUint16(wide ? 56 : 44, 2, little);
  view.setUint32(programAt, 1, little);
  view.setUint32(programAt + (wide ? 56 : 32), 2, little);
};
