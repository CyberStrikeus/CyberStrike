import {
  primaryAnalysisError,
  type AnalysisError,
} from "./analysisErrorBase.js";
import { AnalysisCancelledError } from "./analysisErrorCore.js";

/** Keep the established failure while retaining a later caller cancellation once. */
export const analysisErrorWithCancellation = (
  failure: AnalysisError | undefined,
  cancellation: AnalysisCancelledError,
): AnalysisError => {
  if (failure === undefined) return cancellation;
  const primary = primaryAnalysisError(failure);
  if (
    !(primary instanceof AnalysisCancelledError) &&
    !primary.secondaryFailures.some(
      (secondary) =>
        secondary instanceof AnalysisCancelledError &&
        secondary.cause === cancellation.cause,
    )
  )
    primary.retainSecondaryFailure(cancellation);
  return failure;
};
