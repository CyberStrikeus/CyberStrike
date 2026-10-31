import type { AnalysisError } from "../domain/analysisErrorBase.js";
import { AnalysisCapabilityUnavailableError } from "../domain/analysisErrorCore.js";

/** Unsupported operations permit alternatives only after owned cleanup completes. */
export const permitsCapabilityFallback = (
  error: AnalysisError,
): error is AnalysisCapabilityUnavailableError =>
  error instanceof AnalysisCapabilityUnavailableError &&
  !error.cleanupIncomplete;
