import { completeJavaScriptAnalysisSteps } from "../../src/application/javascript/JavaScriptAnalysisControl.js";
import { buildImmutableJavaScriptArtifactGraphSteps } from "../../src/application/javascript/JavaScriptArtifactGraphBuilder.js";
import type { JavaScriptApplicationGraph } from "../../src/domain/javascript/javascriptApplicationGraph.js";

/** Drive the production immutable application graph builder for boundary tests. */
export const immutableArtifactGraph = (
  ...args: Parameters<typeof buildImmutableJavaScriptArtifactGraphSteps>
): Promise<JavaScriptApplicationGraph> =>
  completeJavaScriptAnalysisSteps(
    buildImmutableJavaScriptArtifactGraphSteps(...args),
  ).then(({ graph }) => graph);
