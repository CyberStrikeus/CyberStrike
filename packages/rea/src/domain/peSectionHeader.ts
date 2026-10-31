import { err, ok } from "./result.js";

/** Fixed COFF section facts; callers own file/range and mapping admission. */
export const readPeSectionHeader = (bytes: Buffer) => {
  if (bytes.length < 40)
    return err({
      kind: "malformed" as const,
      message: "PE section header is truncated",
    });
  const name = bytes.subarray(0, 8);
  const nul = name.indexOf(0);
  const virtual_size = bytes.readUInt32LE(8);
  const raw_size = bytes.readUInt32LE(16);
  return ok({
    name: name.toString("latin1", 0, nul < 0 ? name.length : nul),
    virtual_size,
    virtual_address: bytes.readUInt32LE(12),
    raw_size,
    offset: bytes.readUInt32LE(20),
    characteristics: bytes.readUInt32LE(36),
    // Content excludes file-alignment padding; raw_size remains available to
    // consumers that validate physical file ranges.
    size: virtual_size === 0 ? raw_size : Math.min(virtual_size, raw_size),
  });
};
