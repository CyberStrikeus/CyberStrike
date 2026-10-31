/** Status of the earlier action that stopped a declared scenario sequence. */
export type ScenarioActionStop = "failed" | "cancelled";

/**
 * Explain a declared action recorded as `cancelled` without running because an
 * earlier action stopped the sequence. Scenario producers record every
 * remaining action so results account for the whole declared sequence.
 */
export const notExecutedActionError = (
  stoppedBy: ScenarioActionStop,
): string =>
  stoppedBy === "failed"
    ? "not executed after an earlier action failure"
    : "not executed after scenario request cancellation";
