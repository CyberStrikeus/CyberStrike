import { tsImport } from "tsx/esm/api";

const { agentEvaluationPassed } = await tsImport(
  new URL(
    "../../tests/evaluation/model-evals/AgentEvaluationReport.ts",
    import.meta.url,
  ).href,
  import.meta.url,
);

/** Fail the runner after publishing a report with any rejected scenario. */
export const assertAgentEvaluationReportPassed = (results) => {
  const failed = results.filter((result) => !agentEvaluationPassed(result));
  if (failed.length > 0)
    throw new Error(
      `Agent routing/workflow/answer checks failed: ${failed.map(({ id }) => id).join(", ")}`,
    );
};
