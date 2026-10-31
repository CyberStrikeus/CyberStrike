import { AnalysisCapabilityUnavailableError } from "../domain/analysisErrorCore.js";
import type { AnalysisErrorOptions } from "../domain/analysisErrorBase.js";
import { KUNA_PROVIDER_ID } from "./KunaRelease.js";

/**
 * A Kuna capability gap whose reason is what the caller needs to read. Without
 * a user message the projection shows only "choose another analysis or
 * target", which hides facts such as "no code at this address".
 */
export const kunaUnavailable = (
  operation: string,
  reason: string,
  options: AnalysisErrorOptions = {},
): AnalysisCapabilityUnavailableError =>
  new AnalysisCapabilityUnavailableError(KUNA_PROVIDER_ID, operation, reason, {
    ...options,
    userMessage: reason,
  });
