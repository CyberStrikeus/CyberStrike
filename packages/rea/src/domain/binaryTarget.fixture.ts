/** Build a minimal ELF header for binary-target parser tests. */
export const elf = (
  class_: number,
  endian: number,
  machine: number,
): Buffer => {
  const bytes = Buffer.alloc(class_ === 1 ? 52 : 64);
  bytes.set([0x7f, 0x45, 0x4c, 0x46, class_, endian, 1]);
  if (endian === 1) {
    bytes.writeUInt16LE(machine, 18);
    bytes.writeUInt32LE(1, 20);
    bytes.writeUInt16LE(class_ === 1 ? 52 : 64, class_ === 1 ? 40 : 52);
  } else {
    bytes.writeUInt16BE(machine, 18);
    bytes.writeUInt32BE(1, 20);
    bytes.writeUInt16BE(class_ === 1 ? 52 : 64, class_ === 1 ? 40 : 52);
  }
  return bytes;
};

/** Build a minimal thin Mach-O header for binary-target parser tests. */
export const thinMach = (magic: number, cpu: number): Buffer => {
  const bytes = Buffer.alloc(
    magic === 0xfeedfacf || magic === 0xcffaedfe ? 32 : 28,
  );
  bytes.writeUInt32BE(magic, 0);
  if (magic === 0xcefaedfe || magic === 0xcffaedfe) bytes.writeUInt32LE(cpu, 4);
  else bytes.writeUInt32BE(cpu, 4);
  return bytes;
};

/** Build a FAT Mach-O with in-bounds thin slices, or an explicitly truncated table. */
export const fat = (
  cpus: readonly number[],
  declared = cpus.length,
): Buffer => {
  const tableSize = 8 + cpus.length * 20;
  const slices = cpus.map((cpu) => {
    const bytes = thinMach(0xfeedfacf, cpu);
    bytes.writeUInt32BE(2, 12);
    return bytes;
  });
  const sliceStart = Math.ceil(tableSize / 16) * 16;
  const bytes = Buffer.alloc(
    declared === cpus.length ? sliceStart + cpus.length * 32 : tableSize,
  );
  bytes.writeUInt32BE(0xcafebabe, 0);
  bytes.writeUInt32BE(declared, 4);
  cpus.forEach((cpu, index) => {
    const entry = 8 + index * 20;
    const offset = sliceStart + index * 32;
    bytes.writeUInt32BE(cpu, entry);
    bytes.writeUInt32BE(offset, entry + 8);
    bytes.writeUInt32BE(32, entry + 12);
    bytes.writeUInt32BE(4, entry + 16);
    if (declared === cpus.length) slices[index]?.copy(bytes, offset);
  });
  return bytes;
};

export interface PeCodeViewFixture {
  readonly type?: "RSDS" | "NB10";
  readonly guid?: string;
  readonly age?: number;
  readonly pdbPath?: string;
}

