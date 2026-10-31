import { ProviderAdapterError } from "./providerAdapterError.js";
import {
  projectAnalysisError,
  projectAnalysisErrorWithoutCapturedOutput,
} from "./analysisErrorProjection.js";
import type { AnalysisError } from "./analysisErrorBase.js";

/** Preserve the original lifecycle failure alongside incomplete cleanup. */
export const analysisErrorWithCleanupFailure = (
  primary: AnalysisError,
  cleanup: AnalysisError,
  operation = "close_binary",
): AnalysisError => {
  const projected = projectAnalysisError(cleanup);
  return new ProviderAdapterError(
    cleanup instanceof ProviderAdapterError ? cleanup.providerId : "rea",
    operation,
    {
      cleanupPrimary: primary,
      cause: new AggregateError(
        [primary, cleanup],
        "Analysis failed and cleanup remains incomplete.",
        { cause: primary },
      ),
      userMessage: projectAnalysisError(primary).message,
      remediationAction: projected.remediation.action,
      ...(primary.capturedOutput === undefined
        ? {}
        : { capturedOutput: primary.capturedOutput }),
      ...(primary.partialObservation === undefined
        ? {}
        : { partialObservation: primary.partialObservation }),
      cleanup: {
        reason: cleanup.cleanup?.reason ?? projected.message,
        resources: [
          ...new Set([
            ...(primary.cleanupIncomplete ? primary.cleanupResources : []),
            ...cleanup.cleanupResources,
          ]),
        ],
      },
      diagnostics: {
        primary_error:
          primary.capturedOutput === undefined
            ? projectAnalysisError(primary)
            : projectAnalysisErrorWithoutCapturedOutput(primary),
        cleanup_error: projected,
      },
    },
  );
};
