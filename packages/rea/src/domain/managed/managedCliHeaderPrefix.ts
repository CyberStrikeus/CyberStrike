import { err, ok } from "../result.js";

/** IMAGE_COR20_HEADER's first 16 bytes; consumers own directory/range admission. */
export const readManagedCliHeaderPrefix = (bytes: Buffer) => {
  if (bytes.length < 16)
    return err({
      kind: "malformed" as const,
      message: "CLI runtime header prefix is truncated",
    });
  return ok({
    headerSize: bytes.readUInt32LE(0),
    runtimeMajor: bytes.readUInt16LE(4),
    runtimeMinor: bytes.readUInt16LE(6),
    metadata: {
      rva: bytes.readUInt32LE(8),
      size: bytes.readUInt32LE(12),
    },
  });
};
