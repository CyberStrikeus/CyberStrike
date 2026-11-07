import {
  zipEndOfCentralDirectoryCandidates,
  ZIP_EOCD_BYTES,
  type ZipEndOfCentralDirectory,
} from "../zipEndOfCentralDirectory.js";

/**
 * Locate and frame the APK Signing Block (APK Signature Scheme v2+). The block
 * sits between the last ZIP entry and the central directory:
 *   [ zip entries ][ APK Signing Block ][ central directory ][ EOCD ]
 * and is framed as:
 *   uint64 size | id-value pairs | uint64 size | "APK Sig Block 42"
 * where each pair is `uint64 length | uint32 id | value[length-4]`.
 *
 * Dependency-free and bounded: the end-of-central-directory record is found by a
 * bounded backward scan, every size/offset is checked against the buffer before
 * use, and a malformed or absent block yields a tagged {@link Result}, never a
 * throw. Absence of the block is `ok(null)` (the APK is v1-only or unsigned),
 * not an error. All integers are little-endian (ZIP).
 */
import { type Result, err, ok } from "../result.js";

const ZIP64_EOCD_LOCATOR_SIGNATURE = 0x07064b50;
const ZIP64_EOCD_SIGNATURE = 0x06064b50;
const ZIP64_SENTINEL = 0xffffffff;
/** The 16-bit EOCD entry count saturates here when Zip64 carries the real count. */
const ZIP64_ENTRIES_SENTINEL = 0xffff;
/** "APK Sig Block 42" — the 16-byte block magic (JAR/APK signing block spec). */
const BLOCK_MAGIC = "APK Sig Block 42";
/** A single pair is at least 12 bytes (uint64 length + uint32 id); cap the count. */
const MAX_PAIRS = 4096;

/** Well-known APK Signing Block pair IDs. */
export const APK_BLOCK_ID = {
  signatureV2: 0x7109871a,
  signatureV3: 0xf05368c0,
  signatureV31: 0x1b93ad61,
  sourceStampV1: 0x2b09189e,
  sourceStampV2: 0x6dff800d,
} as const;

export type ApkSigningBlockError =
  | { readonly kind: "not-a-zip"; readonly detail: string }
  | { readonly kind: "zip64-unsupported"; readonly detail: string }
  | {
      /** A ZIP whose end-of-central-directory is damaged or inconsistent. */
      readonly kind: "malformed-zip";
      readonly offset: number;
      readonly detail: string;
    }
  | {
      readonly kind: "malformed-block";
      readonly offset: number;
      readonly detail: string;
    }
  | {
      readonly kind: "budget-exceeded";
      readonly resource: "signing-block-pairs";
      readonly limit: number;
    };

export interface ZipTail {
  readonly eocdOffset: number;
  readonly centralDirectoryOffset: number;
  readonly centralDirectorySize: number;
  readonly totalEntries: number;
  /**
   * The classic EOCD record's 16-bit entry count. apksig takes the record
   * count from this field alone (it ignores a Zip64 record), so it reads only
   * this many records when Zip64 declares more.
   */
  readonly classicEntryCount: number;
}

export interface ApkSigningBlockPair {
  readonly id: number;
  /** View over the block buffer; not copied. */
  readonly value: Uint8Array;
}

export interface ApkSigningBlock {
  readonly blockStart: number;
  readonly pairs: readonly ApkSigningBlockPair[];
}

const view = (bytes: Uint8Array): DataView =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

/** Read an unsigned 64-bit little-endian value as a Number, or null if unsafe/oob. */
const u64 = (dv: DataView, at: number): number | null => {
  if (at < 0 || at + 8 > dv.byteLength) return null;
  const value = dv.getBigUint64(at, true);
  return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : null;
};

/** The archive starts with a ZIP local file header (`PK\x03\x04`). */
const hasLocalFileHeader = (bytes: Uint8Array): boolean =>
  bytes.length >= 4 &&
  bytes[0] === 0x50 &&
  bytes[1] === 0x4b &&
  bytes[2] === 0x03 &&
  bytes[3] === 0x04;

/** Resolve the central-directory offset, following a Zip64 EOCD when present. */
const centralDirectoryOffset = (
  bytes: Uint8Array,
  eocd: ZipEndOfCentralDirectory,
): Result<
  { offset: number; size: number; entries: number; end: number },
  ApkSigningBlockError
