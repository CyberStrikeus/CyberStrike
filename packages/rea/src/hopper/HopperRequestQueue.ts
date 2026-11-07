import type {
  ProgressReporter,
  ProgressUpdate,
} from "../application/ProgressReporter.js";
import { hopperOperationStage } from "./HopperOperationStage.js";
import type { HopperBridgeEvent } from "./protocol.js";
import {
  hopperCancelledBySignal,
  type HopperError,
  HopperProcessError,
  HopperProtocolError,
  HopperRemoteError,
  HopperTimeoutError,
} from "../domain/hopperErrors.js";
import type { JsonValue } from "../domain/jsonValue.js";
import { err, type Result } from "../domain/result.js";

export type HopperRequestResult = Result<JsonValue, HopperError>;

/** Node timer ceiling; larger deadlines would be clamped instead of honored. */
const MAX_TIMEOUT_MS = 2_147_483_647;

export interface HopperRequestQueueOptions {
  readonly signal?: AbortSignal;
  /** Caller deadline from admission, including time waiting in the FIFO. */
  readonly timeoutMs?: number;
  readonly progress?: ProgressReporter;
}

export interface HopperRequestActivity {
  readonly requestId: number;
  readonly operation: string;
  readonly elapsedMs: number;
  readonly callerState: "waiting" | "cancelled";
  readonly queuedRequests: number;
}

type RequestSender = (
  request: {
    readonly id: number;
    readonly method: string;
    readonly params: JsonValue;
  },
  failed: () => void,
) => void;

interface QueuedRequest {
  readonly id: number;
  readonly method: string;
  readonly params: JsonValue;
  readonly signal: AbortSignal | undefined;
  readonly progress: ProgressReporter | undefined;
  readonly resolve: (result: HopperRequestResult) => void;
  readonly onAbort: (() => void) | undefined;
  callerState: "waiting" | "cancelled";
  callerSettled: boolean;
  transmitted: boolean;
  startedAt: number | undefined;
  heartbeat: NodeJS.Timeout | undefined;
  deadline: NodeJS.Timeout | undefined;
  readonly deadlineAt: number | undefined;
  readonly timeoutMs: number | undefined;
}

/** FIFO that keeps the wire serialized until Hopper actually replies. */
export class HopperRequestQueue {
  readonly #queue: QueuedRequest[] = [];
  #active: QueuedRequest | undefined;

  constructor(private readonly send: RequestSender) {}

  /** Settle the caller on reply, cancellation, or deadline; retain active wire work. */
  run(
    id: number,
    method: string,
    params: JsonValue,
    options: HopperRequestQueueOptions,
  ): Promise<HopperRequestResult> {
    if (options.signal?.aborted === true)
      return Promise.resolve(err(hopperCancelledBySignal(options.signal)));
    const timeoutMs = options.timeoutMs;
    if (
      timeoutMs !== undefined &&
      (!Number.isInteger(timeoutMs) ||
        timeoutMs < 0 ||
        timeoutMs > MAX_TIMEOUT_MS)
    )
      return Promise.resolve(
        err(
          new HopperProtocolError(
            `Hopper timeoutMs must be an integer between 0 and ${String(MAX_TIMEOUT_MS)}`,
          ),
        ),
      );
    if (timeoutMs === 0)
      return Promise.resolve(
        err(
          new HopperTimeoutError(
            0,
            method,
            id,
            "not_started",
            hopperOperationStage(method),
          ),
        ),
      );
    return new Promise((resolve) => {
      let entry: QueuedRequest;
      const onAbort =
        options.signal === undefined ? undefined : () => this.#cancel(entry);
      entry = {
        id,
        method,
        params,
        signal: options.signal,
        progress: options.progress,
        resolve,
        onAbort,
        callerState: "waiting",
        callerSettled: false,
        transmitted: false,
        startedAt: undefined,
        heartbeat: undefined,
        deadline: undefined,
        deadlineAt:
          timeoutMs === undefined ? undefined : performance.now() + timeoutMs,
        timeoutMs,
      };
      this.#queue.push(entry);
      if (onAbort !== undefined)
        options.signal?.addEventListener("abort", onAbort, { once: true });
      if (timeoutMs !== undefined)
        entry.deadline = setTimeout(
          () => this.#cancel(entry, this.#timeoutError(entry, timeoutMs)),
          timeoutMs,
        );
      if (this.#active !== undefined || this.#queue.length > 1)
        this.#report(
          entry,
          `${method} queued behind ${String(this.#size() - 1)} Hopper request(s)`,
        );
      this.#drain();
    });
  }

