import { ProviderCleanupError } from "../domain/providerCleanupError.js";
import { err, type Result } from "../domain/result.js";
import { AnalysisError } from "../domain/analysisErrorBase.js";
import type { AnalysisClient } from "./AnalysisProvider.js";

/** Close one provider client and normalize unexpected adapter rejection. */
export const closeAnalysisClient = async (
  client: AnalysisClient,
  providerId: string,
  options: Parameters<AnalysisClient["close"]>[0] = {},
): Promise<Result<null, AnalysisError>> => {
  // Nested/composite clients report failures before their final result settles.
  // Own notification identity for this close attempt, including the fallback
  // for clients that only return or reject with their cleanup failure.
  const reported = new Set<AnalysisError>();
  const report = (failure: AnalysisError): void => {
    if (reported.has(failure)) return;
    reported.add(failure);
    options.onCleanupFailure?.(failure);
  };
  let result: Result<null, AnalysisError>;
  try {
    result = await client.close({
      ...options,
      ...(options.onCleanupFailure === undefined
        ? {}
        : { onCleanupFailure: report }),
    });
  } catch (cause: unknown) {
    // A typed cleanup failure already names its leftover resources.
    const failure =
      cause instanceof AnalysisError && cause.cleanupIncomplete
        ? cause
        : new ProviderCleanupError(
            providerId,
            ["provider-client"],
            { reason: "provider client close rejected unexpectedly" },
            { cause },
          );
    result = err(failure);
  }
  if (!result.ok) report(result.error);
  return result;
};
