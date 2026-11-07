import { Buffer } from "node:buffer";

/**
 * Largest single argv or environment string Linux will pass to `execve` on a
 * 4 KiB page host. The kernel's `MAX_ARG_STRLEN` is 32 pages and includes the
 * trailing NUL, so the caller-visible budget is one byte smaller. GitHub
 * Actions runners use 4 KiB pages. One argument past this budget fails with
 * `E2BIG` before the process starts. The combined argv, environment, filename,
 * and pointer table must also fit in `ARG_MAX`, which shrinks with the stack.
 */
export const LINUX_4K_SINGLE_ARGUMENT_BYTES = 32 * 4096 - 1;

/**
 * Largest payload that fits this execve image.
 *
 * `fixedStringBytes` counts the filename, every argv string except the
 * payload, and every `KEY=value` environment string, each including its NUL.
 * `pointerCount` is `max(argc, 1) + envc`: Linux reserves that many native
 * pointers inside `ARG_MAX` before it copies strings. The payload's own NUL
 * is reserved here. The result is undefined when the fixed image already
 * fills `ARG_MAX`.
 */
export const acceptedSpawnPayloadBytes = (input: {
  readonly pageSize: number;
  readonly argMax: number;
  readonly pointerBytes: number;
  readonly pointerCount: number;
  readonly fixedStringBytes: number;
}): number | undefined => {
  for (const [name, value] of [
    ["pageSize", input.pageSize],
    ["argMax", input.argMax],
    ["pointerBytes", input.pointerBytes],
    ["pointerCount", input.pointerCount],
    ["fixedStringBytes", input.fixedStringBytes],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 0)
      throw new Error(`${name} must be a non-negative safe integer`);
  }
  if (input.pageSize < 1 || input.pointerBytes < 1 || input.pointerCount < 1)
    throw new Error(
      "page size, pointer size, and pointer count must be positive",
    );
  const singleStringBytes = 32 * input.pageSize - 1;
  const aggregatePayload =
    input.argMax -
    input.pointerCount * input.pointerBytes -
    input.fixedStringBytes -
    1;
  if (aggregatePayload < 1) return undefined;
  return Math.min(singleStringBytes, aggregatePayload);
};

/** Require every argv string to fit in the Linux single-argument budget. */
export const assertSpawnArgumentsWithinLimit = (
  arguments_: readonly string[],
): void => {
  for (const argument of arguments_) {
    const bytes = Buffer.byteLength(argument);
    if (bytes > LINUX_4K_SINGLE_ARGUMENT_BYTES) {
      throw new Error(
        `spawn argument is ${bytes} bytes; one Linux argument above ${LINUX_4K_SINGLE_ARGUMENT_BYTES} bytes fails with E2BIG before the process starts. Pass the payload through a file.`,
      );
    }
  }
};