  /** Settle the active wire request. False identifies an unexpected response id. */
  accept(id: number, result: HopperRequestResult): boolean {
    const entry = this.#active;
    if (entry === undefined || entry.id !== id) return false;
    this.#expireIfElapsed(entry);
    this.#releaseWire(entry);
    if (!entry.callerSettled)
      this.#settleCaller(
        entry,
        result.ok ? result : err(withRequestContext(result.error, entry)),
        "waiting",
      );
    this.#active = undefined;
    this.#drain();
    return true;
  }

  /** Forward one correlated bridge event without releasing the wire request. */
  acceptEvent(event: HopperBridgeEvent): boolean {
    const entry = this.#active;
    if (entry === undefined || entry.id !== event.id) return false;
    if (event.event.type === "progress" && !entry.callerSettled) {
      if (event.event.terminal === true && entry.heartbeat !== undefined) {
        clearInterval(entry.heartbeat);
        entry.heartbeat = undefined;
      }
      this.#reportUpdate(entry, {
        phase: event.event.phase,
        completed: event.event.completed,
        total: event.event.total,
        message: event.event.message,
        ...(event.event.terminal === undefined
          ? {}
          : { terminal: event.event.terminal }),
      });
    }
    return true;
  }

  /** Fail the active wire request and every request still waiting in the FIFO. */
  failAll(error: HopperError): void {
    const active = this.#active;
    this.#active = undefined;
    if (active !== undefined) {
      this.#releaseWire(active);
      if (!active.callerSettled)
        this.#settleCaller(
          active,
          err(withRequestContext(error, active)),
          "waiting",
        );
    }
    for (const entry of this.#queue.splice(0))
      this.#settleCaller(
        entry,
        err(withRequestContext(error, entry)),
        "waiting",
      );
  }

  /** Snapshot the one request still occupying Hopper's serial Python thread. */
  activity(): HopperRequestActivity | null {
    const active = this.#active;
    if (active === undefined || active.startedAt === undefined) return null;
    return {
      requestId: active.id,
      operation: active.method,
      elapsedMs: Math.max(0, Math.round(performance.now() - active.startedAt)),
      callerState: active.callerState,
      queuedRequests: this.#queue.length,
    };
  }

  /** Return whether an id belongs to a request that has not crossed the wire. */
  hasQueued(id: number): boolean {
    return this.#queue.some((entry) => entry.id === id);
  }

  /** Number of caller requests waiting behind the active bridge operation. */
  queuedCount(): number {
    return this.#queue.length;
  }

  #size(): number {
    return this.#queue.length + (this.#active === undefined ? 0 : 1);
  }

  #drain(): void {
    if (this.#active !== undefined) return;
    const entry = this.#queue.shift();
    if (entry === undefined) return;
    if (this.#expireIfElapsed(entry)) {
      this.#drain();
      return;
    }
    if (entry.signal?.aborted === true) {
      this.#settleCaller(
        entry,
        err(hopperCancelledBySignal(entry.signal)),
        "cancelled",
      );
      this.#drain();
      return;
    }
    this.#active = entry;
    entry.startedAt = performance.now();
    this.#report(entry, `${entry.method} started on Hopper's serial bridge`);
    this.#expireIfElapsed(entry);
    // A progress observer may cancel or tear down synchronously before send.
    // No native work exists yet, so it is safe to release this reserved slot.
    if (this.#active !== entry || entry.callerSettled) {
      if (this.#active === entry) {
        this.#active = undefined;
        this.#releaseWire(entry);
        this.#drain();
      }
      return;
    }
    entry.heartbeat = setInterval(() => {
      if (entry.callerSettled || entry.startedAt === undefined) return;
      const elapsed = Math.round(performance.now() - entry.startedAt);
      this.#report(
        entry,
        `${entry.method} is still running in Hopper (${String(elapsed)} ms elapsed)`,
      );
    }, 1_000);
    try {
      entry.transmitted = true;
      this.send(
        {
          id: entry.id,
          method: entry.method,
          params: entry.params,
        },
        () =>
          this.accept(
            entry.id,
            err(
              new HopperProcessError(null, {
                operation: entry.method,
                requestId: entry.id,
                providerState: "unreachable",
                stage: hopperOperationStage(entry.method),
              }),
            ),
          ),
      );
    } catch (cause: unknown) {
      this.accept(
        entry.id,
        err(new HopperProtocolError("Hopper socket write failed", { cause })),
      );
    }
  }

  #timeoutError(entry: QueuedRequest, timeoutMs: number): HopperTimeoutError {
    return new HopperTimeoutError(
      timeoutMs,
      entry.method,
      entry.id,
      entry.transmitted ? "busy" : "not_started",
      hopperOperationStage(entry.method),
    );
  }

  #expireIfElapsed(entry: QueuedRequest): boolean {
    if (
      entry.deadlineAt !== undefined &&
      entry.timeoutMs !== undefined &&
      performance.now() >= entry.deadlineAt
    )
      this.#settleCaller(
        entry,
        err(this.#timeoutError(entry, entry.timeoutMs)),
        "cancelled",
      );
    return entry.callerSettled;
  }

  #cancel(
    entry: QueuedRequest,
    error: HopperError = hopperCancelledBySignal(entry.signal),
  ): void {
    if (entry.callerSettled) return;
    if (this.#active === entry) {
      this.#settleCaller(entry, err(error), "cancelled");
      return;
    }
    const index = this.#queue.indexOf(entry);
    if (index < 0) return;
    this.#queue.splice(index, 1);
    this.#settleCaller(entry, err(error), "cancelled");
  }

  #settleCaller(
    entry: QueuedRequest,
    result: HopperRequestResult,
    callerState: QueuedRequest["callerState"],
  ): void {
    if (entry.callerSettled) return;
    entry.callerSettled = true;
    entry.callerState = callerState;
    if (entry.deadline !== undefined) clearTimeout(entry.deadline);
    entry.deadline = undefined;
    if (this.#active === entry && entry.heartbeat !== undefined) {
      clearInterval(entry.heartbeat);
      entry.heartbeat = undefined;
    }
    if (entry.signal !== undefined && entry.onAbort !== undefined)
      entry.signal.removeEventListener("abort", entry.onAbort);
    entry.resolve(result);
  }

  #releaseWire(entry: QueuedRequest): void {
    if (entry.heartbeat !== undefined) clearInterval(entry.heartbeat);
    entry.heartbeat = undefined;
    if (entry.signal !== undefined && entry.onAbort !== undefined)
      entry.signal.removeEventListener("abort", entry.onAbort);
  }

  #report(entry: QueuedRequest, message: string): void {
    this.#reportUpdate(entry, {
      phase: "hopper_request",
      completed: 0,
      total: 1,
      message,
    });
  }

  #reportUpdate(entry: QueuedRequest, update: ProgressUpdate): void {
    try {
      void Promise.resolve(entry.progress?.report(update)).catch(
        (cause: unknown) => {
          // best-effort cleanup: progress rejection bookkeeping only.
          void cause;
        },
      );
    } catch (cause: unknown) {
      // Progress observation cannot change the request outcome.
      void cause;
    }
  }
}

const withRequestContext = (
  error: HopperError,
  entry: QueuedRequest,
): HopperError => {
  if (error instanceof HopperProcessError)
    return new HopperProcessError(error.exitCode, {
      ...error,
      cause: error.cause,
      operation: error.operation ?? entry.method,
      requestId: error.requestId ?? entry.id,
      stage:
        error.operation === undefined && error.stage === "connection"
          ? hopperOperationStage(entry.method)
          : error.stage,
    });
  if (error instanceof HopperRemoteError)
    return new HopperRemoteError(error.code, error.safeMessage, {
      ...error,
      cause: error.cause,
      operation: error.operation ?? entry.method,
      requestId: error.requestId ?? entry.id,
    });
  return error;
};
