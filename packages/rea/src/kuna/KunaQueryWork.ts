import type { AnalysisError } from "../domain/analysisErrorBase.js";
import {
  AnalysisCancelledError,
  AnalysisResourceConstraintError,
} from "../domain/analysisErrorCore.js";
import { err, type Result } from "../domain/result.js";
import { SharedStartupAttempt } from "../process/SharedStartupAttempt.js";
import {
  DEFAULT_REGEX_MATCHING_DEADLINE,
  type RegexMatchingDeadline,
} from "../config/regexMatchingDeadline.js";
import {
  DEFAULT_REGEX_WORKER_HEAP_REQUEST,
  type RegexWorkerHeapRequest,
} from "../config/regexWorkerHeapRequest.js";
import { matchRegexValues } from "../process/RegexMatcher.js";
import type { KunaJsonDocumentReader } from "./KunaJsonStream.js";
import { KUNA_DIAGNOSTIC_BYTES } from "./KunaLimits.js";
import { KunaRunSlots } from "./KunaRunSlots.js";
import type {
  KunaTargetCommands,
  KunaTargetCommandRequest,
  KunaTargetCommandSnapshot,
} from "./KunaTargetCommands.js";

/** One shared producer; individual callers own only their wait. */
export type KunaPendingQuery<T> = SharedStartupAttempt<
  Result<T, AnalysisError>
>;

type RegexQuery = Omit<Parameters<typeof matchRegexValues>[0], "values"> & {
  readonly values: () => readonly string[];
};

/** Shared admission, cancellation and cleanup for session metadata queries. */
export class KunaQueryWork {
  readonly #nativeSlots = new KunaRunSlots(1);
  readonly #regexSlots = new KunaRunSlots(1);

  constructor(
    private readonly commands: KunaTargetCommands,
    private readonly lifetime: {
      readonly signal: AbortSignal;
      readonly own: <T>(work: Promise<T>) => Promise<T>;
      readonly runSlots: KunaRunSlots;
    },
    private readonly deadline: RegexMatchingDeadline = DEFAULT_REGEX_MATCHING_DEADLINE,
    private readonly heapRequest: RegexWorkerHeapRequest = DEFAULT_REGEX_WORKER_HEAP_REQUEST,
  ) {}

  /** Unproven process cleanup retains both leases in the native command owner. */
  async run(
    request: Omit<KunaTargetCommandRequest, "releaseRun">,
  ): Promise<Result<KunaTargetCommandSnapshot, AnalysisError>> {
    const local = await this.#nativeSlots.acquire(request.signal);
    if (local === undefined)
      return err(
        new AnalysisCancelledError(request.operation, {
          cause: request.signal.reason,
        }),
      );
    let release: (() => void) | undefined;
    try {
      const foreground = await this.lifetime.runSlots.acquire(request.signal);
      if (foreground === undefined) {
        local();
        return err(
          new AnalysisCancelledError(request.operation, {
            cause: request.signal.reason,
          }),
        );
      }
      release = () => {
        foreground();
        local();
      };
      return await this.commands.run({ ...request, releaseRun: release });
    } catch (cause: unknown) {
      if (release === undefined) local();
      else release();
      throw cause;
    }
  }

  /**
   * Run a whole-program command whose stdout `reader` validates as it
   * arrives. A rejected document stops Kuna and reports why; diagnostics
   * beyond their buffer recur for this target and executable, so they are
   * passed to `retain` for the session to keep.
   */
  async scan<Parsed>(
    request: Omit<
      KunaTargetCommandRequest,
      "releaseRun" | "outputBytes" | "stdout" | "signal"
    >,
    reader: KunaJsonDocumentReader<Parsed>,
    signal: AbortSignal,
    retain: (failure: AnalysisError) => void,
  ): Promise<Result<Parsed, AnalysisError>> {
    const run = await this.run({
      ...request,
      outputBytes: KUNA_DIAGNOSTIC_BYTES,
      stdout: reader,
      signal: AbortSignal.any([signal, reader.rejected]),
    });
    if (run.ok) return reader.finish(run.value.input);
    const rejection = reader.rejection;
    if (
      rejection !== undefined &&
      run.error instanceof AnalysisCancelledError &&
      !signal.aborted
    )
      return err(rejection);
    if (
      run.error instanceof AnalysisResourceConstraintError &&
      run.error.resource === "memory"
    )
      retain(run.error);
    return run;
  }

  /** Bound inventory copies and regex workers; close cancels and drains both. */
  match(input: RegexQuery): ReturnType<typeof matchRegexValues> {
    const signal = AbortSignal.any([
      this.lifetime.signal,
      ...(input.signal === undefined ? [] : [input.signal]),
    ]);
    return this.lifetime.own(this.#match(input, signal));
  }

  async #match(
    input: RegexQuery,
    signal: AbortSignal,
  ): ReturnType<typeof matchRegexValues> {
    const release = await this.#regexSlots.acquire(signal);
    if (release === undefined)
      return err(
        new AnalysisCancelledError(input.operation, { cause: signal.reason }),
      );
    try {
      return await matchRegexValues({
        ...input,
        values: input.values(),
        signal,
        deadline: this.deadline,
        heapRequest: this.heapRequest,
      });
    } finally {
      release();
    }
  }

  start<T>(
    load: (signal: AbortSignal) => Promise<Result<T, AnalysisError>>,
    accept: (value: T) => void,
  ): KunaPendingQuery<T> {
    const pending = new SharedStartupAttempt(
      (signal) => this.lifetime.own(load(signal)),
      this.lifetime.signal,
    );
    void pending.promise.then(
      (result) => {
        if (result.ok && !pending.signal.aborted) accept(result.value);
      },
      () => {},
    );
    return pending;
  }

  async wait<T>(
    pending: KunaPendingQuery<T>,
    signal: AbortSignal | undefined,
    operation: string,
  ): Promise<Result<T, AnalysisError>> {
    const waited = await pending.wait(signal);
    if (waited.status === "completed") return waited.value;
    // Final departure retains all producer failures, including a typed
    // cancellation with captured facts or incomplete cleanup.
    if (waited.status === "stopped" && !waited.value.ok) return waited.value;
    return err(
      new AnalysisCancelledError(operation, { cause: signal?.reason }),
    );
  }
}
