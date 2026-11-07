import {
  HopperRemoteError,
  HopperTimeoutError,
  HopperProcessError,
} from "../domain/hopperErrors.js";
import {
  AnalysisError,
  type AnalysisErrorOptions,
} from "../domain/analysisErrorBase.js";
import {
  AnalysisCancelledError,
  AnalysisCapabilityUnavailableError,
  AnalysisAccessDeniedError,
  AnalysisArtifactChangedError,
  AnalysisResourceConstraintError,
  resourceConstraintRecovery,
  AnalysisOutputError,
  AnalysisTimeoutError,
} from "../domain/analysisErrorCore.js";
import { ProviderAdapterError } from "../domain/providerAdapterError.js";
import { ProviderCleanupError } from "../domain/providerCleanupError.js";
import type { JsonValue } from "../domain/jsonValue.js";
import { ArtifactReaderFailure } from "../artifacts/ArtifactReader.js";
import { bindArtifactFileCleanup } from "../artifacts/ArtifactFileOperation.js";

/** Copy authored outcome facts; semantic attribution never inspects a later signal. */
export const analysisClientFailureContext = (
  cause: AnalysisError,
  providerId: string,
  operation: string,
): AnalysisErrorOptions => {
  const providerRequest =
    cause instanceof HopperRemoteError ||
    cause instanceof HopperTimeoutError ||
    cause instanceof HopperProcessError
      ? {
          ...(cause.operation === undefined
            ? {}
            : { operation: cause.operation }),
          ...(cause.requestId === undefined
            ? {}
            : { request_id: cause.requestId }),
          ...(cause instanceof HopperRemoteError
            ? {
                provider_code: cause.code,
                diagnostic_type: cause.diagnosticType,
              }
            : {}),
        }
      : undefined;
  const diagnostics =
    providerRequest === undefined
      ? cause.diagnostics
      : {
          provider_request: providerRequest,
          ...(cause.diagnostics === undefined
            ? {}
            : { provider_diagnostics: cause.diagnostics }),
        };
  return {
    cause,
    ...(cause.limit === undefined ? {} : { limit: cause.limit }),
    ...(cause.cleanupPrimary === undefined
      ? {}
      : {
          cleanupPrimary: analysisClientFailureForOperation(
            cause.cleanupPrimary,
            providerId,
            operation,
          ),
        }),
    ...(cause.partialObservation === undefined
      ? {}
      : { partialObservation: cause.partialObservation }),
    ...(cause.capturedOutput === undefined
      ? {}
      : { capturedOutput: cause.capturedOutput }),
    ...(diagnostics === undefined ? {} : { diagnostics }),
    ...(cause.cleanupIncomplete
      ? {
          cleanup: {
            reason: cause.cleanup?.reason ?? cause.message,
            resources: cause.cleanupResources,
          },
        }
      : {}),
  };
};

