const SECTION_RVA = 0x1000;
const SECTION_OFFSET = 0x400;
const SECTION_BYTES = 0x800;
const HEADER_BYTES = 0x400;
const SPLIT_GAP_BYTES = 0x200;

/** File offset of an RVA in an unsplit fixture image. */
export const peImportFixtureOffset = (rva: number): number =>
  rva - SECTION_RVA + SECTION_OFFSET;

export type PeImportFixtureFunction =
  | { readonly name: string; readonly hint?: number }
  | { readonly ordinal: number };

export interface PeImportFixtureDll {
  readonly name: string;
  readonly functions: readonly PeImportFixtureFunction[];
}

/**
 * Minimal PE32/PE32+ image whose `.idata` section holds IMAGE_IMPORT_DESCRIPTOR
 * and optional IMAGE_DELAYLOAD_DESCRIPTOR tables at RVA 0x1000.
 *
 * `splitAt` keeps the RVA layout but moves section bytes from that section
 * offset onward into a second section at a later, discontiguous file offset,
 * filling the vacated file bytes with 0xcc.
 */
export const peImportImage = (
  options: {
    readonly bits?: 32 | 64;
    readonly dlls?: readonly PeImportFixtureDll[];
    readonly delayDlls?: readonly PeImportFixtureDll[];
    readonly delayAttributes?: number;
    readonly importDirectory?: boolean;
    readonly delayDirectory?: boolean;
    readonly sectionBytes?: number;
    readonly splitAt?: number;
  } = {},
): Buffer => {
  const sectionBytes = options.sectionBytes ?? SECTION_BYTES;
  const bits = options.bits ?? 64;
  const dlls = options.dlls ?? [
    {
      name: "KERNEL32.dll",
      functions: [
        { name: "GetProcAddress", hint: 1 },
        { name: "ExitProcess", hint: 2 },
      ],
    },
  ];
  const delayDlls = options.delayDlls ?? [];
  const bytes = Buffer.alloc(SECTION_OFFSET + sectionBytes);
  const wide = bits === 64;
  const thunkSize = wide ? 8 : 4;
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
  bytes.write(".idata", section, "ascii");
  bytes.writeUInt32LE(sectionBytes, section + 8);
  bytes.writeUInt32LE(SECTION_RVA, section + 12);
  bytes.writeUInt32LE(sectionBytes, section + 16);
  bytes.writeUInt32LE(SECTION_OFFSET, section + 20);
  bytes.writeUInt32LE(0x40000040, section + 36);

  const at = (rva: number) => rva - SECTION_RVA + SECTION_OFFSET;
  const writeThunk = (rva: number, value: bigint): void => {
    if (wide) bytes.writeBigUInt64LE(value, at(rva));
    else bytes.writeUInt32LE(Number(value), at(rva));
  };
  let cursor = SECTION_RVA;
  const place = (size: number): number => {
    const rva = cursor;
    cursor += size;
    return rva;
  };

  const importCount = options.importDirectory === false ? 0 : dlls.length;
  const delayCount =
    options.delayDirectory === false || delayDlls.length === 0
      ? 0
      : delayDlls.length;
  const importTable = importCount === 0 ? 0 : place((importCount + 1) * 20);
  const delayTable = delayCount === 0 ? 0 : place((delayCount + 1) * 32);

  if (options.importDirectory !== false) {
    bytes.writeUInt32LE(importTable, optional + directoriesAt + 8);
    bytes.writeUInt32LE((importCount + 1) * 20, optional + directoriesAt + 12);
  }
  if (delayCount > 0) {
    bytes.writeUInt32LE(delayTable, optional + directoriesAt + 13 * 8);
    bytes.writeUInt32LE(
      (delayCount + 1) * 32,
      optional + directoriesAt + 13 * 8 + 4,
    );
  }

  const writeFunctions = (
    functions: readonly PeImportFixtureFunction[],
  ): { readonly ilt: number; readonly iat: number } => {
    const ilt = place((functions.length + 1) * thunkSize);
    const iat = place((functions.length + 1) * thunkSize);
    functions.forEach((entry, index) => {
      let thunk: bigint;
      if ("ordinal" in entry) {
        thunk =
          (wide ? 0x8000000000000000n : 0x80000000n) | BigInt(entry.ordinal);
      } else {
        const hintName = place(2 + entry.name.length + 1);
        bytes.writeUInt16LE(entry.hint ?? 0, at(hintName));
        bytes.write(`${entry.name}\0`, at(hintName) + 2, "latin1");
        thunk = BigInt(hintName);
      }
      writeThunk(ilt + index * thunkSize, thunk);
      writeThunk(iat + index * thunkSize, thunk);
    });
    return { ilt, iat };
  };

  dlls.slice(0, importCount).forEach((dll, index) => {
    const { ilt, iat } = writeFunctions(dll.functions);
    const nameRva = place(dll.name.length + 1);
    bytes.write(`${dll.name}\0`, at(nameRva), "latin1");
    const descriptor = at(importTable + index * 20);
    bytes.writeUInt32LE(ilt, descriptor);
    bytes.writeUInt32LE(nameRva, descriptor + 12);
    bytes.writeUInt32LE(iat, descriptor + 16);
  });

  delayDlls.slice(0, delayCount).forEach((dll, index) => {
    const { ilt, iat } = writeFunctions(dll.functions);
    const nameRva = place(dll.name.length + 1);
    bytes.write(`${dll.name}\0`, at(nameRva), "latin1");
    const descriptor = at(delayTable + index * 32);
    bytes.writeUInt32LE(options.delayAttributes ?? 1, descriptor);
    bytes.writeUInt32LE(nameRva, descriptor + 4);
    bytes.writeUInt32LE(iat, descriptor + 12);
    bytes.writeUInt32LE(ilt, descriptor + 16);
  });

  if (options.splitAt === undefined) return bytes;
  const head = options.splitAt;
  const tail = sectionBytes - head;
  const moved = SECTION_OFFSET + sectionBytes + SPLIT_GAP_BYTES;
  const split = Buffer.alloc(moved + tail);
  bytes.copy(split, 0, 0, SECTION_OFFSET + head);
  split.fill(0xcc, SECTION_OFFSET + head, moved);
  bytes.copy(split, moved, SECTION_OFFSET + head);
  split.writeUInt16LE(2, 134);
  split.writeUInt32LE(head, section + 8);
  split.writeUInt32LE(head, section + 16);
  const second = section + 40;
  split.write(".idata2", second, "ascii");
  split.writeUInt32LE(tail, second + 8);
  split.writeUInt32LE(SECTION_RVA + head, second + 12);
  split.writeUInt32LE(tail, second + 16);
  split.writeUInt32LE(moved, second + 20);
  split.writeUInt32LE(0x40000040, second + 36);
  return split;
};

