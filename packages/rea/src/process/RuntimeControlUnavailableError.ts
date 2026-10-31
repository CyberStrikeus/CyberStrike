import { AnalysisCapabilityUnavailableError } from "../domain/analysisErrorCore.js";

/**
 * Expected refusal when a host control required before launch is unavailable.
 *
 * Process-layer owners raise one subtype per control; provider adapters
 * project every subtype through {@link runtimeControlCapabilityError}.
 */
export abstract class RuntimeControlUnavailableError extends Error {
  abstract readonly code: string;
  readonly retryable: boolean;
  /** Caller-facing recovery, when the owner knows a specific one. */
  readonly remediationAction: string | undefined;

  constructor(
    message: string,
    options?: ErrorOptions & {
      readonly retryable?: boolean;
      readonly remediationAction?: string;
    },
  ) {
    super(message, options);
    this.retryable = options?.retryable ?? false;
    this.remediationAction = options?.remediationAction;
  }
}

/** Project a host-control refusal as the provider's unavailable capability. */
export const runtimeControlCapabilityError = (
  providerId: string,
  operation: string,
  cause: RuntimeControlUnavailableError,
): AnalysisCapabilityUnavailableError =>
  new AnalysisCapabilityUnavailableError(providerId, operation, cause.message, {
    cause,
    retryable: cause.retryable,
    ...(cause.remediationAction === undefined
      ? {}
      : {
          userMessage: cause.message,
          remediationAction: cause.remediationAction,
        }),
  });
