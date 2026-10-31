import { err, ok, type Result } from "../result.js";

export interface MachoSectionHeader {
  readonly nameBytes: Buffer;
  readonly segmentNameBytes: Buffer;
  readonly address: bigint;
  readonly size: bigint;
  readonly offset: number;
  readonly flags: number;
}

/** Fixed section/section_64 facts; mapping, zero-fill and display policies belong to callers. */
export const readMachoSectionHeader = (
  bytes: Uint8Array,
  wide: boolean,
  littleEndian: boolean,
): Result<
  MachoSectionHeader,
  { readonly kind: "malformed"; readonly message: string }
> => {
  if (bytes.byteLength < (wide ? 80 : 68))
    return err({
      kind: "malformed",
      message: "Mach-O section header is truncated",
    });
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return ok({
    nameBytes: Buffer.from(bytes.subarray(0, 16)),
    segmentNameBytes: Buffer.from(bytes.subarray(16, 32)),
    address: wide
      ? view.getBigUint64(32, littleEndian)
      : BigInt(view.getUint32(32, littleEndian)),
    size: wide
      ? view.getBigUint64(40, littleEndian)
      : BigInt(view.getUint32(36, littleEndian)),
    offset: view.getUint32(wide ? 48 : 40, littleEndian),
    flags: view.getUint32(wide ? 64 : 56, littleEndian),
  });
};
