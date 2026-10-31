import { err, ok } from "./result.js";

/** Fixed Elf32_Dyn/Elf64_Dyn: signed d_tag and unsigned d_un, without tag or value admission. */
export const readElfDynamicEntry = (
  bytes: Uint8Array,
  bits: 32 | 64,
  littleEndian: boolean,
) => {
  const wide = bits === 64;
  if (bytes.byteLength < (wide ? 16 : 8))
    return err({
      kind: "malformed" as const,
      message: "ELF dynamic entry is truncated",
    });
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return ok({
    tag: wide
      ? view.getBigInt64(0, littleEndian)
      : BigInt(view.getInt32(0, littleEndian)),
    value: wide
      ? view.getBigUint64(8, littleEndian)
      : BigInt(view.getUint32(4, littleEndian)),
  });
};
