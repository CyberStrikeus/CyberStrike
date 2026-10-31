import { ABORTED, waitForAbortable } from "./AbortablePromise.js";

/** An owner closing a provider is distinct from a caller cancelling its wait. */
export const STARTUP_OWNER_CLOSED = Symbol("provider startup owner closed");

/** The final departing caller retains the producer's complete cleanup result. */
export type SharedStartupWait<Value> =
  | { readonly status: "completed"; readonly value: Value }
  | { readonly status: "cancelled" }
  | { readonly status: "stopped"; readonly value: Value };

type StartupSettlement<Value> =
  | { readonly status: "pending" }
  | { readonly status: "completed"; readonly value: Value }
  | { readonly status: "rejected" };

/** Own one startup operation while its callers wait independently. */
export class SharedStartupAttempt<Value> {
  readonly #controller = new AbortController();
  readonly promise: Promise<Value>;
  readonly #signal: AbortSignal;
  #waiters = 0;
  #settlement: StartupSettlement<Value> = { status: "pending" };

  constructor(
    start: (signal: AbortSignal) => Promise<Value>,
    /** An owning operation's cancellation is independent of individual waiters. */
    ownerSignal?: AbortSignal,
  ) {
    this.#signal =
      ownerSignal === undefined
        ? this.#controller.signal
        : AbortSignal.any([ownerSignal, this.#controller.signal]);
    this.promise = start(this.#signal);
    void this.promise.then(
      (value) => {
        this.#settlement = { status: "completed", value };
      },
      () => {
        this.#settlement = { status: "rejected" };
      },
    );
  }

  /** Signal consumed by the startup producer, never by an individual waiter. */
  get signal(): AbortSignal {
    return this.#signal;
  }

  /** Completion includes the producer's final cleanup, not just its abort. */
  get settled(): boolean {
    return this.#settlement.status !== "pending";
  }

  /** Parsed completion facts are owned here, rather than copied into adapters. */
  get settlement(): StartupSettlement<Value> {
    return this.#settlement;
  }

  /** Stop startup when its owning provider closes, regardless of active waits. */
  close(): void {
    if (!this.settled) this.#controller.abort(STARTUP_OWNER_CLOSED);
  }

  /** A peer's departure leaves the producer running; final departure joins cleanup. */
  async wait(signal?: AbortSignal): Promise<SharedStartupWait<Value>> {
    this.#waiters += 1;
    try {
      const waited = await waitForAbortable(this.promise, signal);
      if (waited !== ABORTED) return { status: "completed", value: waited };
      if (this.#waiters > 1) return { status: "cancelled" };
      if (!this.settled) this.#controller.abort(signal?.reason);
      return { status: "stopped", value: await this.promise };
    } finally {
      this.#waiters -= 1;
    }
  }
}
