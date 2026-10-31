import type { BinarySessionPort } from "../application/binary/BinarySessionPort.js";
import type { AnalysisError } from "../domain/analysisErrorBase.js";
import {
  AnalysisCancelledError,
  AnalysisOutputError,
} from "../domain/analysisErrorCore.js";
import { analysisErrorWithCancellation } from "../domain/analysisErrorCancellation.js";
import { projectAnalysisError } from "../domain/analysisErrorProjection.js";
import type { Evidence } from "../domain/evidence.js";
import { err, type Result } from "../domain/result.js";

export type ExternalMutationAdmission = Pick<
  BinarySessionPort,
  "withAdmittedExternalMutation"
>;

/** Retain the completed command outcome while reporting a later cancellation. */
export const retainExternalMutationCancellation = <Value>(
  value: Result<Value, AnalysisError>,
  cancellation: AnalysisCancelledError,
  evidenceOf?: (value: Value) => Evidence,
  retainedDetails?: (value: Value) => Readonly<Record<string, string>>,
): AnalysisError => {
  if (!value.ok)
    return analysisErrorWithCancellation(value.error, cancellation);
  if (evidenceOf !== undefined)
    cancellation.retainPartialObservation(evidenceOf(value.value));
  if (retainedDetails !== undefined)
    cancellation.retainDiagnostics(retainedDetails(value.value));
  return cancellation;
};

/** Shared MCP admission and failure preservation for unrestricted commands. */
export const runWithExternalMutationAdmission = async <Value>(
  session: ExternalMutationAdmission | undefined,
  operationName: string,
  signal: AbortSignal | undefined,
  operation: () => Promise<Result<Value, AnalysisError>>,
  evidenceOf: ((value: Value) => Evidence) | undefined,
  cleanupRecovery?: (
    failure: AnalysisError | undefined,
  ) => Promise<Result<null, AnalysisError>>,
  retainedDetails?: (value: Value) => Readonly<Record<string, string>>,
): Promise<Result<Value, AnalysisError>> => {
  if (session === undefined) {
    const recovered = await cleanupRecovery?.(undefined);
    if (recovered !== undefined && !recovered.ok) return recovered;
    return operation();
  }
  const admitted = await session.withAdmittedExternalMutation(
    undefined,
    signal,
    operation,
    (value, cause) => {
      if (cause instanceof AnalysisCancelledError) {
        return retainExternalMutationCancellation(
          value,
          cause,
          evidenceOf,
          retainedDetails,
        );
      }
      return value.ok
        ? new AnalysisOutputError(
            operationName,
            "The external command may have changed the bound artifact, but the active analysis session could not be retired.",
            {
              cause,
              ...(evidenceOf === undefined
                ? {}
                : { partialObservation: evidenceOf(value.value) }),
              ...(cause.capturedOutput === undefined
                ? {}
                : { capturedOutput: cause.capturedOutput }),
              ...(retainedDetails === undefined
                ? {}
                : { diagnostics: retainedDetails(value.value) }),
            },
          )
        : value.error.retainSecondaryFailure(cause, {
            retirement_error: projectAnalysisError(cause),
          });
    },
    operationName,
    cleanupRecovery,
  );
  return admitted.ok ? admitted.value : err(admitted.error);
};

/** Admit an owned close once, including when it is recovering its own blocker. */
export const runOwnedCleanupWithExternalMutationAdmission = async <Value>(
  session: ExternalMutationAdmission | undefined,
  operationName: string,
  signal: AbortSignal | undefined,
  resourceId: string,
  cleanup: () => Promise<Result<Value, AnalysisError>>,
): Promise<Result<Value, AnalysisError>> => {
  let completed: Result<Value, AnalysisError> | undefined;
  const cleanupOnce = async (): Promise<Result<Value, AnalysisError>> => {
    completed ??= await cleanup();
    return completed;
  };
  const admitted = await runWithExternalMutationAdmission(
    session,
    operationName,
    signal,
    cleanupOnce,
    undefined,
    async (failure) => {
      if (
        failure === undefined ||
        !failure.cleanup?.resources.includes(resourceId)
      )
        return failure === undefined
          ? { ok: true, value: null }
          : { ok: false, error: failure };
      const recovered = await cleanupOnce();
      return recovered.ok ? { ok: true, value: null } : recovered;
    },
  );
  return admitted;
};
