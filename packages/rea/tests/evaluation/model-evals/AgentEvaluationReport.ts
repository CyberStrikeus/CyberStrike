/** Factual outcome for configured fixtures, independent of routing heuristics. */
export type FixtureCorrectness = "passed" | "failed" | "not_assessed";

/** Measurements consumed by the evaluation runner's release gate. */
export interface AgentEvaluationGateResult {
  /** Explicit null requires a target clarification with no REA calls. */
  readonly expectedFirstTool?: string | null;
  readonly targetClarificationPassed?: boolean;
  /** A scenario-specific expected refusal or acquisition/cleanup outcome. */
  readonly scenarioOutcomePassed?: boolean;
  readonly exitCode: number;
  readonly naturalUse: boolean;
  readonly correctFirstTool: boolean;
  readonly repeatedCallCount: number;
  readonly inputValidationFailureCount: number;
  readonly requiredToolSubsequenceMet: boolean;
  readonly inputTokens: number;
  readonly answerHeuristicsMet: boolean;
  readonly epistemicCuePresent: boolean;
  readonly factualCorrectness: FixtureCorrectness;
}

/** Require configured facts to pass while preserving workflow and execution gates. */
export const agentEvaluationPassed = (
  result: AgentEvaluationGateResult,
): boolean =>
  result.exitCode === 0 &&
  (result.expectedFirstTool === null
    ? !result.naturalUse
    : result.naturalUse) &&
  result.correctFirstTool &&
  result.repeatedCallCount === 0 &&
  result.inputValidationFailureCount === 0 &&
  result.requiredToolSubsequenceMet &&
  result.scenarioOutcomePassed !== false &&
  result.inputTokens > 0 &&
  (result.expectedFirstTool === null
    ? result.targetClarificationPassed === true
    : result.factualCorrectness === "passed" ||
      (result.factualCorrectness === "not_assessed" &&
        result.answerHeuristicsMet &&
        result.epistemicCuePresent));

/** Keep assessed fixture outcomes and scenarios without truth oracles distinct. */
export const summarizeFactualCorrectness = (
  results: readonly { readonly factualCorrectness: FixtureCorrectness }[],
) => {
  const passed = results.filter(
    ({ factualCorrectness }) => factualCorrectness === "passed",
  ).length;
  const failed = results.filter(
    ({ factualCorrectness }) => factualCorrectness === "failed",
  ).length;
  const status: FixtureCorrectness =
    failed > 0 ? "failed" : passed > 0 ? "passed" : "not_assessed";
  return {
    status,
    scope: "configured_fixture_claims",
    counts: {
      assessed: passed + failed,
      passed,
      failed,
      notAssessed: results.length - passed - failed,
    },
  };
};
