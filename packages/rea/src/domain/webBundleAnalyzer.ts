import { analyzeScript } from "./webBundleAnalyzerInspection.js";
import {
  createWebBundleAnalysisAccumulator,
  type IncludedScript,
} from "./webBundleAnalyzerState.js";
import {
  webBundleScriptAnalysisSchema,
  type WebBundleScriptAnalysis,
} from "./webBundleScriptAnalysis.js";

/** Analyze one selected captured script without executing its source. */
export const analyzeCapturedWebScript = (
  script: IncludedScript,
): WebBundleScriptAnalysis => {
  const accumulator = createWebBundleAnalysisAccumulator();
  const routeFacts = analyzeScript(script, accumulator);
  const failed = accumulator.failedScripts.length > 0;
  const recovered = accumulator.recoveredScripts.length > 0;
  return webBundleScriptAnalysisSchema.parse({
    status: "analyzed",
    script_key: script.script_key,
    parse_status: failed ? "failed" : recovered ? "recovered" : "parsed",
    visited_ast_nodes: accumulator.visitedNodes,
    widened_return_references: accumulator.widenedScripts.length > 0,
    route_facts: routeFacts,
    observations: {
      edges: accumulator.edges,
      routes: accumulator.routes,
      endpoints: accumulator.endpoints,
      webmcp_declarations: accumulator.webMcp,
    },
    inferences: accumulator.inferences,
  });
};
