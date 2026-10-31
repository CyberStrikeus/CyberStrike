/**
 * Detect v1 (JAR) signing from the ZIP central directory as apksig's
 * V1SchemeVerifier selects it: among entries whose name starts with
 * `META-INF/` (at any depth), `META-INF/MANIFEST.MF` is the manifest, names
 * ending in `.SF` are signature files and names ending in `.RSA`/`.DSA`/`.EC`
 * are signature blocks (all case-sensitive). A signer exists only where a
 * block's `.SF` partner (`name.substring(0, lastIndexOf('.')) + ".SF"`) is
 * present. The PKCS#7 blocks are not parsed, so no v1 signature is verified.
 *
 * Dependency-free and bounded: central-directory records are walked within the
 * declared directory extent and entry count; a record running past it is a
 * tagged error rather than a silently shorter list. Only the signing-relevant
 * `META-INF/` names are decoded (as Java decodes them) and retained, capped at
 * a format-justified count. Duplicate names are found among all records, as
 * apksig rejects a v1 signature for any of them, with 15 bytes of typed-array
 * state per record (up to ~11M records in a 512 MiB Zip64 file) and only a few
 * names decoded.
 */
import { type Result, err, ok } from "../result.js";
import {
  canonicalNameHash,
  compareCanonicalNames,
  decodeZipName,
  isCanonicalZipName,
  sameZipName,
  type StoredZipName,
} from "./zipEntryName.js";
import {
  APK_V1_MANIFEST_PATH,
  APK_V1_META_INF_PREFIX,
  isV1SignatureBlockName,
  isV1SignatureFileName,
  isV1SignatureMetadataName,
  startsWithV1MetaInfPrefix,
  v1SignatureFileNameForBlock,
} from "./apkV1MetadataName.js";

const CD_SIGNATURE = 0x02014b50;
const CD_FIXED_SIZE = 46;

export type ApkCentralDirectoryError =
  | {
      readonly kind: "malformed-central-directory";
      readonly offset: number;
      readonly detail: string;
    }
  | {
      readonly kind: "budget-exceeded";
      readonly resource: "v1-signature-entries";
      readonly limit: number;
    };

/**
 * Signing-relevant `META-INF/` entries retained. A signed APK holds a manifest
 * plus one `.SF` and one block per v1 signer; thousands is already pathological.
 */
export const MAX_V1_SIGNATURE_ENTRIES = 4096;

/**
 * v1 signers (signature block + `.SF` pairs) decoded. apksig accepts at most
 * 10; more only multiplies work and output, so the report is refused.
 */
export const MAX_V1_SIGNERS = 32;

/** Duplicated central-directory names decoded for the report; the rest are counted. */
export const MAX_DUPLICATE_NAME_SAMPLE = 5;

/** A signing-relevant central-directory entry and where its data is stored. */
export interface ApkV1Entry {
  readonly name: string;
  /** The name exactly as the central directory stores it (a view, not a copy). */
  readonly rawName: Uint8Array;
  /** General-purpose bit flags (bit 0 encrypted, bit 3 data descriptor). */
  readonly flags: number;
  /** ZIP compression method (0 stored, 8 deflate). */
  readonly method: number;
  readonly crc32: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly localHeaderOffset: number;
}

/** A v1 signer as apksig pairs it: one signature block and its `.SF` partner. */
export interface ApkV1SignerEntry {
  readonly signatureFile: string;
  /** The first central-directory entry with the block's name. */
  readonly block: ApkV1Entry;
  /**
   * The block, `.SF` or `META-INF/MANIFEST.MF` name the central directory
   * holds more than once, which apksig rejects ("Duplicate entry"); null when
   * all three are unique.
   */
  readonly duplicate: string | null;
}

export interface ApkV1Signature {
  /** At least one signature block has its matching `.SF` signature file. */
  readonly present: boolean;
  readonly hasManifest: boolean;
  /** `META-INF/**.SF` signature files. */
  readonly signatureFiles: readonly string[];
  /** `META-INF/**.(RSA|DSA|EC)` PKCS#7 signature blocks. */
  readonly blockFiles: readonly string[];
  /** Blocks paired with their `.SF` file, one per block name, in central-directory order. */
  readonly signers: readonly ApkV1SignerEntry[];
}

/** A duplicated name as apksig decodes it, with its stored length. */
export interface ApkDuplicateName {
  readonly name: string;
  /** The name's length as the central directory stores it. */
  readonly storedBytes: number;
}

/** Distinct duplicated names: how many, and the first few. */
export interface ApkDuplicateNameSample {
  readonly count: number;
  /** The first few, in central-directory order of their first occurrence. */
  readonly sample: readonly ApkDuplicateName[];
}

