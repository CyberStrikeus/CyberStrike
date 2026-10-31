/** An Android checkpoint observed interruption; the caller's reason stays opaque. */
export class JadxInterruption extends Error {
  constructor(readonly reason: unknown) {
    super("Android operation interrupted", { cause: reason });
    this.name = "AbortError";
  }
}

export const throwIfJadxInterrupted = (signal?: AbortSignal): void => {
  if (signal?.aborted === true) throw new JadxInterruption(signal.reason);
};