/** PE image whose optional header admits no import data directory. */
export const peWithoutImportTableFixture = (bits: 32 | 64 = 64): Buffer =>
  peImportImage({ bits, importDirectory: false, delayDlls: [] });

/** Add a file-backed PE32+ range while preserving the ordinary low-RVA payload. */
const withHighImportRange = (
  source: Buffer,
  rva: number,
  data: Buffer,
): Buffer => {
  const offset = 0x1000;
  const bytes = Buffer.alloc(offset + data.length);
  source.copy(bytes);
  data.copy(bytes, offset);
  bytes.writeUInt16LE(2, 134);
  const section = 152 + 240 + 40;
  bytes.write(".high", section, "ascii");
  bytes.writeUInt32LE(data.length, section + 8);
  bytes.writeUInt32LE(rva, section + 12);
  bytes.writeUInt32LE(data.length, section + 16);
  bytes.writeUInt32LE(offset, section + 20);
  bytes.writeUInt32LE(0x40000040, section + 36);
  return bytes;
};

/** Directory descriptor/terminator whose mapped range crosses the uint32 RVA end. */
export const peImportDirectoryAtRva = (
  kind: "standard" | "delay",
  rva: number,
): Buffer => {
  const source = peImportImage({
    delayDlls:
      kind === "delay"
        ? [{ name: "ADVAPI32.dll", functions: [{ name: "RegOpenKeyExW" }] }]
        : [],
  });
  const width = kind === "standard" ? 20 : 32;
  const directory = 152 + 112 + (kind === "standard" ? 1 : 13) * 8;
  const oldOffset = peImportFixtureOffset(source.readUInt32LE(directory));
  const bytes = withHighImportRange(
    source,
    rva,
    source.subarray(oldOffset, oldOffset + 2 * width),
  );
  bytes.writeUInt32LE(rva, directory);
  return bytes;
};

