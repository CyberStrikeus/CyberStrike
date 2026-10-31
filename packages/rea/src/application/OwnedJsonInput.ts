import { setImmediate } from "node:timers/promises";

import { AnalysisInputError } from "../domain/analysisErrorCore.js";
import { freezeOwnedJsonSnapshotSteps } from "../domain/immutableJson.js";
import {
  jsonValueValidationSteps,
  type JsonValue,
} from "../domain/jsonValue.js";
import { err, ok, type Result } from "../domain/result.js";

const finish = async <Value>(
  steps: Generator<void, Value>,
  signal?: AbortSignal,
): Promise<Value> => {
  let completed = false;
  try {
    for (;;) {
      signal?.throwIfAborted();
      const step = steps.next();
      if (step.done) {
        completed = true;
        return step.value;
      }
      await setImmediate(undefined, signal === undefined ? {} : { signal });
    }
  } finally {
    // An abandoned validation/sealing traversal must release its provisional state.
    if (!completed) steps.return(undefined as never);
  }
};

/** Seal exclusively owned parser output so later schemas can share authenticated JSON subtrees. */
export const sealOwnedJsonInput = async (
  value: unknown,
  operation: string,
  signal?: AbortSignal,
): Promise<Result<JsonValue, AnalysisInputError>> => {
  const issue = await finish(jsonValueValidationSteps(value), signal);
  if (issue !== undefined)
    return err(
      new AnalysisInputError(operation, { userMessage: issue }, [
        {
          path: [],
          reason: "invalid_value",
          expected: "bounded JSON-safe input",
          message: issue,
        },
      ]),
    );
  // The completed validator above established the JsonValue contract without a copy.
  return ok(
    await finish(freezeOwnedJsonSnapshotSteps(value as JsonValue), signal),
  );
};
