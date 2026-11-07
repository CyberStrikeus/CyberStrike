import type { FileHandle } from "node:fs/promises";

/** Compare descriptor bytes without taking ownership or validating pathname identity. */
export const fileHandleMatchesBytes = async (
  handle: Pick<FileHandle, "stat" | "read">,
  expected: Buffer,
): Promise<boolean> => {
  if ((await handle.stat()).size !== expected.length) return false;
  const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, expected.length));
  for (let position = 0; position < expected.length;) {
    const { bytesRead } = await handle.read(
      chunk,
      0,
      Math.min(chunk.length, expected.length - position),
      position,
    );
    if (
      bytesRead === 0 ||
      !chunk
        .subarray(0, bytesRead)
        .equals(expected.subarray(position, position + bytesRead))
    )
      return false;
    position += bytesRead;
  }
  return true;
};
