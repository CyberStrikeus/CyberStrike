import { err, ok } from "./result.js";

/** Fixed 20-byte COFF record, excluding the PE signature; callers own admission. */
export const readPeCoffHeader = (bytes: Buffer) => {
  if (bytes.length < 20)
    return err({
      kind: "malformed" as const,
      message: "PE COFF header is truncated",
    });
  return ok({
    machine: bytes.readUInt16LE(0),
    sectionCount: bytes.readUInt16LE(2),
    optionalHeaderSize: bytes.readUInt16LE(16),
    characteristics: bytes.readUInt16LE(18),
  });
};
