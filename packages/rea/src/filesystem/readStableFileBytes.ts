import type { FileHandle } from "node:fs/promises";
import {
  assertRegularFileActive,
  RegularFileChangedError,
  assertStableRegularFileIdentity,
} from "./RegularFile.js";

/** Resource refusal carries the observed extent before allocating file bytes. */
export class RegularFileCapacityError extends Error {
  readonly _tag = "RegularFileCapacityError";
  constructor(
    readonly path: string,
    readonly maximumBytes: number,
    readonly observedBytes: bigint,
  ) {
    super(`Selected file must be at most ${maximumBytes} bytes: ${path}`);
    this.name = this._tag;
  }
}

interface StableReadOptions {
  readonly signal?: AbortSignal;
  readonly symlinks: "follow" | "reject";
}

/** Read an admitted descriptor completely, checking its extent and selected name. */
export const readStableFileBytes = async (
  file: FileHandle,
  path: string,
  maximumBytes: number,
  options: StableReadOptions,
): Promise<Buffer> => {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0)
    throw new RangeError(
      "Maximum file bytes must be a nonnegative safe integer",
    );
  assertRegularFileActive(options.signal);
  const before = await file.stat({ bigint: true });
  if (before.size > BigInt(maximumBytes))
    throw new RegularFileCapacityError(path, maximumBytes, before.size);
  const bytes = await readExtent(
    file,
    path,
    Number(before.size),
    options.signal,
  );
  assertRegularFileActive(options.signal);
  const extra = Buffer.alloc(1);
  if ((await file.read(extra, 0, 1, bytes.length)).bytesRead !== 0)
    throw new RegularFileChangedError(path);
  await assertStableRegularFileIdentity(file, path, before, options);
  return bytes;
};

/** Read only the requested prefix, retaining the validated full file extent. */
export const readStableFilePrefix = async (
  file: FileHandle,
  path: string,
  maximumBytes: number,
  options: StableReadOptions,
): Promise<{ readonly bytes: Buffer; readonly size: bigint }> => {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0)
    throw new RangeError(
      "Maximum prefix bytes must be a nonnegative safe integer",
    );
  assertRegularFileActive(options.signal);
  const before = await file.stat({ bigint: true });
  const length = Number(
    before.size < BigInt(maximumBytes) ? before.size : BigInt(maximumBytes),
  );
  const bytes = await readExtent(file, path, length, options.signal);
  await assertStableRegularFileIdentity(file, path, before, options);
  return { bytes, size: before.size };
};

const readExtent = async (
  file: FileHandle,
  path: string,
  length: number,
  signal?: AbortSignal,
): Promise<Buffer> => {
  assertRegularFileActive(signal);
  const bytes = Buffer.alloc(length);
  let offset = 0;
  while (offset < bytes.length) {
    assertRegularFileActive(signal);
    const read = await file.read({
      buffer: bytes,
      offset,
      length: bytes.length - offset,
      position: offset,
    });
    if (read.bytesRead === 0) throw new RegularFileChangedError(path);
    offset += read.bytesRead;
  }
  assertRegularFileActive(signal);
  return bytes;
};
