import { z } from "zod";
import { applicationCoverageSchema } from "../javascript/javascriptApplicationEvidenceSchemas.js";
import type { JavaScriptApplicationAnalysisResult } from "../javascript/javascriptApplicationAnalysis.js";
import { javaScriptSemanticGraphInputSchema } from "../javascript/javascriptSemanticGraphSchemas.js";
import { javaScriptSourceSelectionSchema } from "../javascript/javascriptSourceSelection.js";
import { javaScriptStaticCoverageSchema } from "../javascript/javascriptStaticCoverage.js";

/** Source completeness is independent of exhausting a selected fact page. */
export const javascriptApplicationSourceCoverageSchema = z.strictObject({
  source_selection: javaScriptSourceSelectionSchema.exactOptional(),
  application: applicationCoverageSchema,
  semantic: javaScriptSemanticGraphInputSchema.shape.coverage.omit({
    families: true,
  }),
  application_unknown_count: z.int().nonnegative(),
  semantic_unknown_count: z.int().nonnegative(),
});

export type JavaScriptApplicationSourceCoverage = z.infer<
  typeof javascriptApplicationSourceCoverageSchema
>;

/** Reuse retained coverage and count its unknowns once for every view. */
export const javascriptApplicationSourceCoverage = (
  analysis: JavaScriptApplicationAnalysisResult,
): JavaScriptApplicationSourceCoverage => {
  const { families: _families, ...semantic } = analysis.semantic_graph.coverage;
  return {
    ...(analysis.source_selection === undefined
      ? {}
      : { source_selection: analysis.source_selection }),
    application: analysis.graph.coverage,
    semantic,
    application_unknown_count: analysis.graph.nodes.reduce(
      (count, node) => count + Number(node.kind === "unknown"),
      0,
    ),
    semantic_unknown_count: analysis.semantic_graph.unknowns.length,
  };
};

/** Count only source-file observations; historical missing facts remain unmeasured. */
export const javascriptStaticSourceCoverageSummary = (
  analysis: JavaScriptApplicationAnalysisResult,
) => {
  const summary = {
    sources: 0,
    unmeasured_sources: 0,
    syntax: { complete: 0, recovered: 0, failed: 0, "not-examined": 0 },
    semantics: { unknown_sources: 0, unexamined_sources: 0 },
    examination: { complete: 0, limited: 0, "not-examined": 0 },
    electron_applicability: { observed: 0, unknown: 0 },
  };
  for (const node of analysis.graph.nodes) {
    for (const observation of node.observations) {
      if (observation.properties.file_kind !== "javascript") continue;
      summary.sources += 1;
      const parsed = javaScriptStaticCoverageSchema.safeParse(
        observation.properties.analysis_coverage,
      );
      if (!parsed.success) {
        summary.unmeasured_sources += 1;
        continue;
      }
      const coverage = parsed.data;
      summary.syntax[coverage.syntax.status] += 1;
      summary.examination[coverage.examination.status] += 1;
      summary.electron_applicability[coverage.applicability.electron] += 1;
      if (coverage.semantics.unknown_findings === null)
        summary.semantics.unexamined_sources += 1;
      else if (coverage.semantics.uncertainty.length > 0)
        summary.semantics.unknown_sources += 1;
    }
  }
  return summary;
};
