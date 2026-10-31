import type { FileHandle } from "node:fs/promises";

/**
 * Fill a positional window until its end or explicit EOF, without owning the descriptor.
 * Checkpoints receive cumulative acquired bytes so an owner can defer cancellation
 * of a completed range to its finalization without losing the completed observation.
 */
export const readFileHandleRange = async (
  handle: Pick<FileHandle, "read">,
  position: number,
  length: number,
  assertActive: (bytesRead: number) => void = () => {},
): Promise<Buffer> => {
  if (
    !Number.isSafeInteger(position) ||
    position < 0 ||
    !Number.isSafeInteger(length) ||
    length < 0 ||
    !Number.isSafeInteger(position + length)
  )
    throw new RangeError("Invalid file read range");
  assertActive(0);
  const bytes = Buffer.alloc(length);
  let filled = 0;
  while (filled < length) {
    assertActive(filled);
    const { bytesRead } = await handle.read(
      bytes,
      filled,
      length - filled,
      position + filled,
    );
    // Let the caller interpret physical EOF before checking cancellation.
    // A native I/O rejection also remains primary if cancellation arrived in flight.
    if (bytesRead === 0) break;
    filled += bytesRead;
    assertActive(filled);
  }
  return bytes.subarray(0, filled);
};