/**
 * Names the central directory holds more than once, as apksig sees them:
 * `count`/`sample` cover the records apksig reads; `unread` names those
 * whose second copy lies only past them (a Zip64 count above the classic
 * end-of-central-directory record's 16-bit count, which apksig never sees).
 */
export interface ApkDuplicateNames extends ApkDuplicateNameSample {
  /** Records walked: every record the end-of-central-directory declares. */
  readonly records: number;
  /** Records apksig reads (the classic 16-bit count, at most `records`). */
  readonly apksigRecords: number;
  readonly unread: ApkDuplicateNameSample;
}

/** The signing-relevant entries plus the duplicate names of the whole directory. */
export interface ApkCentralDirectoryScan {
  readonly entries: readonly ApkV1Entry[];
  readonly duplicates: ApkDuplicateNames;
}

/** Byte order of two stored well-formed names, compared in place. */
const compareStoredNames = (
  bytes: Uint8Array,
  starts: Uint32Array,
  lengths: Uint16Array,
  a: number,
  b: number,
): number => {
  const as = starts[a] ?? 0;
  const bs = starts[b] ?? 0;
  const al = lengths[a] ?? 0;
  const bl = lengths[b] ?? 0;
  for (let k = 0; k < Math.min(al, bl); k += 1) {
    const d = (bytes[as + k] ?? 0) - (bytes[bs + k] ?? 0);
    if (d !== 0) return d;
  }
  return al - bl;
};

/** 2^24 records exceed any central directory in a 512 MiB archive (46 bytes each). */
const INDEX_BITS = 2 ** 24;

/**
 * Names stored more than once, compared as apksig compares the decoded
 * names: by their canonical bytes (see zipEntryName.ts), which are the stored
 * bytes of every well-formed name. Each record's name is hashed into the high
 * bits of one sortable number with its index in the low bits; only records
 * whose hashes collide are compared, so the work is O(n log n) even for
 * crafted collisions. A name counts for apksig when its second copy lies
 * within the records apksig reads.
 */
const duplicateNames = (
  bytes: Uint8Array,
  starts: Uint32Array,
  lengths: Uint16Array,
  count: number,
  apksigRecords: number,
): ApkDuplicateNames => {
  const wellFormed = new Uint8Array(count);
  const keys = new Float64Array(count);
  for (let i = 0; i < count; i += 1) {
    const start = starts[i] ?? 0;
    const stop = start + (lengths[i] ?? 0);
    const canonical = isCanonicalZipName(bytes, start, stop);
    wellFormed[i] = canonical ? 1 : 0;
    const hash = canonicalNameHash(bytes, start, stop, canonical);
    // 29 hash bits and 24 index bits stay within a double's exact integers.
    keys[i] = (hash >>> 3) * INDEX_BITS + i;
  }
  keys.sort();
  const stored = (i: number): StoredZipName => {
    const start = starts[i] ?? 0;
    return { bytes, start, stop: start + (lengths[i] ?? 0) };
  };
  // Well-formed names are their own canonical bytes: compared in place.
  const compare = (a: number, b: number): number =>
    wellFormed[a] === 1 && wellFormed[b] === 1
      ? compareStoredNames(bytes, starts, lengths, a, b)
      : compareCanonicalNames(stored(a), stored(b));
  const seen: number[] = [];
  const unread: number[] = [];
  for (let run = 0; run < count;) {
    const hash = Math.floor((keys[run] ?? 0) / INDEX_BITS);
    let stop = run + 1;
    while (stop < count && Math.floor((keys[stop] ?? 0) / INDEX_BITS) === hash)
      stop += 1;
    if (stop - run > 1) {
      const group = Array.from(
        keys.subarray(run, stop),
        (key) => key % INDEX_BITS,
      ).sort((a, b) => compare(a, b) || a - b);
      // Sorted by name, then record order: the first two of each run of equal
      // names are that name's first and second occurrences.
      let previousSame = false;
      for (let k = 1; k < group.length; k += 1) {
        const first = group[k - 1] ?? 0;
        const second = group[k] ?? 0;
        const same = compare(first, second) === 0;
        if (same && !previousSame)
          (second < apksigRecords ? seen : unread).push(first);
        previousSame = same;
      }
    }
    run = stop;
  }
  const sampled = (firsts: number[]): ApkDuplicateNameSample => {
    firsts.sort((a, b) => a - b);
    return {
      count: firsts.length,
      sample: firsts.slice(0, MAX_DUPLICATE_NAME_SAMPLE).map((i) => {
        const start = starts[i] ?? 0;
        const storedBytes = lengths[i] ?? 0;
        return {
          name: decodeZipName(bytes.subarray(start, start + storedBytes)),
          storedBytes,
        };
      }),
    };
  };
  return {
    ...sampled(seen),
    records: count,
    apksigRecords: Math.min(apksigRecords, count),
    unread: sampled(unread),
  };
};