> => {
  const dv = view(bytes);
  const {
    offset: eocdOffset,
    totalEntries: entries,
    directorySize: size,
    directoryOffset: offset,
  } = eocd;
  const saturated =
    offset === ZIP64_SENTINEL ||
    size === ZIP64_SENTINEL ||
    entries === ZIP64_ENTRIES_SENTINEL;
  if (!saturated) return ok({ offset, size, entries, end: eocdOffset });
  // Zip64: a locator precedes the EOCD, pointing at the Zip64 EOCD record.
  const locator = eocdOffset - 20;
  if (
    locator < 0 ||
    dv.getUint32(locator, true) !== ZIP64_EOCD_LOCATOR_SIGNATURE
  ) {
    // Exactly 65,535 entries saturates the count without Zip64; that archive
    // is still described completely by its 32-bit EOCD fields.
    if (offset !== ZIP64_SENTINEL && size !== ZIP64_SENTINEL)
      return ok({ offset, size, entries, end: eocdOffset });
    return err({
      kind: "malformed-zip",
      offset: eocdOffset,
      detail: "missing Zip64 EOCD locator",
    });
  }
  // APPNOTE 6.3.10 §4.3.15 makes the record offset relative to its disk.
  // A selected file cannot resolve another disk's offset as a local span.
  const recordDisk = dv.getUint32(locator + 4, true);
  const totalDisks = dv.getUint32(locator + 16, true);
  if (totalDisks === 0)
    return err({
      kind: "malformed-zip",
      offset: locator + 16,
      detail: "Zip64 locator declares zero disks",
    });
  if (recordDisk >= totalDisks)
    return err({
      kind: "malformed-zip",
      offset: locator + 4,
      detail: "Zip64 EOCD disk is outside the declared disk count",
    });
  if (totalDisks > 1)
    return err({
      kind: "zip64-unsupported",
      detail: "multi-disk Zip64 archives are not supported",
    });
  const recordOffset = u64(dv, locator + 8);
  if (recordOffset === null)
    return err({
      kind: "zip64-unsupported",
      detail: "Zip64 EOCD offset exceeds safe range",
    });
  if (recordOffset + 56 > locator)
    return err({
      kind: "malformed-zip",
      offset: locator + 8,
      detail: "Zip64 EOCD record extends beyond its locator",
    });
  if (dv.getUint32(recordOffset, true) !== ZIP64_EOCD_SIGNATURE)
    return err({
      kind: "malformed-zip",
      offset: recordOffset,
      detail: "invalid Zip64 EOCD signature",
    });
  const z64Offset = u64(dv, recordOffset + 48);
  const z64Size = u64(dv, recordOffset + 40);
  // The Zip64 record's total entry count; the 16-bit EOCD field saturates.
  const z64Entries = u64(dv, recordOffset + 32);
  if (z64Offset === null || z64Size === null || z64Entries === null)
    return err({
      kind: "zip64-unsupported",
      detail: "Zip64 sizes exceed safe range",
    });
  return ok({
    offset: z64Offset,
    size: z64Size,
    entries: z64Entries,
    end: recordOffset,
  });
};

