import type { AnalysisError } from "../domain/analysisErrorBase.js";
import { analysisClientFailureForOperation } from "../providers/AnalysisClientFailure.js";
import { KUNA_PROVIDER_ID } from "./KunaRelease.js";

/** Keep one producer failure immutable while each waiter receives its context. */
export const kunaQueryFailureForCaller = (
  source: AnalysisError,
  operation: string,
): AnalysisError => {
  if (
    !("operation" in source) ||
    typeof source.operation !== "string" ||
    source.operation === operation
  )
    return source;
  return analysisClientFailureForOperation(
    source,
    KUNA_PROVIDER_ID,
    operation,
    {
      producer_operation: source.operation,
    },
  );
};