/** A directory starts in a gap, or its first descriptor is followed by a gap. */
export const peImportDirectoryMappingStops = (
  kind: "standard" | "delay",
  retained: 0 | 1,
): Buffer => {
  const bytes = peImportDirectoryAtRva(kind, 0x40000000);
  const section = 152 + 240 + 40;
  const size = retained * (kind === "standard" ? 20 : 32);
  bytes.writeUInt32LE(size, section + 8);
  bytes.writeUInt32LE(size, section + 16);
  return bytes;
};

/** A DLL name whose NUL lies outside the uint32 RVA space. */
export const peImportNameAtRva = (rva: number): Buffer => {
  const bytes = withHighImportRange(
    peImportImage(),
    rva,
    Buffer.from("KERNEL32.dll\0", "latin1"),
  );
  bytes.writeUInt32LE(rva, peImportFixtureOffset(0x1000) + 12);
  return bytes;
};

/** Later import section behind an empty or suspicious first section header. */
export const peImportLeadingSectionImage = (suspicious: boolean): Buffer => {
  const bytes = peImportImage();
  const section = 152 + 240;
  bytes.copy(bytes, section + 40, section, section + 40);
  bytes.fill(0, section, section + 40);
  bytes.writeUInt16LE(2, 134);
  if (suspicious) {
    bytes.writeUInt32LE(0x20000000, section + 8);
    bytes.writeUInt32LE(0x20000000, section + 12);
    bytes.writeUInt32LE(0xfffffe00, section + 20);
  }
  return bytes;
};

/** Independent PE32+ mappings with imports in the last section, for capacity checks. */
export const peImportManySectionsImage = (
  sectionCount: number,
  functionCount: number,
): Buffer => {
  const rawSize = 0x20000;
  const original = peImportImage({
    sectionBytes: rawSize,
    dlls: [
      {
        name: "KERNEL32.dll",
        functions: Array.from({ length: functionCount }, (_, i) => ({
          name: `Function${String(i).padStart(4, "0")}`,
        })),
      },
    ],
  });
  const optional = 152;
  const sectionStart = optional + 240;
  const headerBytes = Math.ceil((sectionStart + sectionCount * 40) / 512) * 512;
  const finalRaw = headerBytes + (sectionCount - 1) * 512;
  const firstRva = Math.ceil(headerBytes / 0x1000) * 0x1000;
  const finalRva = firstRva + (sectionCount - 1) * 0x1000;
  const delta = finalRva - SECTION_RVA;
  const bytes = Buffer.alloc(finalRaw + rawSize);
  original.copy(bytes, 0, 0, sectionStart);
  bytes.writeUInt16LE(sectionCount, 134);
  bytes.writeUInt32LE(0x1000, optional + 32);
  bytes.writeUInt32LE(512, optional + 36);
  bytes.writeUInt32LE(headerBytes, optional + 60);
  bytes.writeUInt32LE(finalRva, optional + 112 + 8);
  bytes.writeUInt32LE(finalRva + rawSize, optional + 56);
  for (let i = 0; i < sectionCount; i++) {
    const at = sectionStart + i * 40;
    const size = i === sectionCount - 1 ? rawSize : 512;
    bytes.write(i === sectionCount - 1 ? ".idata" : ".dummy", at, "ascii");
    bytes.writeUInt32LE(size, at + 8);
    bytes.writeUInt32LE(firstRva + i * 0x1000, at + 12);
    bytes.writeUInt32LE(size, at + 16);
    bytes.writeUInt32LE(headerBytes + i * 512, at + 20);
    bytes.writeUInt32LE(0x40000040, at + 36);
  }
  const data = Buffer.from(original.subarray(SECTION_OFFSET));
  const ilt = data.readUInt32LE(0);
  const iat = data.readUInt32LE(16);
  for (const field of [0, 12, 16])
    data.writeUInt32LE(data.readUInt32LE(field) + delta, field);
  for (const table of [ilt, iat])
    for (let i = 0; i < functionCount; i++) {
      const at = table - SECTION_RVA + i * 8;
      data.writeBigUInt64LE(data.readBigUInt64LE(at) + BigInt(delta), at);
    }
  data.copy(bytes, finalRaw);
  return bytes;
};
