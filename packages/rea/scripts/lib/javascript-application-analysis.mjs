import { analyzeJavaScriptApplication } from "../../dist/application/javascript/JavaScriptApplicationService.js";
import { ArtifactResourceScope } from "../../dist/artifacts/ArtifactResourceScope.js";

/** Analyze one JavaScript application and close its caller-owned resources. */
export const analyzeJavaScriptApplicationWithOwnedScope = async (input) => {
  const scope = new ArtifactResourceScope();
  let outcome;
  try {
    const result = await analyzeJavaScriptApplication(input, scope);
    outcome = result.ok
      ? { kind: "completed", value: result.value }
      : { kind: "failed", cause: result.error };
  } catch (cause) {
    outcome = { kind: "failed", cause };
  }
  try {
    await scope.close();
  } catch (cleanupCause) {
    if (outcome.kind === "failed")
      throw new AggregateError(
        [outcome.cause, cleanupCause],
        "JavaScript analysis and artifact cleanup both failed",
      );
    throw cleanupCause;
  }
  if (outcome.kind === "failed") throw outcome.cause;
  return outcome.value;
};
