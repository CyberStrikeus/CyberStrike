import { err, ok } from "../result.js";

/** ELF note padding follows binutils: only a declared alignment of 8 uses 8. */
export const elfNoteAlignment = (declared: number | bigint): number =>
  declared === 8 || declared === 8n ? 8 : 4;

/** Descriptor and next-note offsets relative to the note's 12-byte header. */
export const elfNoteLayout = (
  namesz: number,
  descsz: number,
  alignment: number,
) => {
  const descriptor = Math.ceil((12 + namesz) / alignment) * alignment;
  return {
    descriptor,
    next: Math.ceil((descriptor + descsz) / alignment) * alignment,
  };
};

/** Fixed ELF note words; padding, owner names and descriptor admission belong to consumers. */
export const readElfNoteHeader = (bytes: Uint8Array, littleEndian: boolean) => {
  if (bytes.byteLength < 12)
    return err({
      kind: "malformed" as const,
      message: "ELF note header is truncated",
    });
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return ok({
    namesz: view.getUint32(0, littleEndian),
    descsz: view.getUint32(4, littleEndian),
    type: view.getUint32(8, littleEndian),
  });
};
