/** Caller-visible operational state for one provider bridge. */
export const PROVIDER_OPERATION_STATES = [
  "idle",
  "busy",
  "exited",
  "unreachable",
  "not_started",
  "unknown",
] as const;

/** Operational state REA can support with evidence, or unknown. */
export type ProviderOperationState = (typeof PROVIDER_OPERATION_STATES)[number];

/** States a Hopper process failure can establish. */
export type HopperProcessProviderState = "exited" | "unreachable" | "unknown";

/** What the caller should do next for this provider state. */
export const PROVIDER_RETRY_ACTIONS = [
  "retry",
  "wait",
  "restart_provider",
  "unknown",
] as const;

/** Recovery choice for a provider operation failure. */
export type ProviderRetryAction = (typeof PROVIDER_RETRY_ACTIONS)[number];

/** Stage that was in progress when the provider operation failed. */
export const PROVIDER_FAILURE_STAGES = [
  "launch",
  "connection",
  "analysis",
  "decompilation",
  "unknown",
] as const;

/** Known provider-operation stage, including an explicit unknown. */
export type ProviderFailureStage = (typeof PROVIDER_FAILURE_STAGES)[number];

/** One provider request retained with a failure or an in-flight operation. */
export interface ProviderOperationRequest {
  readonly requestId: number;
  readonly operation: string;
  readonly stage: ProviderFailureStage;
}

/** Sanitized provider health a session can show after the request returns. */
export interface ProviderOperationHealth {
  readonly state: ProviderOperationState;
  readonly stage: ProviderFailureStage | null;
  readonly retryAction: ProviderRetryAction | null;
  readonly exitCode: number | null;
  readonly requests: readonly ProviderOperationRequest[];
}

/**
 * Choose a recovery action from the observed state.
 * Startup failures keep their existing install or configuration guidance.
 */
export const providerRetryAction = (
  state: ProviderOperationState,
  startupFailure = false,
): ProviderRetryAction | null => {
  if (state === "idle") return null;
  if (startupFailure && state === "exited") return "retry";
  switch (state) {
    case "busy":
      return "wait";
    case "exited":
    case "unreachable":
      return "restart_provider";
    case "not_started":
      return "retry";
    case "unknown":
      return "unknown";
  }
};

/** Use one stage when every retained request agrees, otherwise unknown. */
export const sharedProviderFailureStage = (
  requests: readonly ProviderOperationRequest[],
): ProviderFailureStage | null => {
  const first = requests[0]?.stage;
  if (first === undefined) return null;
  return requests.every((request) => request.stage === first)
    ? first
    : "unknown";
};
