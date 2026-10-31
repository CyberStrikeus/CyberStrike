import { setImmediate } from "node:timers/promises";
import { ArtifactReaderFailure } from "../../artifacts/ArtifactReader.js";

/** Reject cancelled application work before computing or publishing more results. */
export const assertJavaScriptAnalysisActive = (signal?: AbortSignal): void => {
  if (signal?.aborted === true)
    throw new ArtifactReaderFailure(
      "cancelled",
      "JavaScript application analysis cancelled",
      { cause: signal.reason },
    );
};

/** Let request control messages run, then recheck the current analysis intent. */
export const checkpointJavaScriptAnalysis = async (
  signal?: AbortSignal,
): Promise<void> => {
  assertJavaScriptAnalysisActive(signal);
  await setImmediate();
  assertJavaScriptAnalysisActive(signal);
};

/** Drive bounded owned-domain steps while permitting cancellation and control I/O. */
export const completeJavaScriptAnalysisSteps = async <Value>(
  steps: Iterator<void, Value, void>,
  signal?: AbortSignal,
): Promise<Value> => {
  let deadline = performance.now() + 8;
  try {
    for (;;) {
      assertJavaScriptAnalysisActive(signal);
      const step = steps.next();
      if (step.done) {
        assertJavaScriptAnalysisActive(signal);
        return step.value;
      }
      if (performance.now() >= deadline) {
        await checkpointJavaScriptAnalysis(signal);
        deadline = performance.now() + 8;
      }
    }
  } finally {
    steps.return?.();
  }
};