/**
 * Walk every central-directory record within the declared extent and count,
 * returning the `META-INF/` names that take part in v1 signing and the names
 * held more than once. A record that runs past the declared extent is an
 * error, not a silently shorter list: a partial walk would turn "unknown"
 * into "absent". `apksigRecords` is how many leading records apksig reads
 * (the classic end-of-central-directory count); it defaults to all of them.
 */
export const centralDirectoryV1SignatureEntries = (
  bytes: Uint8Array,
  centralDirectoryOffset: number,
  centralDirectorySize: number,
  totalEntries: number,
  apksigRecords: number = totalEntries,
): Result<ApkCentralDirectoryScan, ApkCentralDirectoryError> => {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = centralDirectoryOffset + centralDirectorySize;
  if (
    !Number.isSafeInteger(end) ||
    centralDirectoryOffset < 0 ||
    centralDirectorySize < 0 ||
    end > bytes.length
  )
    return err({
      kind: "malformed-central-directory",
      offset: centralDirectoryOffset,
      detail: "declared central-directory extent is outside the file",
    });
  // A record takes at least its fixed bytes, so the walk fails before a
  // declared count past this capacity is reached.
  const capacity = Math.min(
    totalEntries,
    Math.max(0, Math.floor((end - centralDirectoryOffset) / CD_FIXED_SIZE)),
  );
  const starts = new Uint32Array(capacity);
  const lengths = new Uint16Array(capacity);
  const entries: ApkV1Entry[] = [];
  let at = centralDirectoryOffset;
  for (let i = 0; i < totalEntries; i += 1) {
    if (at + CD_FIXED_SIZE > end)
      return err({
        kind: "malformed-central-directory",
        offset: at,
        detail: `central directory ends after ${String(i)} of ${String(totalEntries)} records`,
      });
    if (dv.getUint32(at, true) !== CD_SIGNATURE)
      return err({
        kind: "malformed-central-directory",
        offset: at,
        detail: "central-directory record signature mismatch",
      });
    const nameLength = dv.getUint16(at + 28, true);
    const extraLength = dv.getUint16(at + 30, true);
    const commentLength = dv.getUint16(at + 32, true);
    const nameStart = at + CD_FIXED_SIZE;
    if (nameStart + nameLength > end)
      return err({
        kind: "malformed-central-directory",
        offset: nameStart,
        detail: "central-directory file name runs past the directory",
      });
    starts[i] = nameStart;
    lengths[i] = nameLength;
    if (startsWithV1MetaInfPrefix(bytes, nameStart, nameLength)) {
      const rawName = bytes.subarray(nameStart, nameStart + nameLength);
      const name = decodeZipName(rawName);
      if (isV1SignatureMetadataName(name)) {
        if (entries.length >= MAX_V1_SIGNATURE_ENTRIES)
          return err({
            kind: "budget-exceeded",
            resource: "v1-signature-entries",
            limit: MAX_V1_SIGNATURE_ENTRIES,
          });
        entries.push({
          name,
          rawName,
          flags: dv.getUint16(at + 8, true),
          method: dv.getUint16(at + 10, true),
          crc32: dv.getUint32(at + 16, true),
          compressedSize: dv.getUint32(at + 20, true),
          uncompressedSize: dv.getUint32(at + 24, true),
          localHeaderOffset: dv.getUint32(at + 42, true),
        });
      }
    }
    at = nameStart + nameLength + extraLength + commentLength;
  }
  // An under-declared record count would silently hide entries (and so v1
  // signing): the walk must consume exactly the declared directory.
  if (at !== end)
    return err({
      kind: "malformed-central-directory",
      offset: at,
      detail: `${String(end - at)} bytes of the declared central directory remain after ${String(totalEntries)} records`,
    });
  return ok({
    entries,
    duplicates: duplicateNames(bytes, starts, lengths, capacity, apksigRecords),
  });
};

/** Classify central-directory entries into the v1 (JAR) signing facts. */
export const detectV1Signature = (
  entries: readonly ApkV1Entry[],
): ApkV1Signature => {
  const selected = entries.filter((entry) =>
    entry.name.startsWith(APK_V1_META_INF_PREFIX),
  );
  // Case-sensitive throughout, as apksig matches JAR signature entries.
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const { name } of selected)
    if (seen.has(name)) duplicates.add(name);
    else seen.add(name);
  const signatureFiles = selected
    .map((entry) => entry.name)
    .filter(isV1SignatureFileName);
  const blocks = selected.filter((entry) => isV1SignatureBlockName(entry.name));
  const sfNames = new Set(signatureFiles);
  const paired = new Set<string>();
  const signers = blocks.flatMap((block) => {
    const signatureFile = v1SignatureFileNameForBlock(block.name);
    if (!sfNames.has(signatureFile) || paired.has(block.name)) return [];
    paired.add(block.name);
    // apksig reads every signer's manifest, so a duplicate one affects them all.
    const duplicate =
      [block.name, signatureFile, APK_V1_MANIFEST_PATH].find((name) =>
        duplicates.has(name),
      ) ?? null;
    return [{ signatureFile, block, duplicate }];
  });
  return {
    present: signers.length > 0,
    hasManifest: selected.some((entry) => entry.name === APK_V1_MANIFEST_PATH),
    signatureFiles,
    blockFiles: blocks.map((block) => block.name),
    signers,
  };
};

