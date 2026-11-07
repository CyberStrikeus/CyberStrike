/** Classic ZIP EOCD fixed record and its format-defined comment limit. */
export const ZIP_EOCD_BYTES = 22;
export const ZIP_MAX_COMMENT_BYTES = 0xffff;

export interface ZipEndOfCentralDirectory {
  /** Relative to the supplied byte window, which ends at the archive's end. */
  readonly offset: number;
  readonly disk: number;
  readonly directoryDisk: number;
  readonly entriesOnDisk: number;
  readonly totalEntries: number;
  readonly directorySize: number;
  readonly directoryOffset: number;
  readonly commentLength: number;
}

/**
 * Observe complete classic records whose declared comment ends this window,
 * latest first. Candidate recognition does not establish directory validity,
 * ambiguity policy, disk support, or the meaning of Zip64 sentinel fields.
 */
export function* zipEndOfCentralDirectoryCandidates(
  bytes: Uint8Array,
): Generator<ZipEndOfCentralDirectory> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const earliest = Math.max(
    0,
    bytes.byteLength - ZIP_EOCD_BYTES - ZIP_MAX_COMMENT_BYTES,
  );
  for (
    let offset = bytes.byteLength - ZIP_EOCD_BYTES;
    offset >= earliest;
    offset--
  ) {
    if (view.getUint32(offset, true) !== 0x06054b50) continue;
    const commentLength = view.getUint16(offset + 20, true);
    if (offset + ZIP_EOCD_BYTES + commentLength !== bytes.byteLength) continue;
    yield {
      offset,
      disk: view.getUint16(offset + 4, true),
      directoryDisk: view.getUint16(offset + 6, true),
      entriesOnDisk: view.getUint16(offset + 8, true),
      totalEntries: view.getUint16(offset + 10, true),
      directorySize: view.getUint32(offset + 12, true),
      directoryOffset: view.getUint32(offset + 16, true),
      commentLength,
    };
  }
}
