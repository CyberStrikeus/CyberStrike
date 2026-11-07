import { open, type FileHandle } from "node:fs/promises";
import { vi } from "vitest";

type PositionalFileRead = (
  this: FileHandle,
  ...args: [Buffer, number, number, number | null]
) => Promise<{ readonly bytesRead: number; readonly buffer: Buffer }>;

/** Fail one selected descriptor read after aborting with an independently chosen reason. */
export const failFileReadAfterAbort = async (
  path: string,
  controller: AbortController,
  abortReason: unknown,
  physicalCause: unknown,
): Promise<void> => {
  const probe = await open(path, "r");
  const identity = await probe.stat();
  const prototype = Object.getPrototypeOf(probe) as {
    read: PositionalFileRead;
  };
  await probe.close();
  const originalRead = prototype.read;
  let failed = false;
  vi.spyOn(prototype, "read").mockImplementation(async function (
    this: FileHandle,
    ...args: [Buffer, number, number, number | null]
  ) {
    const current = await this.stat();
    if (
      !failed &&
      current.dev === identity.dev &&
      current.ino === identity.ino
    ) {
      failed = true;
      controller.abort(abortReason);
      throw physicalCause;
    }
    return originalRead.call(this, ...args);
  });
};
