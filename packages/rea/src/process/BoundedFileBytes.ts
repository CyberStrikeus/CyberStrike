import type { FileHandle } from "node:fs/promises";

export interface BoundedFileReadOptions {
  readonly signal?: AbortSignal | undefined;
  readonly expectedSize?: number | undefined;
  readonly cancellationFailure?: ((reason: unknown) => Error) | undefined;
  readonly operationFailure?: ((cause: unknown) => Error) | undefined;
}

/** Read through EOF, returning undefined on overflow; leave the handle open. */
export const readBoundedFileBytes = async (
  handle: FileHandle,
  maxBytes: number,
  options: BoundedFileReadOptions = {},
): Promise<Buffer | undefined> => {
  const { signal, expectedSize, cancellationFailure, operationFailure } =
    options;
  const read = async (
    buffer: Buffer,
    offset: number,
    length: number,
  ): Promise<{ readonly bytesRead: number }> => {
    try {
      return await handle.read(buffer, offset, length, null);
    } catch (cause: unknown) {
      if (operationFailure !== undefined) throw operationFailure(cause);
      throw cause;
    }
  };
  const assertActive = (): void => {
    if (signal?.aborted && cancellationFailure !== undefined)
      throw cancellationFailure(signal.reason);
    signal?.throwIfAborted();
  };
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0)
    throw new RangeError("File byte limit must be a nonnegative safe integer");
  if (
    expectedSize !== undefined &&
    (!Number.isSafeInteger(expectedSize) ||
      expectedSize < 0 ||
      expectedSize > maxBytes)
  )
    throw new RangeError("Expected file size must fit the byte limit");
  if (expectedSize === undefined) {
    const chunks: Buffer[] = [];
    const buffer = Buffer.allocUnsafe(Math.min(64 * 1_024, maxBytes + 1));
    let total = 0;
    for (;;) {
      assertActive();
      const { bytesRead } = await read(
        buffer,
        0,
        Math.min(buffer.length, maxBytes - total + 1),
      );
      if (bytesRead === 0) return Buffer.concat(chunks, total);
      total += bytesRead;
      if (total > maxBytes) return undefined;
      chunks.push(Buffer.from(buffer.subarray(0, bytesRead)));
    }
  }
  const buffer = Buffer.allocUnsafe(expectedSize);
  if (expectedSize === 0) return buffer;
  let total = 0;
  for (;;) {
    assertActive();
    const { bytesRead } = await read(buffer, total, expectedSize - total);
    if (bytesRead === 0) return buffer.subarray(0, total);
    total += bytesRead;
    if (total > maxBytes) return undefined;
    if (total === expectedSize) return buffer;
  }
};
