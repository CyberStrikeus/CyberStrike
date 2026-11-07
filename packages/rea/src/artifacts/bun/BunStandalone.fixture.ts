import {
  BUN_OFFSETS_BYTES,
  BUN_RECORD_BYTES_1_3_3,
  BUN_RECORD_BYTES_1_3_9,
  BUN_TRAILER,
  type BunLayoutRevision,
  type BunStringPointer,
} from "./BunModuleGraphLayout.js";

export interface BunFixtureModule {
  readonly name?: string | Buffer;
  readonly contents?: Buffer;
  readonly sourcemap?: Buffer;
  readonly bytecode?: Buffer;
  readonly moduleInfo?: Buffer;
  readonly bytecodeOrigin?: string | Buffer;
  readonly encoding?: number;
  readonly loader?: number;
  readonly moduleFormat?: number;
  readonly side?: number;
  readonly contentsPointer?: BunStringPointer;
}

/** Build the graph payload: data, Offsets, and the Bun trailer. No length prefix. */
export const bunModuleGraphPayload = (input: {
  readonly revision?: BunLayoutRevision;
  readonly modules?: readonly BunFixtureModule[];
  readonly entryPointId?: number;
  readonly flags?: number;
  readonly compileExecArgv?: string | Buffer;
  readonly tableLength?: number;
}): Buffer => {
  const revision = input.revision ?? "bun-1.3.9";
  const recordBytes =
    revision === "bun-1.3.3" ? BUN_RECORD_BYTES_1_3_3 : BUN_RECORD_BYTES_1_3_9;
  const modules = input.modules ?? [];
  const chunks: Buffer[] = [];
  let cursor = 0;
  const place = (bytes: Buffer, nul: boolean): BunStringPointer => {
    const offset = cursor;
    if (bytes.length > 0) {
      chunks.push(bytes);
      cursor += bytes.length;
      if (nul) {
        chunks.push(Buffer.from([0]));
        cursor += 1;
      }
    }
    return { offset, length: bytes.length };
  };
  const placed = modules.map((module) => ({
    module,
    name: place(asBuffer(module.name ?? ""), true),
    contents: place(module.contents ?? Buffer.alloc(0), true),
    sourcemap: place(module.sourcemap ?? Buffer.alloc(0), false),
    bytecode: place(module.bytecode ?? Buffer.alloc(0), false),
    moduleInfo: place(module.moduleInfo ?? Buffer.alloc(0), false),
    origin: place(asBuffer(module.bytecodeOrigin ?? ""), true),
  }));
  const argv = place(asBuffer(input.compileExecArgv ?? ""), true);
  const tableOffset = cursor;
  const tableLength = input.tableLength ?? modules.length * recordBytes;
  const records = Buffer.alloc(
    Math.max(tableLength, modules.length * recordBytes),
  );
  for (const [index, row] of placed.entries()) {
    const record = records.subarray(
      index * recordBytes,
      (index + 1) * recordBytes,
    );
    const contents = row.module.contentsPointer ?? row.contents;
    writePointer(record, 0, row.name);
    writePointer(record, 8, contents);
    writePointer(record, 16, row.sourcemap);
    writePointer(record, 24, row.bytecode);
    const metadataAt = recordBytes === BUN_RECORD_BYTES_1_3_9 ? 48 : 32;
    if (recordBytes === BUN_RECORD_BYTES_1_3_9) {
      writePointer(record, 32, row.moduleInfo);
      writePointer(record, 40, row.origin);
    }
    record[metadataAt] = row.module.encoding ?? 0;
    record[metadataAt + 1] = row.module.loader ?? 1;
    record[metadataAt + 2] = row.module.moduleFormat ?? 1;
    record[metadataAt + 3] = row.module.side ?? 0;
  }
  chunks.push(records.subarray(0, tableLength));
  cursor += tableLength;
  const data = Buffer.concat(chunks);
  const offsets = Buffer.alloc(BUN_OFFSETS_BYTES);
  offsets.writeBigUInt64LE(BigInt(data.length), 0);
  writePointer(offsets, 8, { offset: tableOffset, length: tableLength });
  offsets.writeUInt32LE(input.entryPointId ?? 0, 16);
  writePointer(offsets, 20, argv);
  offsets.writeUInt32LE(input.flags ?? 0, 28);
  return Buffer.concat([data, offsets, BUN_TRAILER]);
};

/** Length prefix used by current Mach-O, PE, and ELF section writers. */
export const bunPrefixedPayload = (payload: Buffer): Buffer => {
  const prefix = Buffer.alloc(8);
  prefix.writeBigUInt64LE(BigInt(payload.length), 0);
  return Buffer.concat([prefix, payload]);
};

export const machoBunSection = (section: Buffer): Buffer => {
  const headerBytes = 32;
  const commandBytes = 72 + 80;
  const contentOffset = headerBytes + commandBytes;
  const bytes = Buffer.alloc(contentOffset + section.length);
  bytes.writeUInt32LE(0xfeedfacf, 0);
  bytes.writeUInt32LE(0x0100000c, 4);
  bytes.writeUInt32LE(2, 12);
  bytes.writeUInt32LE(1, 16);
  bytes.writeUInt32LE(commandBytes, 20);
  bytes.writeUInt32LE(0x19, 32);
  bytes.writeUInt32LE(commandBytes, 36);
  bytes.write("__BUN", 40, "utf8");
  bytes.writeBigUInt64LE(BigInt(section.length), 64);
  bytes.writeBigUInt64LE(BigInt(contentOffset), 72);
  bytes.writeBigUInt64LE(BigInt(section.length), 80);
  bytes.writeUInt32LE(1, 96);
  bytes.write("__bun", 104, "utf8");
  bytes.write("__BUN", 120, "utf8");
  bytes.writeBigUInt64LE(BigInt(section.length), 144);
  bytes.writeUInt32LE(contentOffset, 152);
  section.copy(bytes, contentOffset);
  return bytes;
};

