import {
  zipEndOfCentralDirectoryCandidates,
  ZIP_EOCD_BYTES,
  ZIP_MAX_COMMENT_BYTES,
} from "./zipEndOfCentralDirectory.js";

/** ZIP-backed application package families that share the hardened archive reader. */
export const ZIP_PACKAGE_FORMATS = [
  "zip",
  "ipa",
  "apk",
  "msix",
  "appx",
  "hap",
  "hsp",
  "app-pack",
] as const;
export type ZipPackageFormat = (typeof ZIP_PACKAGE_FORMATS)[number];

/** All ZIP package families share archive ownership and inventory coverage. */
export const isZipPackageFormat = (
  format: string,
): format is ZipPackageFormat =>
  ZIP_PACKAGE_FORMATS.some((candidate) => candidate === format);

/** Recognize local-header, classic/Zip64 empty-archive, or split ZIP signatures, not validity. */
export const hasZipSignature = (bytes: Uint8Array): boolean =>
  bytes.length >= 4 &&
  bytes[0] === 0x50 &&
  bytes[1] === 0x4b &&
  ((bytes[2] === 0x03 && bytes[3] === 0x04) ||
    (bytes[2] === 0x05 && bytes[3] === 0x06) ||
    (bytes[2] === 0x06 && bytes[3] === 0x06) ||
    (bytes[2] === 0x07 && bytes[3] === 0x08));

const CENTRAL_DIRECTORY_HEADER = 0x02014b50;
const LOCAL_FILE_HEADER = 0x04034b50;
const CENTRAL_HEADER_BYTES = 46;

/** Positional read of at most `length` bytes; a short result means end of file. */
export type PositionalRead = (
  position: number,
  length: number,
) => Promise<Uint8Array>;

/**
 * Locate a single-disk ZIP whose end-of-central-directory record ends the
 * file after leading non-ZIP bytes, such as a self-extractor or script stub.
 * Its central directory and first local header must resolve, whether member
 * offsets include the leading bytes or were written before them. Zip64,
 * split and empty archives are not located. Returns the leading byte count.
 */
export const locateTrailingZipArchive = async (
  size: number,
  read: PositionalRead,
): Promise<{ readonly leadingBytes: number } | undefined> => {
  if (!Number.isSafeInteger(size) || size < ZIP_EOCD_BYTES) return undefined;
  const tailStart = Math.max(0, size - ZIP_EOCD_BYTES - ZIP_MAX_COMMENT_BYTES);
  const tail = Buffer.from(await read(tailStart, size - tailStart));
  if (tail.length !== size - tailStart) return undefined;
  // A comment may contain EOCD-like bytes; validate each candidate's directory.
  for (const candidate of zipEndOfCentralDirectoryCandidates(tail)) {
    const {
      offset: record,
      entriesOnDisk,
      directorySize: directoryBytes,
      directoryOffset: declaredDirectory,
    } = candidate;
    if (
      candidate.disk !== 0 ||
      candidate.directoryDisk !== 0 ||
      entriesOnDisk === 0 ||
      entriesOnDisk === 0xffff ||
      entriesOnDisk !== candidate.totalEntries ||
      directoryBytes === 0xffffffff ||
      declaredDirectory === 0xffffffff
    )
      continue;
    const directory = tailStart + record - directoryBytes;
    // Offsets written before leading bytes were prepended are shifted by them.
    const shift = directory - declaredDirectory;
    if (directory < 0 || shift < 0) continue;
    const header = Buffer.from(await read(directory, CENTRAL_HEADER_BYTES));
    if (
      header.length !== CENTRAL_HEADER_BYTES ||
      header.readUInt32LE(0) !== CENTRAL_DIRECTORY_HEADER
    )
      continue;
    const firstLocal = header.readUInt32LE(42) + shift;
    if (firstLocal === 0 || firstLocal >= directory) continue;
    const local = Buffer.from(await read(firstLocal, 4));
    if (local.length === 4 && local.readUInt32LE(0) === LOCAL_FILE_HEADER)
      return { leadingBytes: firstLocal };
  }
  return undefined;
};

/**
 * Classify a ZIP-backed package by its complete lower-cased path suffix.
 *
 * This is deliberately extension-only. Callers must separately verify ZIP
 * magic before trusting the classification for a root input. HarmonyOS `.har`
 * is intentionally absent: the suffix also names HTTP Archive JSON, so a
 * Harmony shared archive is only established from verified ZIP bytes. The
 * HarmonyOS App Pack suffix `.app` is also absent here: it applies only to
 * root inputs (see `classifyAndHashRootForInventory`), because a nested ZIP entry ending
 * in `.app` inside another package, such as an IPA, is not an App Pack.
 */
export const zipPackageFormatForPath = (
  path: string,
): ZipPackageFormat | undefined => {
  const lower = path.toLowerCase();
  if (lower.endsWith(".zip")) return "zip";
  if (lower.endsWith(".ipa")) return "ipa";
  // An Android App Bundle is a ZIP archive, not a standalone APK.
  if (lower.endsWith(".apk")) return "apk";
  if (lower.endsWith(".msix") || lower.endsWith(".msixbundle")) return "msix";
  if (lower.endsWith(".appx") || lower.endsWith(".appxbundle")) return "appx";
  if (lower.endsWith(".hap")) return "hap";
  if (lower.endsWith(".hsp")) return "hsp";
  return undefined;
};

/**
 * Classify a verified ZIP root input by its path. The HarmonyOS App Pack
 * suffix `.app` applies only to root inputs; a nested ZIP member ending in
 * `.app` keeps its observed format.
 */
export const zipRootPackageFormat = (path: string): ZipPackageFormat => {
  const lower = path.toLowerCase();
  return lower.endsWith(".app")
    ? "app-pack"
    : (zipPackageFormatForPath(lower) ?? "zip");
};

/** Inventory lists entries, not all bytes surrounding the central directory. */
export const ZIP_NON_ENTRY_LIMITATION =
  "ZIP inventory lists central-directory entries only. Non-entry bytes, including leading bytes before the first entry such as a self-extractor stub, an APK Signing Block before the central directory or a ZIP comment after it, are not occurrences.";
