import { ProviderCleanupError } from "../domain/providerCleanupError.js";
import type { AnalysisError } from "../domain/analysisErrorBase.js";
import type { JsonValue } from "../domain/jsonValue.js";
import { err, type Result } from "../domain/result.js";
import type { GhidraRequestOptions } from "./GhidraClientTypes.js";
import {
  GhidraSessionError,
  type GhidraSessionFailureFactory,
} from "./GhidraSessionError.js";

/** Result settled by one queued Ghidra Program request. */
export type GhidraQueuedRequestResult = Result<JsonValue, GhidraSessionError>;
/** Socket execution seam used after a request reaches the queue head. */
export type GhidraRequestExecutor = (
  method: string,
  parameters: JsonValue,
  options: GhidraRequestOptions,
) => Promise<GhidraQueuedRequestResult>;
/** Stop the provider session when an admitted operation is cancelled. */
export type GhidraActiveCancellationHandler = () => Promise<
  Result<null, AnalysisError>
>;

interface QueuedRequest {
  readonly method: string;
  readonly parameters: JsonValue;
  readonly options: GhidraRequestOptions;
  readonly resolve: (result: GhidraQueuedRequestResult) => void;
  readonly onAbort: (() => void) | undefined;
}

/** FIFO that admits one Ghidra Program request at a time. */
export class GhidraRequestQueue {
  readonly #queue: QueuedRequest[] = [];
  #active = false;
  #closedFailure: GhidraSessionError | undefined;

  constructor(
    private readonly execute: GhidraRequestExecutor,
    private readonly failure: GhidraSessionFailureFactory,
    private readonly onActiveCancellation: GhidraActiveCancellationHandler,
  ) {}

  /** Queue one request until it completes, is cancelled, or the session closes. */
  run(
    method: string,
    parameters: JsonValue,
    options: GhidraRequestOptions,
  ): Promise<GhidraQueuedRequestResult> {
    if (this.#closedFailure !== undefined)
      return Promise.resolve(err(this.#closedFailure));
    if (options.signal?.aborted === true)
      return Promise.resolve(err(this.#cancelled(options.signal)));
    return new Promise((resolve) => {
      let entry: QueuedRequest;
      const onAbort =
        options.signal === undefined
          ? undefined
          : () =>
              this.#rejectQueued(entry, err(this.#cancelled(options.signal)));
      entry = {
        method,
        parameters,
        options,
        resolve,
        onAbort,
      };
      this.#queue.push(entry);
      if (onAbort !== undefined)
        options.signal?.addEventListener("abort", onAbort, { once: true });
      this.#drain();
    });
  }

  /** Fail requests that have not crossed the socket during session cleanup. */
  failQueued(failure: GhidraSessionError): void {
    this.#closedFailure = failure;
    for (const entry of this.#queue.splice(0)) {
      this.#release(entry);
      entry.resolve(err(failure));
    }
  }

  /** Admit requests after the owning client completes a new session startup. */
  reopen(): void {
    this.#closedFailure = undefined;
  }

  #drain(): void {
    if (this.#active) return;
    const entry = this.#queue.shift();
    if (entry === undefined) return;
    this.#release(entry);
    if (entry.options.signal?.aborted === true) {
      entry.resolve(err(this.#cancelled(entry.options.signal)));
      this.#drain();
      return;
    }
    this.#active = true;
    void this.#executeEntry(entry)
      .then(entry.resolve)
      .finally(() => {
        this.#active = false;
        if (this.#closedFailure === undefined) this.#drain();
      });
  }

  async #executeEntry(
    entry: QueuedRequest,
  ): Promise<GhidraQueuedRequestResult> {
    let cancellation:
      | {
          readonly failure: GhidraSessionError;
          readonly cleanup: Promise<
            | {
                readonly kind: "returned";
                readonly value: Result<null, AnalysisError>;
              }
            | { readonly kind: "rejected"; readonly cause: unknown }
          >;
        }
      | undefined;
    const onAbort = (): void => {
      this.failQueued(
        this.failure(
          "process",
          "Ghidra session closed after active request cancellation",
        ),
      );
      cancellation = {
        failure: this.#cancelled(entry.options.signal),
        // Capture rejection immediately, including a synchronous callback throw.
        // Execution and finalization may settle in either order.
        cleanup: Promise.resolve()
          .then(() => this.onActiveCancellation())
          .then(
            (value) => ({ kind: "returned", value }),
            (cause: unknown) => ({ kind: "rejected", cause }),
          ),
      };
    };
    entry.options.signal?.addEventListener("abort", onAbort, { once: true });
    try {
      let result: GhidraQueuedRequestResult;
      try {
        result = await this.execute(
          entry.method,
          entry.parameters,
          entry.options,
        );
      } catch (cause: unknown) {
        result = err(
          cause instanceof GhidraSessionError
            ? cause
            : this.failure(
                "protocol",
                "Ghidra serial request execution rejected unexpectedly",
                cause,
              ),
        );
      }
      if (cancellation === undefined) return result;
      // An observed bridge reply stays primary, but it must carry the session
      // close so its projection does not promise that the session is usable.
      const primary = result.ok
        ? cancellation.failure
        : result.error.kind === "remote"
          ? result.error.withConcurrentCancellation({
              reason: entry.options.signal?.reason,
            })
          : result.error;
      const cleanup = await cancellation.cleanup;
      if (cleanup.kind === "rejected")
        return err(
          this.#withUnexpectedCleanupRejection(primary, cleanup.cause),
        );
      return err(
        cleanup.value.ok
          ? primary
          : primary.withCleanupFailure(cleanup.value.error),
      );
    } finally {
      entry.options.signal?.removeEventListener("abort", onAbort);
    }
  }

  #cancelled(signal: AbortSignal | undefined): GhidraSessionError {
    return this.failure(
      "cancelled",
      "Ghidra request was cancelled",
      signal?.reason,
      signal === undefined ? {} : { cancellation: { reason: signal.reason } },
    );
  }

  #rejectQueued(entry: QueuedRequest, result: GhidraQueuedRequestResult): void {
    const index = this.#queue.indexOf(entry);
    if (index < 0) return;
    this.#queue.splice(index, 1);
    this.#release(entry);
    entry.resolve(result);
  }

  #withUnexpectedCleanupRejection(
    primary: GhidraSessionError,
    cause: unknown,
  ): GhidraSessionError {
    const described = this.failure(primary.kind, primary.message, cause);
    const rejection = described.diagnostics.failure_cause;
    const cleanupFailure = new ProviderCleanupError(
      "ghidra",
      ["Ghidra cancellation cleanup"],
      {
        reason: "Cancellation cleanup rejected before release was confirmed",
        unexpected_cleanup_rejection: rejection ?? { type: typeof cause },
      },
      { cause },
    );
    return primary.withCleanupFailure(cleanupFailure, {
      ...primary.diagnostics,
      unexpected_cleanup_rejection: rejection ?? { type: typeof cause },
    });
  }

  #release(entry: QueuedRequest): void {
    if (entry.options.signal !== undefined && entry.onAbort !== undefined)
      entry.options.signal.removeEventListener("abort", entry.onAbort);
  }
}
