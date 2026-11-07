import { AnalysisCapabilityUnavailableError } from "./analysisErrorCore.js";
import type { JsonValue } from "./jsonValue.js";

/** Convert a provider's host configuration failure into actionable refusal evidence. */
export const providerConfigurationRefusal = (
  providerId: string,
  operation: string,
  failure: Error & {
    readonly diagnostics?: Readonly<Record<string, JsonValue>>;
  },
): AnalysisCapabilityUnavailableError => {
  const remediation = failure.diagnostics?.remediation;
  const reason =
    typeof remediation === "string"
      ? `${failure.message}. ${remediation}.`
      : `${failure.message}.`;
  return new AnalysisCapabilityUnavailableError(providerId, operation, reason, {
    cause: failure,
    userMessage: reason,
    diagnostics: failure.diagnostics,
  });
};
