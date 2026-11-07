export interface BinaryPlistObjectTableLayout {
  readonly offsetWidth: number;
  readonly objectCount: number;
  readonly tableOffset: number;
}

/** Read the trailer fields that locate a binary plist's object offset table. */
export const readBinaryPlistObjectTableLayout = (
  bytes: Buffer,
): BinaryPlistObjectTableLayout => {
  const trailer = bytes.length - 32;
  return {
    offsetWidth: bytes[trailer + 6] ?? 0,
    objectCount: Number(bytes.readBigUInt64BE(trailer + 8)),
    tableOffset: Number(bytes.readBigUInt64BE(trailer + 24)),
  };
};

/** Decode one object's offset-table entry using the table's declared width. */
export const readBinaryPlistObjectOffset = (
  bytes: Buffer,
  table: BinaryPlistObjectTableLayout,
  objectId: number,
): number => {
  const entry = table.tableOffset + objectId * table.offsetWidth;
  let offset = 0;
  for (let byte = 0; byte < table.offsetWidth; byte += 1)
    offset = offset * 256 + (bytes[entry + byte] ?? 0);
  return offset;
};

/** Repoint one object while preserving the table's declared offset width. */
export const writeBinaryPlistObjectOffset = (
  bytes: Buffer,
  table: BinaryPlistObjectTableLayout,
  objectId: number,
  offset: number,
): void => {
  const entry = table.tableOffset + objectId * table.offsetWidth;
  let remaining = offset;
  for (let byte = table.offsetWidth - 1; byte >= 0; byte -= 1) {
    bytes[entry + byte] = remaining & 0xff;
    remaining = Math.floor(remaining / 256);
  }
  if (remaining !== 0) throw new Error("fixture offset width is insufficient");
};

/** Finish a small hand-authored binary plist with one-byte object offsets. */
export const binaryPlistObjectTable = (
  bytes: Buffer,
  objectOffsets: readonly number[],
  tableOffset: number,
): Buffer => {
  Buffer.from("bplist00", "ascii").copy(bytes);
  bytes.set(objectOffsets, tableOffset);
  const trailer = bytes.length - 32;
  bytes[trailer + 6] = 1;
  bytes[trailer + 7] = 1;
  bytes.writeBigUInt64BE(BigInt(objectOffsets.length), trailer + 8);
  bytes.writeBigUInt64BE(0n, trailer + 16);
  bytes.writeBigUInt64BE(BigInt(tableOffset), trailer + 24);
  return bytes;
};

/** Date and empty-data objects deliberately share bytes in a valid offset table. */
export const binaryPlistWithOverlappingDateAndData = (): Buffer => {
  const bytes = Buffer.alloc(55);
  bytes.set([0xa2, 1, 2, 0x33], 8);
  bytes.writeDoubleBE(0.0005, 12);
  bytes[13] = 0x40;
  return binaryPlistObjectTable(bytes, [8, 11, 13], 20);
};
