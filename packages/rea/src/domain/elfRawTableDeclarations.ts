import { err, ok } from "./result.js";

/** Fixed-header table words, before extended numbering or file-range admission. */
export const readElfRawTableDeclarations = (
  bytes: Uint8Array,
  format: { readonly elfClass: 32 | 64; readonly byteOrder: "little" | "big" },
) => {
  const wide = format.elfClass === 64;
  if (bytes.byteLength < (wide ? 64 : 52))
    return err({
      kind: "malformed" as const,
      message: "ELF table declarations are truncated",
    });
  const little = format.byteOrder === "little";
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const word = (offset: number): bigint =>
    wide
      ? view.getBigUint64(offset, little)
      : BigInt(view.getUint32(offset, little));
  return ok({
    programs: {
      offset: word(wide ? 32 : 28),
      width: view.getUint16(wide ? 54 : 42, little),
      count: view.getUint16(wide ? 56 : 44, little),
    },
    sections: {
      offset: word(wide ? 40 : 32),
      width: view.getUint16(wide ? 58 : 46, little),
      count: view.getUint16(wide ? 60 : 48, little),
      namesIndex: view.getUint16(wide ? 62 : 50, little),
    },
  });
};
