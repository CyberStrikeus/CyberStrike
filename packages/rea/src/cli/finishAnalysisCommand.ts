import { ArtifactReaderFailure } from "../artifacts/ArtifactReader.js";
import {
  AnalysisError,
  type AnalysisPartialObservation,
} from "../domain/analysisErrorBase.js";
import { analysisErrorWithCleanupFailure } from "../domain/analysisErrorCleanup.js";
import { AnalysisCancelledError } from "../domain/analysisErrorCore.js";
import {
  projectAnalysisError,
  projectAnalysisErrorWithoutCapturedOutput,
} from "../domain/analysisErrorProjection.js";
import { ProviderAdapterError } from "../domain/providerAdapterError.js";
import { ProviderCleanupError } from "../domain/providerCleanupError.js";
import { err, ok, type Result } from "../domain/result.js";
import { dispatchQueuedInterrupts } from "../process/queuedInterrupts.js";

/** Finish a one-shot CLI operation while retaining primary results through close. */
export const finishAnalysisCommand = async <
  Value extends AnalysisPartialObservation,
>(
  run: () => Promise<Result<Value, AnalysisError>>,
  service: { close(): Promise<void> },
  providerId: string,
  canonicalOperation: string,
  signal: AbortSignal,
  fallbackResource?: string,
  options: {
    readonly failureProjection?: "initial" | "final";
    /** Apply invocation-specific exclusions after all owned cleanup is composed. */
    readonly redactFailure?: (error: AnalysisError) => AnalysisError;
    /** Validate producer-attested completed output against this command's exact result contract. */
    readonly recoverCompletedObservation?: (
      observation: AnalysisPartialObservation,
    ) => Value | undefined;
  } = {},
): Promise<Result<Value, ReturnType<typeof projectAnalysisError>>> => {
  const projectFailure = (error: AnalysisError) =>
    projectAnalysisError(options.redactFailure?.(error) ?? error);
  let result: Result<Value, AnalysisError>;
  let cleanup: AnalysisError | undefined;
  try {
    result = await run();
  } catch (cause) {
    result = {
      ok: false,
      error:
        cause instanceof AnalysisError
          ? cause
          : new ProviderAdapterError(providerId, canonicalOperation, { cause }),
    };
  }
  // Some one-shot commands promise the original failure snapshot even when
  // close retries and mutates the producer's live cleanup status.
  const initialFailure =
    !result.ok && options.failureProjection === "initial"
      ? projectFailure(result.error)
      : undefined;
  const initialDiagnosticFailure =
    initialFailure !== undefined &&
    !result.ok &&
    result.error.capturedOutput !== undefined
      ? projectAnalysisErrorWithoutCapturedOutput(
          options.redactFailure?.(result.error) ?? result.error,
        )
      : initialFailure;
  try {
    // Resource owners may resolve their retained errors during close. This
    // adapter cannot infer resolution of a producer's earlier cleanup failure.
    await service.close();
  } catch (cause) {
    if (cause instanceof AnalysisError) cleanup = cause;
    else {
      const observation =
        cause instanceof ArtifactReaderFailure
          ? ArtifactReaderFailure.cleanupObservation(
              cause,
              fallbackResource ?? `${canonicalOperation} resources`,
            )
          : {
              reason: cause instanceof Error ? cause.message : String(cause),
              resources: [],
            };
      cleanup = new ProviderCleanupError(
        providerId,
        observation.resources,
        { reason: observation.reason },
        { cause, operation: canonicalOperation },
      );
    }
  }
  await dispatchQueuedInterrupts();
  if (initialFailure !== undefined && cleanup === undefined)
    return err(initialFailure);
  if (
    initialFailure === undefined &&
    !result.ok &&
    result.error instanceof ProviderCleanupError &&
    !result.error.cleanupIncomplete &&
    result.error.cleanupPrimary === undefined &&
    result.error.completedObservation !== undefined
  ) {
    const completed = options.recoverCompletedObservation?.(
      result.error.completedObservation,
    );
    if (completed !== undefined) {
      const recoveredCleanup = result.error;
      result = signal.aborted
        ? {
            ok: false,
            error: new AnalysisCancelledError(canonicalOperation, {
              cause: signal.reason,
              partialObservation: completed,
              diagnostics: {
                cleanup_history: projectFailure(recoveredCleanup),
              },
            }),
          }
        : { ok: true, value: completed };
    }
  }
  if (result.ok && signal.aborted)
    result = {
      ok: false,
      error: new AnalysisCancelledError(canonicalOperation, {
        cause: signal.reason,
        partialObservation: result.value,
      }),
    };
  if (cleanup !== undefined) {
    if (result.ok) cleanup.retainPartialObservation(result.value);
    result = {
      ok: false,
      error: result.ok
        ? cleanup
        : analysisErrorWithCleanupFailure(
            result.error,
            cleanup,
            canonicalOperation,
          ).bindCleanupDependencies([result.error, cleanup]),
    };
  }
  if (result.ok) return ok(result.value);
  const failure = projectFailure(result.error);
  const diagnostics = failure.details?.diagnostics;
  return err(
    initialFailure === undefined || cleanup === undefined
      ? failure
      : {
          ...failure,
          details: {
            ...failure.details,
            diagnostics: {
              ...(typeof diagnostics === "object" &&
              diagnostics !== null &&
              !Array.isArray(diagnostics)
                ? diagnostics
                : {}),
              primary_error: initialDiagnosticFailure ?? initialFailure,
            },
          },
        },
  );
};
