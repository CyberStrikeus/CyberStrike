/** A dyld byte name projected losslessly as UTF-8, or retained exactly. */
export type MachoName = string | { readonly bytes_base64: string };

/** NUL terminators and source bounds are validated by the owning format reader. */
export const decodeMachoName = (bytes: Buffer): MachoName => {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      bytes,
    );
  } catch {
    return { bytes_base64: bytes.toString("base64") };
  }
};

/** Fixed-width Mach-O names end at the first NUL; retain every preceding byte. */
export const decodeMachoFixedName = (bytes: Buffer): string => {
  const nul = bytes.indexOf(0);
  // Latin-1 preserves high bits instead of fabricating ASCII metadata names.
  return bytes.subarray(0, nul < 0 ? bytes.length : nul).toString("latin1");
};
