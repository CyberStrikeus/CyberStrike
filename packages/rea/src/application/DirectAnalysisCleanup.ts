import type { AnalysisError } from "../domain/analysisErrorBase.js";
import { projectAnalysisError } from "../domain/analysisErrorProjection.js";
import { jsonValueSchema, type JsonValue } from "../domain/jsonValue.js";
import { ProviderAdapterError } from "../domain/providerAdapterError.js";
import { err, type Result } from "../domain/result.js";
import type { AnalysisExecution } from "./AnalysisProvider.js";
import type { BinarySession } from "./binary/BinarySession.js";
import { analysisErrorWithCleanupFailure } from "../domain/analysisErrorCleanup.js";
import {
  tryParseEvidence,
  withEvidenceCallerInputPath,
} from "../domain/evidence.js";

/** Add the actual outer request path to authenticated partial Evidence. */
export const projectDirectAnalysisFailure = (
  error: AnalysisError,
  callerInputPath: string,
): ReturnType<typeof projectAnalysisError> => {
  const projection = projectAnalysisError(error);
  const observation = tryParseEvidence(projection.details?.partial_observation);
  return observation === undefined
    ? projection
    : {
        ...projection,
        details: {
          ...projection.details,
          partial_observation: withEvidenceCallerInputPath(
            observation,
            callerInputPath,
          ),
        },
      };
};

/** Await one-shot cleanup and retain either the outcome or both failures. */
export const withSessionCleanup = async <Value>(
  session: BinarySession,
  operation: () => Promise<Value>,
  onCleanupFailure: (value: Value, error: AnalysisError) => Value,
): Promise<Value> => {
  let value: Value;
  try {
    value = await operation();
  } catch (cause: unknown) {
    const closed = await session.close();
    if (!closed.ok)
      throw new AggregateError(
        [cause, closed.error],
        "Analysis and provider cleanup both failed",
        { cause },
      );
    throw cause;
  }
  const closed = await session.close();
  return closed.ok ? value : onCleanupFailure(value, closed.error);
};

/** Project typed one-shot outcomes only after execution and cleanup settle. */
export const directAnalysisCleanupFailure = (
  result: Result<JsonValue, AnalysisError>,
  error: AnalysisError,
  callerInputPath?: string,
): JsonValue => {
  const project = (failure: AnalysisError) =>
    callerInputPath === undefined
      ? projectAnalysisError(failure)
      : projectDirectAnalysisFailure(failure, callerInputPath);
  const cleanup = project(error);
  if (!result.ok) {
    const primary = project(result.error);
    const combined = analysisErrorWithCleanupFailure(result.error, error);
    return {
      error: "Analysis failed",
      ...primary,
      code: "cleanup_incomplete",
      retryable: false,
      remediation: cleanup.remediation,
      details: {
        ...primary.details,
        // The domain composition owns the union of still-retained resources;
        // neither projection may overwrite the other owner's cleanup state.
        resources: [...combined.cleanupResources],
        cleanup: "incomplete",
        execution_failure: primary.details?.execution_failure ?? primary.code,
        cleanup_error: cleanup,
      },
    };
  }
  return {
    error: "Analysis failed",
    ...cleanup,
    code: "cleanup_incomplete",
    retryable: false,
    details: {
      ...cleanup.details,
      cleanup: "incomplete",
      partial_observation: result.value,
    },
  };
};

/** Preserve managed observations or the original typed failure in diagnostics. */
export const managedAnalysisCleanupFailure = (
  result: Result<AnalysisExecution, AnalysisError>,
  error: AnalysisError,
): Result<AnalysisExecution, AnalysisError> => {
  // A close rejection without a live cleanup state has unknown completion;
  // an empty dependency set must not turn that rejection into confirmed cleanup.
  if (!result.ok) {
    const failure = analysisErrorWithCleanupFailure(result.error, error);
    return err(
      error.cleanupIncomplete
        ? failure.bindCleanupDependencies([result.error, error])
        : failure,
    );
  }
  const cleanup = projectAnalysisError(error);
  const failure = new ProviderAdapterError(
    error instanceof ProviderAdapterError ? error.providerId : "rea",
    "close_binary",
    {
      cause: error,
      remediationAction: cleanup.remediation.action,
      cleanup: { reason: cleanup.message, resources: error.cleanupResources },
      diagnostics: {
        cleanup_error: cleanup,
        partial_observation: jsonValueSchema.parse(result.value),
      },
    },
  );
  return err(
    error.cleanupIncomplete
      ? failure.bindCleanupDependencies([error])
      : failure,
  );
};