/** Build a bounded PE image with optional managed metadata or CodeView debug data. */
export const pe = (
  machine: number,
  offset = 64,
  characteristics = 0x0002,
  managed = false,
  codeView?: PeCodeViewFixture,
): Buffer => {
  const optionalHeaderSize =
    machine === 0x014c || machine === 0x01c0 ? 224 : 240;
  const sectionTableOffset = offset + 24 + optionalHeaderSize;
  const sectionCount = codeView !== undefined ? 1 : 0;
  const rawDataOffset = 512;

  let codeViewData: Buffer | undefined;
  if (codeView !== undefined) {
    const type = codeView.type ?? "RSDS";
    const pdbPath = codeView.pdbPath ?? "app.pdb";
    const age = codeView.age ?? 1;
    const pathBuf = Buffer.from(`${pdbPath}\0`, "utf8");
    if (type === "RSDS") {
      codeViewData = Buffer.alloc(24 + pathBuf.length);
      codeViewData.write("RSDS", 0, "ascii");
      const guid = codeView.guid ?? "01234567-89ab-cdef-0123-456789abcdef";
      const parts = guid.split("-");
      if (parts.length === 5) {
        codeViewData.writeUInt32LE(parseInt(parts[0]!, 16), 4);
        codeViewData.writeUInt16LE(parseInt(parts[1]!, 16), 8);
        codeViewData.writeUInt16LE(parseInt(parts[2]!, 16), 10);
        Buffer.from(parts[3]!, "hex").copy(codeViewData, 12);
        Buffer.from(parts[4]!, "hex").copy(codeViewData, 14);
      }
      codeViewData.writeUInt32LE(age, 20);
      pathBuf.copy(codeViewData, 24);
    } else {
      codeViewData = Buffer.alloc(16 + pathBuf.length);
      codeViewData.write("NB10", 0, "ascii");
      codeViewData.writeUInt32LE(0, 4);
      codeViewData.writeUInt32LE(0, 8);
      codeViewData.writeUInt32LE(age, 12);
      pathBuf.copy(codeViewData, 16);
    }
  }

  const minSize =
    codeViewData !== undefined
      ? rawDataOffset + 28 + codeViewData.length + 32
      : Math.max(512, offset + 24 + optionalHeaderSize);
  const bytes = Buffer.alloc(minSize);
  bytes.write("MZ", 0, "ascii");
  bytes.writeUInt32LE(offset, 0x3c);
  bytes.write("PE\0\0", offset, "binary");
  bytes.writeUInt16LE(machine, offset + 4);
  bytes.writeUInt16LE(sectionCount, offset + 6);
  bytes.writeUInt16LE(optionalHeaderSize, offset + 20);
  bytes.writeUInt16LE(characteristics, offset + 22);
  const optionalHeader = offset + 24;
  const pe32 = machine === 0x014c || machine === 0x01c0;
  bytes.writeUInt16LE(pe32 ? 0x10b : 0x20b, optionalHeader);
  const directoryOffset = pe32 ? 96 : 112;
  bytes.writeUInt32LE(16, optionalHeader + directoryOffset - 4);
  if (managed) {
    bytes.writeUInt32LE(0x2000, optionalHeader + directoryOffset + 14 * 8);
    bytes.writeUInt32LE(72, optionalHeader + directoryOffset + 14 * 8 + 4);
  }
  if (codeViewData !== undefined) {
    const debugDirRva = 0x1000;
    const debugDirSize = 28;
    bytes.writeUInt32LE(debugDirRva, optionalHeader + directoryOffset + 6 * 8);
    bytes.writeUInt32LE(
      debugDirSize,
      optionalHeader + directoryOffset + 6 * 8 + 4,
    );

    bytes.write(".rdata\0\0", sectionTableOffset, "ascii");
    bytes.writeUInt32LE(0x1000, sectionTableOffset + 8);
    bytes.writeUInt32LE(0x1000, sectionTableOffset + 12);
    bytes.writeUInt32LE(512, sectionTableOffset + 16);
    bytes.writeUInt32LE(rawDataOffset, sectionTableOffset + 20);
    bytes.writeUInt32LE(0x40000040, sectionTableOffset + 36);

    bytes.writeUInt32LE(2, rawDataOffset + 12);
    bytes.writeUInt32LE(codeViewData.length, rawDataOffset + 16);
    bytes.writeUInt32LE(debugDirRva + 28, rawDataOffset + 20);
    bytes.writeUInt32LE(rawDataOffset + 28, rawDataOffset + 24);

    codeViewData.copy(bytes, rawDataOffset + 28);
  }
  return bytes;
};

/** Build a DOS MZ image with a 32-byte header and a 16-bit entry point. */
export const dosMz = (moduleSize = 128): Buffer => {
  const size = 32 + moduleSize;
  const bytes = Buffer.alloc(size);
  bytes.write("MZ", 0, "ascii");
  bytes.writeUInt16LE(size % 512, 2);
  bytes.writeUInt16LE(Math.ceil(size / 512), 4);
  bytes.writeUInt16LE(2, 8);
  bytes.writeUInt16LE(0xffff, 12);
  bytes.writeUInt16LE(28, 24);
  bytes.set([0xb8, 0x00, 0x4c, 0xcd, 0x21], 32);
  // This is module data, not an e_lfanew field in a Windows DOS stub.
  if (size >= 64) bytes.writeUInt32LE(0xfedcba98, 60);
  return bytes;
};