/** Parse the ZIP end-of-central-directory to find the central directory. */
export const parseZipTail = (
  bytes: Uint8Array,
): Result<ZipTail, ApkSigningBlockError> => {
  if (bytes.length < ZIP_EOCD_BYTES)
    return err({ kind: "not-a-zip", detail: "shorter than a ZIP EOCD record" });
  const candidates = [...zipEndOfCentralDirectoryCandidates(bytes)];
  // Two records that each end the archive exactly (one inside the other's
  // comment) leave the archive's directory undetermined: whichever a reader
  // picks, the other may be attacker-placed. apksigner and Android take the
  // one nearest the end; that choice can report a signed APK as unsigned, so
  // REA deliberately refuses instead (stricter than apksigner: a crafted APK
  // that apksigner verifies may be refused here, never misreported).
  if (candidates.length > 1)
    return err({
      kind: "malformed-zip",
      offset: candidates[0]!.offset,
      detail: `${String(candidates.length)} end-of-central-directory records each end the archive (one inside another's comment); the central directory is ambiguous`,
    });
  const eocd = candidates[0];
  if (eocd === undefined)
    // A local-file header without an EOCD is a damaged/truncated archive, not
    // a different file type.
    return hasLocalFileHeader(bytes)
      ? err({
          kind: "malformed-zip",
          offset: bytes.length,
          detail:
            "ZIP local headers present but no end-of-central-directory (truncated or damaged archive)",
        })
      : err({
          kind: "not-a-zip",
          detail: "no end-of-central-directory record",
        });
  const eocdOffset = eocd.offset;
  const cd = centralDirectoryOffset(bytes, eocd);
  if (!cd.ok) return cd;
  if (
    cd.value.offset > cd.value.end ||
    cd.value.size > cd.value.end - cd.value.offset
  )
    return err({
      kind: "malformed-zip",
      offset: eocdOffset,
      detail:
        "central-directory extent overlaps or extends past the ZIP end records",
    });
  // An EOCD declaring no entries cannot describe an archive that holds a
  // local file entry (e.g. a fake EOCD planted in the real one's comment);
  // reading on would report a signed APK as confidently unsigned.
  if (
    (cd.value.entries === 0 || cd.value.size === 0) &&
    hasLocalFileHeader(bytes)
  )
    return err({
      kind: "malformed-zip",
      offset: eocdOffset,
      detail:
        "end-of-central-directory declares no entries, but the archive holds local file entries",
    });
  return ok({
    eocdOffset,
    centralDirectoryOffset: cd.value.offset,
    centralDirectorySize: cd.value.size,
    totalEntries: cd.value.entries,
    classicEntryCount: eocd.totalEntries,
  });
};

const hasBlockMagic = (bytes: Uint8Array, cdOffset: number): boolean => {
  if (cdOffset < 16) return false;
  let magic = "";
  for (let i = 0; i < 16; i += 1)
    magic += String.fromCharCode(bytes[cdOffset - 16 + i]!);
  return magic === BLOCK_MAGIC;
};

/**
 * Locate and frame the APK Signing Block immediately before the central
 * directory. Returns `ok(null)` when no block magic is present (v1-only or
 * unsigned), or the framed id-value pairs otherwise.
 */
export const locateApkSigningBlock = (
  bytes: Uint8Array,
  tail: ZipTail,
): Result<ApkSigningBlock | null, ApkSigningBlockError> => {
  const cdOffset = tail.centralDirectoryOffset;
  if (!hasBlockMagic(bytes, cdOffset)) return ok(null);
  const dv = view(bytes);
  const trailingSize = u64(dv, cdOffset - 24);
  // The footer alone (trailing size + magic) is 24 bytes; a smaller declared
  // size would alias the leading and trailing fields (apksig rejects it too).
  if (trailingSize === null || trailingSize < 24)
    return err({
      kind: "malformed-block",
      offset: cdOffset - 24,
      detail: "bad trailing size",
    });
  const blockStart = cdOffset - trailingSize - 8;
  if (blockStart < 0)
    return err({
      kind: "malformed-block",
      offset: cdOffset,
      detail: "block extends before file start",
    });
  const leadingSize = u64(dv, blockStart);
  if (leadingSize === null || leadingSize !== trailingSize)
    return err({
      kind: "malformed-block",
      offset: blockStart,
      detail: "leading/trailing size mismatch",
    });

  const pairs: ApkSigningBlockPair[] = [];
  let cursor = blockStart + 8;
  const pairsEnd = cdOffset - 24; // stop before trailing size + magic
  while (cursor < pairsEnd) {
    const length = u64(dv, cursor);
    if (length === null || length < 4 || cursor + 8 + length > pairsEnd + 0)
      return err({
        kind: "malformed-block",
        offset: cursor,
        detail: "pair length out of range",
      });
    if (pairs.length >= MAX_PAIRS)
      return err({
        kind: "budget-exceeded",
        resource: "signing-block-pairs",
        limit: MAX_PAIRS,
      });
    const id = dv.getUint32(cursor + 8, true);
    const valueStart = cursor + 12;
    pairs.push({
      id,
      value: bytes.subarray(valueStart, valueStart + (length - 4)),
    });
    cursor += 8 + length;
  }
  return ok({ blockStart, pairs });
};
