import { BrowserObservationError } from "../domain/browserObservationError.js";

const OPERATION = "capture_electron_scenario" as const;

/** Apply an optional lifecycle deadline and caller cancellation to an operation. */
export const runWithExecutionLimits = async <Value>(
  operation: Promise<Value>,
  signal: AbortSignal | undefined,
  deadline?: number,
): Promise<Value> => {
  if (signal?.aborted === true) {
    // The operation has already started; observe its abandoned settlement.
    void operation.catch(() => undefined);
    throw new BrowserObservationError(OPERATION, "cancelled", {
      cause: signal.reason,
    });
  }
  if (signal === undefined && deadline === undefined) return operation;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abortListener: (() => void) | undefined;
  const interruptions: Promise<never>[] = [];
  if (deadline !== undefined)
    interruptions.push(
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new BrowserObservationError(OPERATION, "timeout")),
          Math.max(1, deadline - performance.now()),
        );
      }),
    );
  if (signal !== undefined)
    interruptions.push(
      new Promise<never>((_, reject) => {
        abortListener = () =>
          reject(
            new BrowserObservationError(OPERATION, "cancelled", {
              cause: signal.reason,
            }),
          );
        signal.addEventListener("abort", abortListener, { once: true });
      }),
    );
  try {
    return interruptions.length === 0
      ? await operation
      : await Promise.race([operation, ...interruptions]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (abortListener !== undefined)
      signal?.removeEventListener("abort", abortListener);
  }
};
