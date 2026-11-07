import type { ProcessCapture } from "./processCaptureParsing.js";
import {
  evaluateProcessTraceSide,
  processTraceComparisonResultSchema,
  type ProcessTraceComparisonResult,
  type EvaluatedSide,
} from "./processTraceEvaluation.js";
import {
  processTraceSpecificationSchema,
  type ProcessTraceSpecification,
} from "./processTraceSpecification.js";

/** Compare two captures against an explicit finite trace language. */
export const evaluateProcessTraceComparison = (
  left: ProcessCapture,
  right: ProcessCapture,
  specificationInput: ProcessTraceSpecification,
): {
  readonly result: ProcessTraceComparisonResult;
  readonly diagnostics: readonly NonNullable<EvaluatedSide["diagnostic"]>[];
} => {
  const specification =
    processTraceSpecificationSchema.parse(specificationInput);
  const leftEvaluation = evaluateProcessTraceSide(left, specification);
  const rightEvaluation = evaluateProcessTraceSide(right, specification);
  const diagnostic =
    leftEvaluation.diagnostic === null
      ? rightEvaluation.diagnostic === null
        ? null
        : { side: "right" as const, ...rightEvaluation.diagnostic }
      : { side: "left" as const, ...leftEvaluation.diagnostic };
  const outcomesDiffer = processTraceOutcomesDiffer({
    left: leftEvaluation.result,
    right: rightEvaluation.result,
  });
  const result = processTraceComparisonResultSchema.parse({
    verdict:
      leftEvaluation.result.status === "unknown" ||
      rightEvaluation.result.status === "unknown"
        ? "unknown"
        : leftEvaluation.result.status === "pass" &&
            rightEvaluation.result.status === "pass"
          ? "equivalent"
          : outcomesDiffer
            ? "different"
            : "nonconforming",
    left: leftEvaluation.result,
    right: rightEvaluation.result,
    diagnostic,
  });
  return {
    result,
    diagnostics: [leftEvaluation.diagnostic, rightEvaluation.diagnostic].filter(
      (value): value is NonNullable<EvaluatedSide["diagnostic"]> =>
        value !== null,
    ),
  };
};

/** Compare two captures against an explicit finite trace language. */
export const compareProcessTraces = (
  left: ProcessCapture,
  right: ProcessCapture,
  specification: ProcessTraceSpecification,
): ProcessTraceComparisonResult =>
  evaluateProcessTraceComparison(left, right, specification).result;

/** Whether trace conformance or raw declared order differs across captures. */
export const processTraceOutcomesDiffer = (
  comparison: Pick<ProcessTraceComparisonResult, "left" | "right">,
): boolean =>
  comparison.left.status !== comparison.right.status ||
  comparison.left.raw_trace.length !== comparison.right.raw_trace.length ||
  comparison.left.raw_trace.some(
    ({ event_id }, index) =>
      event_id !== comparison.right.raw_trace[index]?.event_id,
  );
