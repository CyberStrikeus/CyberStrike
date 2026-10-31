/** Sentinel returned when an abort signal wins an asynchronous race. */
export const ABORTED = Symbol("aborted");

/**
 * Await a promise without depending on the producer to observe cancellation.
 * The producer still receives its signal separately and remains responsible for
 * releasing any resources that it owns.
 */
export const waitForAbortable = async <Value>(
  pending: Promise<Value>,
  signal: AbortSignal | undefined,
): Promise<Value | typeof ABORTED> => {
  if (signal === undefined) return pending;
  let onAbort: (() => void) | undefined;
  const cancelled = new Promise<typeof ABORTED>((resolve) => {
    if (signal.aborted) {
      resolve(ABORTED);
      return;
    }
    onAbort = () => resolve(ABORTED);
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    // Even an already-cancelled wait must own the producer's eventual rejection.
    return await Promise.race([cancelled, pending]);
  } finally {
    if (onAbort !== undefined) signal.removeEventListener("abort", onAbort);
  }
};
