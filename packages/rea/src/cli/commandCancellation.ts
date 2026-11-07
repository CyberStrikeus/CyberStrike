/** Process signal boundary injectable without emitting signals into a test runner. */
export interface CommandCancellationHost {
  on(signal: "SIGINT" | "SIGTERM", listener: () => void): unknown;
  off(signal: "SIGINT" | "SIGTERM", listener: () => void): unknown;
  exitCode?: number | string | null | undefined;
}

/** Translate one-shot CLI interrupts into awaited cleanup and conventional exit codes. */
export const withCommandCancellation = async <Value>(
  operation: (signal: AbortSignal) => Promise<Value>,
  host: CommandCancellationHost = process,
): Promise<Value> => {
  const controller = new AbortController();
  let exitCode: number | undefined;
  const interrupt = () => {
    exitCode ??= 130;
    controller.abort();
  };
  const terminate = () => {
    exitCode ??= 143;
    controller.abort();
  };
  host.on("SIGINT", interrupt);
  host.on("SIGTERM", terminate);
  try {
    return await operation(controller.signal);
  } finally {
    host.off("SIGINT", interrupt);
    host.off("SIGTERM", terminate);
    if (exitCode !== undefined) host.exitCode = exitCode;
  }
};