/** Two real `__bun` sections. Inventory must not guess which graph to read. */
export const machoBunSections = (sections: readonly Buffer[]): Buffer => {
  const headerBytes = 32;
  const sectionCount = sections.length;
  const commandBytes = 72 + 80 * sectionCount;
  let contentOffset = headerBytes + commandBytes;
  const contents: Buffer[] = [];
  const offsets: number[] = [];
  for (const section of sections) {
    offsets.push(contentOffset);
    contents.push(section);
    contentOffset += section.length;
  }
  const bytes = Buffer.alloc(contentOffset);
  bytes.writeUInt32LE(0xfeedfacf, 0);
  bytes.writeUInt32LE(0x0100000c, 4);
  bytes.writeUInt32LE(2, 12);
  bytes.writeUInt32LE(1, 16);
  bytes.writeUInt32LE(commandBytes, 20);
  bytes.writeUInt32LE(0x19, 32);
  bytes.writeUInt32LE(commandBytes, 36);
  bytes.write("__BUN", 40, "utf8");
  bytes.writeUInt32LE(sectionCount, 96);
  sections.forEach((section, index) => {
    const sectionHeader = 32 + 72 + index * 80;
    const offset = offsets[index] ?? 0;
    bytes.write("__bun", sectionHeader, "utf8");
    bytes.write("__BUN", sectionHeader + 16, "utf8");
    bytes.writeBigUInt64LE(BigInt(section.length), sectionHeader + 40);
    bytes.writeUInt32LE(offset, sectionHeader + 48);
    section.copy(bytes, offset);
  });
  return bytes;
};

export const peBunSection = (section: Buffer): Buffer => {
  const eLfanew = 64;
  const optionalHeaderSize = 240;
  const sectionTable = eLfanew + 24 + optionalHeaderSize;
  const rawPointer = 512;
  const rawSize = Math.max(512, Math.ceil(section.length / 512) * 512);
  const bytes = Buffer.alloc(rawPointer + rawSize);
  bytes.write("MZ", 0, "ascii");
  bytes.writeUInt32LE(eLfanew, 0x3c);
  bytes.write("PE\0\0", eLfanew, "binary");
  bytes.writeUInt16LE(0x8664, eLfanew + 4);
  bytes.writeUInt16LE(1, eLfanew + 6);
  bytes.writeUInt16LE(optionalHeaderSize, eLfanew + 20);
  bytes.writeUInt16LE(0x20b, eLfanew + 24);
  bytes.write(".bun", sectionTable, "utf8");
  bytes.writeUInt32LE(section.length, sectionTable + 8);
  bytes.writeUInt32LE(rawSize, sectionTable + 16);
  bytes.writeUInt32LE(rawPointer, sectionTable + 20);
  section.copy(bytes, rawPointer);
  return bytes;
};

export const elfPrefix = (): Buffer => {
  const bytes = Buffer.alloc(64);
  bytes.writeUInt32LE(0x464c457f, 0);
  bytes[4] = 2;
  bytes[5] = 1;
  bytes[6] = 1;
  bytes.writeUInt16LE(2, 16);
  bytes.writeUInt16LE(0x3e, 18);
  bytes.writeUInt32LE(1, 20);
  bytes.writeUInt16LE(64, 52);
  return bytes;
};

/** ELF64 with e_shoff 0 so only an exact EOF trailer can carry the graph. */
export const elfAppendedBunPayload = (payload: Buffer): Buffer =>
  Buffer.concat([elfPrefix(), payload]);

/** ELF64 whose `.bun` section holds the length-prefixed graph. */
export const elfBunSection = (section: Buffer): Buffer => {
  const shstr = Buffer.from("\0.shstrtab\0.bun\0");
  const shstrOffset = 64;
  const sectionOffset = shstrOffset + shstr.length;
  const tableOffset = sectionOffset + section.length;
  const bytes = Buffer.alloc(tableOffset + 64 * 3);
  elfPrefix().copy(bytes, 0);
  bytes.writeBigUInt64LE(BigInt(tableOffset), 40);
  bytes.writeUInt16LE(64, 52);
  bytes.writeUInt16LE(64, 58);
  bytes.writeUInt16LE(3, 60);
  bytes.writeUInt16LE(1, 62);
  shstr.copy(bytes, shstrOffset);
  section.copy(bytes, sectionOffset);
  writeElfSection(bytes, tableOffset + 64, 1, shstrOffset, shstr.length);
  writeElfSection(bytes, tableOffset + 128, 11, sectionOffset, section.length);
  return bytes;
};

const writeElfSection = (
  bytes: Buffer,
  header: number,
  name: number,
  offset: number,
  size: number,
): void => {
  bytes.writeUInt32LE(name, header);
  bytes.writeBigUInt64LE(BigInt(offset), header + 24);
  bytes.writeBigUInt64LE(BigInt(size), header + 32);
};

const writePointer = (
  bytes: Buffer,
  offset: number,
  pointer: BunStringPointer,
): void => {
  bytes.writeUInt32LE(pointer.offset, offset);
  bytes.writeUInt32LE(pointer.length, offset + 4);
};

const asBuffer = (value: string | Buffer): Buffer =>
  typeof value === "string" ? Buffer.from(value) : value;
