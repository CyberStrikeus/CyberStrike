import { AnalysisError } from "../domain/analysisErrorBase.js";
import { ProviderCleanupError } from "../domain/providerCleanupError.js";
import { projectAnalysisError } from "../domain/analysisErrorProjection.js";

/** Attempt every web workflow cleanup owner and report all failures. */
export const closeOwnedWebResources = async (
  close: readonly ((() => Promise<void>) | undefined)[],
  message: string,
): Promise<void> => {
  const results = await Promise.allSettled(
    close.flatMap((owner) =>
      owner === undefined ? [] : [Promise.resolve().then(owner)],
    ),
  );
  const failures = results.flatMap((result) =>
    result.status === "rejected" ? [result.reason as unknown] : [],
  );
  if (failures.length === 1) {
    const [failure] = failures;
    if (failure instanceof AnalysisError) throw failure;
    throw new ProviderCleanupError(
      "web-workflow",
      [],
      { reason: failure instanceof Error ? failure.message : String(failure) },
      { cause: failure, operation: "close_web_workflow" },
    );
  }
  if (failures.length > 1) {
    const normalized = failures.map((cause) => ({
      cause,
      projection:
        cause instanceof AnalysisError
          ? projectAnalysisError(cause)
          : undefined,
      resources: cause instanceof AnalysisError ? cause.cleanupResources : [],
    }));
    const recoveryActions = [
      ...new Set(
        normalized.flatMap(({ projection }) =>
          projection === undefined ? [] : [projection.remediation.action],
        ),
      ),
    ];
    const aggregate = new ProviderCleanupError(
      "web-workflow",
      [...new Set(normalized.flatMap(({ resources }) => resources))],
      {
        failures: normalized.map(
          ({ cause, projection }) =>
            projection ?? {
              message: cause instanceof Error ? cause.message : String(cause),
            },
        ),
      },
      {
        cause: new AggregateError(
          normalized.map(({ cause }) => cause),
          message,
        ),
        operation: "close_web_workflow",
        ...(recoveryActions.length === 0
          ? {}
          : { remediationAction: recoveryActions.join("; ") }),
      },
    );
    const dependencies = failures.filter(
      (cause): cause is AnalysisError =>
        cause instanceof AnalysisError && cause.cleanupIncomplete,
    );
    // Opaque or already-resolved rejections supply no live release authority.
    if (dependencies.length === failures.length)
      aggregate.bindCleanupDependencies(dependencies);
    throw aggregate;
  }
};
