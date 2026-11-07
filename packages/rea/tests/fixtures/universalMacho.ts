/** One thin Mach-O slice and the CPU identity its header and FAT entry declare. */
export interface UniversalSlice {
  readonly bytes: Buffer;
  readonly cpuType: number;
  readonly cpuSubtype: number;
  /** Declare a different CPU in the FAT table than in the slice header. */
  readonly tableCpuType?: number;
}

/** The FAT32 container and where each slice landed. */
export interface UniversalMachoFixture {
  readonly bytes: Buffer;
  readonly slices: readonly {
    readonly offset: number;
    readonly size: number;
  }[];
  readonly tableBytes: number;
}

const ALIGNMENT_EXPONENT = 12;

/** Build a big-endian FAT32 universal Mach-O whose slices are 4 KiB aligned. */
export const universalMacho = (
  slices: readonly UniversalSlice[],
): UniversalMachoFixture => {
  const tableBytes = 8 + slices.length * 20;
  const align = 2 ** ALIGNMENT_EXPONENT;
  const placed: { offset: number; size: number }[] = [];
  let offset = Math.ceil(tableBytes / align) * align;
  for (const slice of slices) {
    placed.push({ offset, size: slice.bytes.length });
    offset = Math.ceil((offset + slice.bytes.length) / align) * align;
  }
  const bytes = Buffer.alloc(offset);
  bytes.writeUInt32BE(0xcafebabe, 0);
  bytes.writeUInt32BE(slices.length, 4);
  for (const [index, slice] of slices.entries()) {
    const { offset: sliceOffset, size } = placed[index]!;
    const entry = 8 + index * 20;
    bytes.writeUInt32BE(slice.tableCpuType ?? slice.cpuType, entry);
    bytes.writeUInt32BE(slice.cpuSubtype, entry + 4);
    bytes.writeUInt32BE(sliceOffset, entry + 8);
    bytes.writeUInt32BE(size, entry + 12);
    bytes.writeUInt32BE(ALIGNMENT_EXPONENT, entry + 16);
    const image = Buffer.from(slice.bytes);
    const little =
      image.readUInt32BE(0) === 0xcffaedfe ||
      image.readUInt32BE(0) === 0xcefaedfe;
    if (little) {
      image.writeUInt32LE(slice.cpuType, 4);
      image.writeUInt32LE(slice.cpuSubtype, 8);
    } else {
      image.writeUInt32BE(slice.cpuType, 4);
      image.writeUInt32BE(slice.cpuSubtype, 8);
    }
    image.copy(bytes, sliceOffset);
  }
  return { bytes, slices: placed, tableBytes };
};

export const CPU_X86_64 = 0x01000007;
export const CPU_ARM64 = 0x0100000c;
