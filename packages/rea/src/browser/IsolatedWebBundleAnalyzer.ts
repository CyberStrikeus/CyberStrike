import type { WebPageInspection } from "../domain/browserObservationSchemas.js";
import {
  DEFAULT_WEB_BUNDLE_HEAP_MB,
  DEFAULT_WEB_BUNDLE_SCRIPT_TIMEOUT_MS,
  DEFAULT_WEB_BUNDLE_TOTAL_TIMEOUT_MS,
  webBundleTotalTimeoutRecovery,
  type AnalyzeWebBundleInput,
  type WebBundleAnalysis,
} from "../domain/webBundleAnalysis.js";
import { buildCapturedWebBundleAnalysis } from "../domain/webBundleAnalyzerResult.js";
import { isIncludedScript } from "../domain/webBundleAnalyzerState.js";
import type { WebBundleScriptAnalysis } from "../domain/webBundleScriptAnalysis.js";
import { AnalysisError } from "../domain/analysisErrorBase.js";
import {
  AnalysisCapabilityUnavailableError,
  AnalysisCancelledError,
  AnalysisTimeoutError,
  AnalysisResourceConstraintError,
  AnalysisOutputError,
} from "../domain/analysisErrorCore.js";
import { analysisErrorWithCleanupFailure } from "../domain/analysisErrorCleanup.js";
import { ProviderCleanupError } from "../domain/providerCleanupError.js";
import { err, ok, type Result } from "../domain/result.js";
import { ProviderStartupDeadline } from "../process/ProviderDeadline.js";
import {
  WebBundleAnalysisWorker,
  WebBundleWorkerCleanup,
} from "./WebBundleAnalysisWorker.js";

export type WebBundleAnalysisWorkerPort = Pick<
  WebBundleAnalysisWorker,
  "analyze" | "close"
>;

/**
 * One host's web-analyzer permit and failed-cleanup set. Independent
 * admissions do not share a reservation.
 */
export class WebBundleAnalysisAdmission {
  readonly workers = new WebBundleWorkerCleanup();
  #active: IsolatedWebBundleAnalyzer | undefined;
  readonly #pendingCleanup = new Set<IsolatedWebBundleAnalyzer>();

  active(): IsolatedWebBundleAnalyzer | undefined {
    return this.#active;
  }

  hold(analyzer: IsolatedWebBundleAnalyzer): void {
    this.#active = analyzer;
  }

