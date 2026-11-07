import { constants } from "node:fs";
import { open } from "node:fs/promises";

type FifoReadOutcome<T> =
  | { state: "completed"; result: T }
  | { state: "timed-out" };

/** Bound a writer-free FIFO regression and release a blocking reader on failure. */
export const readWithoutFifoWriter = async <T>(
  fifoPath: string,
  read: () => Promise<T>,
): Promise<FifoReadOutcome<T>> => {
  const pending = read();
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      pending.then((result): FifoReadOutcome<T> => ({
        state: "completed",
        result,
      })),
      new Promise<FifoReadOutcome<T>>((resolve) => {
        timeout = setTimeout(() => resolve({ state: "timed-out" }), 1_000);
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
    // Release a blocking readFile open and await its EOF and cleanup.
    // O_RDWR also completes when the fixed reader has already rejected.
    const writer = await open(
      fifoPath,
      constants.O_RDWR | constants.O_NONBLOCK,
    );
    await writer.close();
    await pending;
  }
};
