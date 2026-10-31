import type { PositionalRead } from "../zipPackageFormat.js";

const UDIF_TRAILER_BYTES = 512;
const UDIF_TRAILER_SIGNATURE = Buffer.from("koly");
const GPT_HEADER_SIGNATURE = Buffer.from("EFI PART");
const GPT_REVISION_1_0 = 0x0001_0000;
const HFS_PLUS_HEADER_END = 1028;
/** Leading bytes covering every raw layout signature below. */
const RAW_SIGNATURE_PREFIX_BYTES = HFS_PLUS_HEADER_END;

/**
 * Recognize Apple disk images by structure, not by name or mountability.
 *
 * UDIF images carry a `koly` trailer. Raw images (UDRW, UDTO and other
 * `CRawDiskImage` formats) are plain device bytes, so they are recognized by
 * the partition map or the HFS+ volume header that `hdiutil` writes. This
 * establishes neither integrity nor that the image will mount. `read` must
 * fill each range; a short result means end of file.
 */
export const hasDiskImageSignature = async (
  size: number,
  read: PositionalRead,
): Promise<boolean> => {
  if (!Number.isSafeInteger(size) || size <= 0) return false;
  if (size >= UDIF_TRAILER_BYTES) {
    const trailer = await read(
      size - UDIF_TRAILER_BYTES,
      UDIF_TRAILER_SIGNATURE.length,
    );
    if (Buffer.from(trailer).equals(UDIF_TRAILER_SIGNATURE)) return true;
  }
  // Read the exact window here so every caller observes the same bytes.
  return hasRawDiskImageSignature(
    Buffer.from(await read(0, Math.min(size, RAW_SIGNATURE_PREFIX_BYTES))),
  );
};

const hasRawDiskImageSignature = (prefix: Buffer): boolean =>
  hasGptHeader(prefix) ||
  hasApplePartitionMap(prefix) ||
  hasMbrPartitionTable(prefix) ||
  hasHfsPlusVolumeHeader(prefix);

/** GUID partition table header at LBA 1 of a 512-byte-sector device. */
const hasGptHeader = (prefix: Buffer): boolean => {
  if (prefix.length < 528) return false;
  if (!prefix.subarray(512, 520).equals(GPT_HEADER_SIGNATURE)) return false;
  const headerSize = prefix.readUInt32LE(524);
  return (
    prefix.readUInt32LE(520) === GPT_REVISION_1_0 &&
    headerSize >= 92 &&
    headerSize <= 512
  );
};

/** Driver descriptor block (`ER`) followed by a partition map entry (`PM`). */
const hasApplePartitionMap = (prefix: Buffer): boolean =>
  prefix.length >= 514 &&
  prefix[0] === 0x45 &&
  prefix[1] === 0x52 &&
  prefix[512] === 0x50 &&
  prefix[513] === 0x4d;

/** Boot signature plus a well-formed table with at least one used entry. */
const hasMbrPartitionTable = (prefix: Buffer): boolean => {
  if (prefix.length < 512 || prefix[510] !== 0x55 || prefix[511] !== 0xaa)
    return false;
  let used = false;
  for (let entry = 446; entry < 510; entry += 16) {
    const status = prefix[entry];
    if (status !== 0x00 && status !== 0x80) return false;
    used ||= prefix[entry + 4] !== 0 && prefix.readUInt32LE(entry + 12) !== 0;
  }
  return used;
};

/** Unpartitioned HFS+ (`H+`, version 4) or HFSX (`HX`, version 5) volume. */
const hasHfsPlusVolumeHeader = (prefix: Buffer): boolean => {
  if (prefix.length < HFS_PLUS_HEADER_END || prefix[1024] !== 0x48)
    return false;
  const version = prefix.readUInt16BE(1026);
  return (
    (prefix[1025] === 0x2b && version === 4) ||
    (prefix[1025] === 0x58 && version === 5)
  );
};