/** Attribute producer-owned failure facts without inferring interruption. */
export const analysisClientFailureForOperation = (
  cause: unknown,
  providerId: string,
  operation: string,
  callerDiagnostics?: Readonly<Record<string, JsonValue>>,
): AnalysisError => {
  if (!(cause instanceof AnalysisError)) {
    const failure = new ProviderAdapterError(providerId, operation, {
      cause,
      ...(callerDiagnostics === undefined
        ? {}
        : { diagnostics: callerDiagnostics }),
      ...(cause instanceof ArtifactReaderFailure && cause.cleanup !== undefined
        ? { cleanup: cause.cleanup }
        : {}),
    });
    bindArtifactFileCleanup(cause, failure);
    return failure;
  }
  if (
    !(cause instanceof HopperRemoteError) &&
    !(cause instanceof HopperTimeoutError) &&
    !(cause instanceof HopperProcessError) &&
    !(cause instanceof AnalysisCancelledError) &&
    !(cause instanceof ProviderAdapterError) &&
    !(cause instanceof AnalysisCapabilityUnavailableError) &&
    !(cause instanceof AnalysisAccessDeniedError) &&
    !(cause instanceof AnalysisArtifactChangedError) &&
    !(cause instanceof AnalysisTimeoutError) &&
    !(cause instanceof AnalysisOutputError) &&
    !(cause instanceof AnalysisResourceConstraintError)
  )
    return cause;
  const sourceContext = analysisClientFailureContext(
    cause,
    providerId,
    operation,
  );
  const context = {
    ...sourceContext,
    ...(callerDiagnostics === undefined
      ? {}
      : {
          diagnostics: { ...sourceContext.diagnostics, ...callerDiagnostics },
        }),
  };
  let result: AnalysisError;
  if (cause instanceof HopperRemoteError)
    result = new HopperRemoteError(cause.code, cause.safeMessage, {
      ...context,
      operation,
      requestId: cause.requestId,
      diagnosticType: cause.diagnosticType,
    });
  else if (cause instanceof HopperTimeoutError)
    result = new HopperTimeoutError(
      cause.timeoutMs,
      operation,
      cause.requestId,
      cause.providerState,
      cause.stage,
      cause.launcherOutcome,
      context,
    );
  else if (cause instanceof HopperProcessError)
    result = new HopperProcessError(cause.exitCode, {
      ...context,
      operation,
      requestId: cause.requestId,
      providerState: cause.providerState,
      stage: cause.stage,
      ...(cause.diagnostic === undefined
        ? {}
        : { diagnostic: cause.diagnostic }),
      ...(cause.launcherFailure === undefined
        ? {}
        : { launcherFailure: cause.launcherFailure }),
    });
  else if (cause instanceof ProviderCleanupError) {
    const { diagnostics, ...outcomeContext } = context;
    result = new ProviderCleanupError(
      cause.providerId,
      cause.cleanupResources,
      diagnostics ?? {},
      {
        ...outcomeContext,
        operation,
        ...(cause.completedObservation === undefined
          ? {}
          : { completedObservation: cause.completedObservation }),
        ...(cause.remediationAction === undefined
          ? {}
          : { remediationAction: cause.remediationAction }),
      },
    );
  } else if (cause instanceof AnalysisTimeoutError)
    result = new AnalysisTimeoutError(operation, cause.timeoutMs, {
      ...context,
      ...(cause.userMessage === undefined
        ? {}
        : { userMessage: cause.userMessage }),
      ...(cause.remediationAction === undefined
        ? {}
        : { remediationAction: cause.remediationAction }),
    });
  else if (cause instanceof AnalysisOutputError)
    result = new AnalysisOutputError(operation, cause.reason, {
      ...context,
      cleanupOnly: cause.cleanupOnly,
      ...(cause.userMessage === undefined
        ? {}
        : { userMessage: cause.userMessage }),
      ...(cause.remediationAction === undefined
        ? {}
        : { remediationAction: cause.remediationAction }),
    });
  else if (cause instanceof AnalysisCancelledError)
    result = new AnalysisCancelledError(operation, {
      ...context,
      cause: cause.cause,
    });
  else if (cause instanceof AnalysisCapabilityUnavailableError)
    result = new AnalysisCapabilityUnavailableError(
      cause.providerId,
      operation,
      cause.reason,
      {
        ...context,
        ...(cause.userMessage === undefined
          ? {}
          : { userMessage: cause.userMessage }),
        retryable: cause.retryable,
      },
    );
  else if (cause instanceof AnalysisAccessDeniedError)
    result = new AnalysisAccessDeniedError(
      operation,
      cause.path,
      cause.systemCode,
      context,
    );
  else if (cause instanceof AnalysisArtifactChangedError)
    result = new AnalysisArtifactChangedError(
      operation,
      cause.path,
      cause.reason,
      context,
    );
  else if (cause instanceof AnalysisResourceConstraintError)
    result = new AnalysisResourceConstraintError(
      operation,
      cause.resource,
      cause.reason,
      cause.reportedLimits,
      { ...context, ...resourceConstraintRecovery(cause) },
    );
  else
    result = new ProviderAdapterError(providerId, operation, {
      ...context,
      ...(cause.userMessage === undefined
        ? {}
        : { userMessage: cause.userMessage }),
      ...(cause.remediationAction === undefined
        ? {}
        : { remediationAction: cause.remediationAction }),
    });
  return cause.cleanupIncomplete
    ? result.bindCleanupDependencies([cause])
    : result.resolveCleanup();
};
