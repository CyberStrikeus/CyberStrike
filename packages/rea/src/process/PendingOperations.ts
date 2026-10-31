import { ProcessAdmissionError } from "./ProcessAdmissionError.js";

/** Timeout and cancellation projections for one correlated operation. */
export type PendingOperationOptions<Value> = {
  readonly signal?: AbortSignal;
  readonly cancelledValue: () => Value;
} & (
  | { readonly timeoutMs: number; readonly timeoutValue: () => Value }
  | { readonly timeoutMs?: never; readonly timeoutValue?: never }
);

interface PendingOperation<Value> {
  readonly resolve: (value: Value) => void;
  readonly timer: NodeJS.Timeout | undefined;
  readonly signal: AbortSignal | undefined;
  readonly onAbort: (() => void) | undefined;
}

/**
 * Correlates event-driven provider replies with bounded waits.
 *
 * The registry owns optional request timers and cancellation listeners.
 * Settling, timing out, cancelling, or failing removes these before resolution.
 */
export class PendingOperations<Key, Value> {
  readonly #pending = new Map<Key, PendingOperation<Value>>();

  /** Number of currently correlated operations. */
  get size(): number {
    return this.#pending.size;
  }

  /** Return whether an operation key is awaiting a protocol reply. */
  has(key: Key): boolean {
    return this.#pending.has(key);
  }

  /** Register one unique operation key and await its reply or cancellation. */
  wait(key: Key, options: PendingOperationOptions<Value>): Promise<Value> {
    if (this.#pending.has(key))
      throw new ProcessAdmissionError("duplicate_key");
    if (options.signal?.aborted === true)
      return Promise.resolve(options.cancelledValue());

    return new Promise((resolve) => {
      const onAbort =
        options.signal === undefined
          ? undefined
          : () => this.#finish(key, options.cancelledValue());
      const timer =
        options.timeoutMs === undefined
          ? undefined
          : setTimeout(
              () => this.#finish(key, options.timeoutValue()),
              options.timeoutMs,
            );
      this.#pending.set(key, {
        resolve,
        timer,
        signal: options.signal,
        onAbort,
      });
      if (onAbort !== undefined)
        options.signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  /** Settle one correlated reply; returns false for late or unknown keys. */
  settle(key: Key, value: Value): boolean {
    return this.#finish(key, value);
  }

  /** Fail every active operation while releasing all timers and listeners. */
  failAll(valueFor: (key: Key) => Value): void {
    for (const key of this.#pending.keys()) this.#finish(key, valueFor(key));
  }

  #finish(key: Key, value: Value): boolean {
    const pending = this.#pending.get(key);
    if (pending === undefined) return false;
    this.#pending.delete(key);
    if (pending.timer !== undefined) clearTimeout(pending.timer);
    if (pending.signal !== undefined && pending.onAbort !== undefined)
      pending.signal.removeEventListener("abort", pending.onAbort);
    pending.resolve(value);
    return true;
  }
}
