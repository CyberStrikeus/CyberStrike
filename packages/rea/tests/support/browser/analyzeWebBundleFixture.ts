import type { WebPageInspection } from "../../../src/domain/browserObservationSchemas.js";
import type { WebBundleAnalysis } from "../../../src/domain/webBundleAnalysis.js";
import { analyzeCapturedWebScript } from "../../../src/domain/webBundleAnalyzer.js";
import { buildCapturedWebBundleAnalysis } from "../../../src/domain/webBundleAnalyzerResult.js";
import { isIncludedScript } from "../../../src/domain/webBundleAnalyzerState.js";

/** Compose the production script parser and result merger for semantic fixtures. */
export const analyzeWebBundleFixture = (
  inspection: WebPageInspection,
  sourceMaps: WebBundleAnalysis["observations"]["source_maps"] = {
    status: "not_requested",
    requested: 0,
    processed: 0,
    items: [],
  },
): WebBundleAnalysis => {
  const sourceScripts = inspection.scripts.items.filter(isIncludedScript);
  return buildCapturedWebBundleAnalysis(
    inspection,
    sourceMaps,
    sourceScripts.map(analyzeCapturedWebScript),
  );
};
