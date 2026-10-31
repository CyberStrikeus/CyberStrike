import { open, type FileHandle } from "node:fs/promises";
import { vi } from "vitest";

/** Pause after one selected file chunk reaches the operating system. */
export const holdFirstFileRead = async (path: string) => {
  const probe = await open(path, "r");
  const identity = await probe.stat();
  const fileHandlePrototype = Object.getPrototypeOf(probe) as {
    read(
      buffer: Buffer,
      offset: number,
      length: number,
      position: number | null,
    ): Promise<{ readonly bytesRead: number; readonly buffer: Buffer }>;
  };
  await probe.close();
  let totalReadBytes = 0;
  let readCount = 0;
  let resolveFirstRead: (() => void) | undefined;
  const firstRead = new Promise<void>((resolve) => {
    resolveFirstRead = resolve;
  });
  let releaseRead: (() => void) | undefined;
  const readGate = new Promise<void>((resolve) => {
    releaseRead = resolve;
  });
  const read = fileHandlePrototype.read;
  vi.spyOn(fileHandlePrototype, "read").mockImplementation(async function (
    this: FileHandle,
    ...args: [Buffer, number, number, number | null]
  ) {
    const current = await this.stat();
    const isTarget =
      current.dev === identity.dev && current.ino === identity.ino;
    const result = await read.call(this, ...args);
    if (!isTarget) return result;
    totalReadBytes += result.bytesRead;
    readCount += 1;
    if (readCount === 1) {
      resolveFirstRead?.();
      await readGate;
    }
    return result;
  });
  return {
    firstRead,
    release: () => releaseRead?.(),
    get readCount() {
      return readCount;
    },
    get totalReadBytes() {
      return totalReadBytes;
    },
  };
};