const LOCAL_SIGNATURE = 0x04034b50;
const LOCAL_FIXED_SIZE = 30;
const ZIP64_SENTINEL = 0xffffffff;
const FLAG_ENCRYPTED = 0x1;
const FLAG_DATA_DESCRIPTOR = 0x8;

/** The central directory sets the entry's encryption flag (bit 0). */
export const centralDeclaresEncryption = (entry: ApkV1Entry): boolean =>
  (entry.flags & FLAG_ENCRYPTED) !== 0;

/** Why an entry's stored bytes could not be located. */
export type ApkLocalEntryError = { readonly detail: string };

/** An entry's stored bytes and whether either header sets the encryption flag. */
export interface ApkLocalEntryData {
  readonly data: Uint8Array;
  readonly declaresEncryption: boolean;
}

/**
 * Locate an entry's stored (possibly compressed) bytes through its local file
 * header. The data must lie within the archive's entry region (before the
 * signing block or central directory) and its declared sizes must be read
 * directly, so Zip64-sized entries are reported, not guessed. As apksig's
 * LocalFileRecord does, the local header must agree with the central
 * directory on the name (no longer in bytes, then equal once decoded, as
 * apksig compares them), the
 * data-descriptor flag and (without a data
 * descriptor) the CRC-32 and both sizes: a disagreement leaves the entry's
 * bytes unknown, never read from one side. Like LocalFileRecord, the
 * encryption flag (bit 0) does not stop the read; it is returned so the caller
 * can say so, and bytes that really are encrypted fail to decode.
 */
export const localEntryData = (
  bytes: Uint8Array,
  entry: ApkV1Entry,
  entriesEnd: number,
): Result<ApkLocalEntryData, ApkLocalEntryError> => {
  if (
    entry.compressedSize === ZIP64_SENTINEL ||
    entry.uncompressedSize === ZIP64_SENTINEL ||
    entry.localHeaderOffset === ZIP64_SENTINEL
  )
    return err({ detail: "Zip64 entry sizes are not read" });
  const at = entry.localHeaderOffset;
  const limit = Math.min(entriesEnd, bytes.length);
  if (at + LOCAL_FIXED_SIZE > limit)
    return err({
      detail: `local header at byte ${String(at)} is out of range`,
    });
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(at, true) !== LOCAL_SIGNATURE)
    return err({
      detail: `local header signature mismatch at byte ${String(at)}`,
    });
  const flags = dv.getUint16(at + 6, true);
  const descriptor = (flags & FLAG_DATA_DESCRIPTOR) !== 0;
  if (descriptor !== ((entry.flags & FLAG_DATA_DESCRIPTOR) !== 0))
    return err({
      detail:
        "local header and central directory disagree on the data-descriptor flag",
    });
  if (!descriptor)
    for (const [field, offset, expected] of [
      ["CRC-32", 14, entry.crc32],
      ["compressed size", 18, entry.compressedSize],
      ["uncompressed size", 22, entry.uncompressedSize],
    ] as const) {
      const local = dv.getUint32(at + offset, true);
      if (local !== expected)
        return err({
          detail: `local header ${field} ${String(local)} differs from the central directory's ${String(expected)}`,
        });
    }
  const nameLength = dv.getUint16(at + 26, true);
  const nameStart = at + LOCAL_FIXED_SIZE;
  if (
    nameStart + nameLength > limit ||
    // apksig refuses a local name longer in bytes before decoding either.
    nameLength > entry.rawName.length ||
    !sameZipName(
      bytes.subarray(nameStart, nameStart + nameLength),
      entry.rawName,
    )
  )
    return err({
      detail: "local header name differs from the central directory's",
    });
  const start = nameStart + nameLength + dv.getUint16(at + 28, true);
  const end = start + entry.compressedSize;
  if (end > limit)
    return err({
      detail: `entry data at byte ${String(start)} runs past the entries`,
    });
  return ok({
    data: bytes.subarray(start, end),
    declaresEncryption: ((entry.flags | flags) & FLAG_ENCRYPTED) !== 0,
  });
};
