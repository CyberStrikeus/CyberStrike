import { err, ok } from "./result.js";

/** Fixed ELF32/ELF64 symbol facts; consumers own definition, visibility and processor-flag policies. */
export const readElfSymbol = (
  bytes: Uint8Array,
  bits: 32 | 64,
  littleEndian: boolean,
) => {
  const wide = bits === 64;
  if (bytes.byteLength < (wide ? 24 : 16))
    return err({
      kind: "malformed" as const,
      message: "ELF symbol record is truncated",
    });
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const info = view.getUint8(wide ? 4 : 12);
  return ok({
    name_offset: view.getUint32(0, littleEndian),
    binding: info >>> 4,
    type: info & 15,
    other: view.getUint8(wide ? 5 : 13),
    section_index: view.getUint16(wide ? 6 : 14, littleEndian),
    value: wide
      ? view.getBigUint64(8, littleEndian)
      : BigInt(view.getUint32(4, littleEndian)),
    size: wide
      ? view.getBigUint64(16, littleEndian)
      : BigInt(view.getUint32(8, littleEndian)),
  });
};
