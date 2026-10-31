/**
 * Recompute the APK Signature Scheme v2/v3 content digest so a signer's
 * declared digest can be compared with the current bytes. A match only shows
 * that the declared digest equals the bytes; it is not a signature
 * verification, because anyone who changes the bytes can recompute the digest
 * and replace the declared one.
 *
 * The digest covers three sections, as if the APK Signing Block were absent:
 *   1. ZIP entry contents: [0, blockStart)
 *   2. Central directory:  [centralDirectoryOffset, eocdOffset)
 *   3. End of central directory, with its "central directory offset" field
 *      rewritten to blockStart.
 * Each section is split into 1 MiB chunks; chunk digest = H(0xa5 ‖ u32le(len) ‖ chunk);
 * top digest = H(0x5a ‖ u32le(chunkCount) ‖ chunkDigests…).
 *
 * Pure and dependency-free: the caller injects the hash implementation. Returns
 * `null` when the layout is not the plain v2 shape this algorithm assumes (e.g. a
 * Zip64 record between the central directory and the EOCD), so a caller reports
 * "not computed" rather than a false mismatch.
 */
import type { ZipTail } from "./apkSigningBlock.js";

export type ContentDigestAlgorithm = "sha256" | "sha512";

export interface IncrementalHash {
  update(data: Uint8Array): void;
  digest(): Uint8Array;
}
export type HashFactory = (
  algorithm: ContentDigestAlgorithm,
) => IncrementalHash;

const CHUNK_SIZE = 1024 * 1024;
const EOCD_CD_OFFSET_FIELD = 16;

const u32le = (value: number): Uint8Array => {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value, true);
  return out;
};

export const computeApkContentDigest = (
  bytes: Uint8Array,
  layout: {
    readonly tail: ZipTail;
    readonly blockStart: number;
    readonly algorithm: ContentDigestAlgorithm;
  },
  createHash: HashFactory,
): Uint8Array | null => {
  const { tail, blockStart, algorithm } = layout;
  const { centralDirectoryOffset, centralDirectorySize, eocdOffset } = tail;
  if (
    blockStart < 0 ||
    blockStart > centralDirectoryOffset ||
    centralDirectoryOffset + centralDirectorySize !== eocdOffset ||
    eocdOffset + 22 > bytes.length
  )
    return null;

  // A true copy: on a Node Buffer `.slice()` is a view over a possibly pooled
  // ArrayBuffer, so rewriting through it would corrupt the caller's bytes. The
  // DataView must also honour the copy's own byteOffset.
  const eocd = Uint8Array.from(bytes.subarray(eocdOffset));
  new DataView(eocd.buffer, eocd.byteOffset, eocd.byteLength).setUint32(
    EOCD_CD_OFFSET_FIELD,
    blockStart,
    true,
  );
  const sections = [
    bytes.subarray(0, blockStart),
    bytes.subarray(centralDirectoryOffset, eocdOffset),
    eocd,
  ];

  const chunkDigests: Uint8Array[] = [];
  for (const section of sections)
    for (let offset = 0; offset < section.length; offset += CHUNK_SIZE) {
      const chunk = section.subarray(
        offset,
        Math.min(offset + CHUNK_SIZE, section.length),
      );
      const hash = createHash(algorithm);
      hash.update(Uint8Array.of(0xa5));
      hash.update(u32le(chunk.length));
      hash.update(chunk);
      chunkDigests.push(hash.digest());
    }

  const top = createHash(algorithm);
  top.update(Uint8Array.of(0x5a));
  top.update(u32le(chunkDigests.length));
  for (const digest of chunkDigests) top.update(digest);
  return top.digest();
};