  release(analyzer: IsolatedWebBundleAnalyzer): void {
    if (this.#active === analyzer) this.#active = undefined;
  }

  pending(): readonly IsolatedWebBundleAnalyzer[] {
    return [...this.#pendingCleanup];
  }

  retain(analyzer: IsolatedWebBundleAnalyzer): void {
    this.#pendingCleanup.add(analyzer);
  }

  forget(analyzer: IsolatedWebBundleAnalyzer): void {
    this.#pendingCleanup.delete(analyzer);
  }
}

/** Own one bundle's sequential analysis and finalization through provider close. */
export class IsolatedWebBundleAnalyzer {
  readonly #admission: WebBundleAnalysisAdmission;
  #closed = false;
  #running: Promise<Result<WebBundleAnalysis, AnalysisError>> | undefined;
  #controller: AbortController | undefined;
  #worker: WebBundleAnalysisWorkerPort | undefined;

  readonly createWorker: (heapMb: number) => WebBundleAnalysisWorkerPort;

  constructor(
    createWorker?: (heapMb: number) => WebBundleAnalysisWorkerPort,
    admission: WebBundleAnalysisAdmission = new WebBundleAnalysisAdmission(),
  ) {
    this.#admission = admission;
    this.createWorker =
      createWorker ??
      ((heapMb) =>
        new WebBundleAnalysisWorker(heapMb, undefined, admission.workers));
  }

  /** Reserve capacity before capture, so concurrent captures cannot retain source inventories. */
  async reserve(): Promise<Result<void, AnalysisError>> {
    if (this.#closed)
      return err(new AnalysisCancelledError("analyze_web_bundle"));
    if (this.#admission.active() !== undefined)
      return err(
        new AnalysisResourceConstraintError(
          "analyze_web_bundle",
          "capacity",
          "Another web-bundle capture or analysis owns this admission's source and result reservation",
          { concurrent_web_bundle_analyses: 1 },
        ),
      );
    // Claim the slot before awaiting cleanup so another host cannot pass the check.
    this.#admission.hold(this);
    try {
      for (const owner of this.#admission.pending())
        await owner.#releaseWorker();
      await this.#admission.workers.retry();
      await this.#releaseWorker();
    } catch (cause) {
      this.#admission.release(this);
      return err(
        cause instanceof AnalysisError
          ? cause
          : new ProviderCleanupError(
              "web-bundle-static-analysis",
              [],
              { reason: "Earlier web analyzer cleanup remains incomplete" },
              { operation: "analyze_web_bundle", cause },
            ),
      );
    }
    if (this.#closed) {
      this.#admission.release(this);
      return err(new AnalysisCancelledError("analyze_web_bundle"));
    }
    return ok(undefined);
  }

  releaseReservation(): void {
    this.#admission.release(this);
  }

  analyze(
    inspection: WebPageInspection,
    sourceMaps: WebBundleAnalysis["observations"]["source_maps"],
    input: AnalyzeWebBundleInput,
    signal?: AbortSignal,
  ): Promise<Result<WebBundleAnalysis, AnalysisError>> {
    if (this.#closed)
      return Promise.resolve(
        err(
          new AnalysisCancelledError("analyze_web_bundle", {
            partialObservation: inspection,
          }),
        ),
      );
    if (this.#running !== undefined)
      return Promise.resolve(
        err(
          new AnalysisResourceConstraintError(
            "analyze_web_bundle",
            "capacity",
            "This web analyzer already owns an active analysis",
            { concurrent_web_bundle_analyses: 1 },
          ),
        ),
      );
    this.#controller = new AbortController();
    const running = this.#analyze(
      inspection,
      sourceMaps,
      input,
      signal,
    ).finally(() => {
      this.#running = undefined;
      this.#controller = undefined;
    });
    this.#running = running;
    return running;
  }

  async #analyze(
    inspection: WebPageInspection,
    sourceMaps: WebBundleAnalysis["observations"]["source_maps"],
    input: AnalyzeWebBundleInput,
    signal?: AbortSignal,
  ): Promise<Result<WebBundleAnalysis, AnalysisError>> {
    const scripts = inspection.scripts.items.filter(isIncludedScript);
    const results: WebBundleScriptAnalysis[] = [];
    const signals = [
      this.#controller!.signal,
      ...(signal === undefined ? [] : [signal]),
    ];
    const caller = AbortSignal.any(signals);
    const deadline = new ProviderStartupDeadline(
      input.total_analysis_timeout_ms ?? DEFAULT_WEB_BUNDLE_TOTAL_TIMEOUT_MS,
      caller,
    );
    let failure: AnalysisError | undefined;
    let resultCapacityExhausted = false;
    const appendUnstarted = (): void => {
      for (const script of scripts.slice(results.length))
        results.push({
          status: "unavailable",
          script_key: script.script_key,
          reason: "not_started",
          detail: caller.aborted
            ? "The operation was cancelled before this script was started."
            : deadline.interruption === "timeout"
              ? `The total_analysis_timeout_ms deadline of ${String(input.total_analysis_timeout_ms ?? DEFAULT_WEB_BUNDLE_TOTAL_TIMEOUT_MS)} ms expired before this script was started (deadlineExpired). This is not the per-script analysis_timeout_ms. A per-script timeout above the total is rejected.`
              : resultCapacityExhausted
                ? "The host could not reserve more web-analysis result capacity; this script was not started."
                : "An earlier analyzer failure prevented this script from starting.",
        });
    };
    try {
      await WebBundleAnalysisWorker.retryPending();
      this.#worker = this.createWorker(
        input.max_heap_mb ?? DEFAULT_WEB_BUNDLE_HEAP_MB,
      );
      for (const script of scripts) {
        if (deadline.signal.aborted) break;
        const analyzed = await this.#worker.analyze(
          script,
          input.analysis_timeout_ms ?? DEFAULT_WEB_BUNDLE_SCRIPT_TIMEOUT_MS,
          deadline.signal,
        );
        if (analyzed.ok) results.push(analyzed.value);
        else {
          const error = analyzed.error.error;
          results.push(
            analyzed.error.completed ?? {
              status: "unavailable",
              script_key: script.script_key,
              reason: caller.aborted
                ? "cancelled"
                : deadline.interruption === "timeout" ||
                    error instanceof AnalysisTimeoutError
                  ? "deadline"
                  : error instanceof AnalysisResourceConstraintError
                    ? "resource_constraint"
                    : "worker_failure",
              detail:
                error instanceof AnalysisResourceConstraintError &&
                error.reportedLimits !== null
                  ? `${error.userMessage ?? error.reason} Reported limits: ${JSON.stringify(error.reportedLimits)}`
                  : (error.userMessage ?? error.message),
            },
          );
          if (error.cleanupIncomplete) {
            failure = error;
            break;
          }
          if (analyzed.error.continuation === "result_capacity_exhausted") {
            resultCapacityExhausted = true;
            failure = error;
            break;
          }
          if (error instanceof AnalysisCapabilityUnavailableError) {
            failure = error;
            break;
          }
          if (caller.aborted || deadline.signal.aborted) break;
        }
      }
    } catch (cause) {
      failure =
        cause instanceof AnalysisError
          ? cause
          : new AnalysisOutputError(
              "analyze_web_bundle",
              "Web analyzer could not complete its owned work",
              { cause },
            );
    }
    appendUnstarted();
    let partial: WebBundleAnalysis | undefined;
    try {
      partial = buildCapturedWebBundleAnalysis(inspection, sourceMaps, results);
    } catch (cause) {
      failure = new AnalysisOutputError(
        "analyze_web_bundle",
        "Completed web script facts could not be assembled",
        { cause },
      );
    }
    const hasPrimaryFailure =
      failure !== undefined &&
      (!failure.cleanupIncomplete || failure.cleanupPrimary !== undefined);
    try {
      await this.#releaseWorker();
    } catch (cause) {
      const cleanup =
        cause instanceof AnalysisError
          ? cause
          : new ProviderCleanupError(
              "web-bundle-static-analysis",
              [],
              { reason: "Web analyzer final cleanup remains incomplete" },
              { operation: "analyze_web_bundle", cause },
            );
      failure =
        failure === undefined
          ? cleanup
          : analysisErrorWithCleanupFailure(
              failure,
              cleanup,
              "analyze_web_bundle",
            ).bindCleanupDependencies([failure, cleanup]);
    } finally {
      deadline.dispose();
    }
    if (
      !hasPrimaryFailure &&
      caller.aborted &&
      deadline.interruption !== "timeout"
    ) {
      const cancelled = new AnalysisCancelledError("analyze_web_bundle", {
        cause: caller.reason,
        partialObservation: partial ?? inspection,
      });
      failure =
        failure?.cleanupIncomplete === true
          ? analysisErrorWithCleanupFailure(
              cancelled,
              failure,
              "analyze_web_bundle",
            ).bindCleanupDependencies([cancelled, failure])
          : cancelled;
    } else if (!hasPrimaryFailure && deadline.interruption === "timeout") {
      const totalTimeoutMs =
        input.total_analysis_timeout_ms ?? DEFAULT_WEB_BUNDLE_TOTAL_TIMEOUT_MS;
      const timeout = new AnalysisTimeoutError(
        "analyze_web_bundle",
        totalTimeoutMs,
        {
          cause: deadline.signal.reason,
          partialObservation: partial ?? inspection,
          ...webBundleTotalTimeoutRecovery(totalTimeoutMs),
        },
      );
      failure =
        failure?.cleanupIncomplete === true
          ? analysisErrorWithCleanupFailure(
              timeout,
              failure,
              "analyze_web_bundle",
            ).bindCleanupDependencies([timeout, failure])
          : timeout;
    }
    if (failure !== undefined) {
      failure.retainPartialObservation(partial ?? inspection);
      return err(failure);
    }
    if (partial === undefined)
      return err(
        new AnalysisOutputError(
          "analyze_web_bundle",
          "Web analysis produced no result",
        ),
      );
    return ok(partial);
  }

  async close(): Promise<void> {
    this.#closed = true;
    this.#controller?.abort(
      new Error("Browser provider closed during bundle analysis"),
    );
    await this.#running;
    await this.#releaseWorker();
  }
  async #releaseWorker(): Promise<void> {
    try {
      await this.#worker?.close();
      this.#worker = undefined;
      this.#admission.forget(this);
    } catch (cause) {
      this.#admission.retain(this);
      throw cause;
    }
  }
}
