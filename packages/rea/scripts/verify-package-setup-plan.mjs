/** Describe a failed package setup-plan check without masking its result shape. */
export const setupPlanFailureMessage = ({
  planned,
  plannedExecution,
  plannedClaudeConfig,
  plannedCodexConfig,
  plannedCursorConfig,
}) => {
  const actionKinds = (actions) =>
    Array.isArray(actions)
      ? actions.map((action) => action?.kind ?? action)
      : actions;
  return `packaged setup plan was not read-only: ${JSON.stringify({
    status: planned?.status,
    exitCode: plannedExecution.status,
    plannedKinds: actionKinds(planned?.plannedActions),
    appliedKinds: actionKinds(planned?.appliedActions),
    result: planned,
    claudeConfig: plannedClaudeConfig,
    codexConfig: plannedCodexConfig,
    cursorConfig: plannedCursorConfig,
  })}`;
};
