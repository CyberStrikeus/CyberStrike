import type { JavaScriptSourceRange } from "./javascriptStaticAnalysisTypes.js";
import type { JavaScriptSemanticResourceLimit } from "./javascriptSemanticValueTypes.js";
import type { ApplicationCoverage } from "./javascriptApplicationEvidenceSchemas.js";
import {
  SEMANTIC_EXPRESSION_DEPTH_LIMIT,
  SEMANTIC_GETTER_EXPANSION_LIMIT,
  SEMANTIC_ALIAS_SELECTION_LIMIT,
  SEMANTIC_PRIMITIVE_CANDIDATE_LIMIT,
  SEMANTIC_PRIMITIVE_JSON_BYTES_LIMIT,
} from "./javascriptSemanticResourceLimits.js";

/** Exact retention state for one callable's direct returns. */
export type JavaScriptSemanticReturnCoverage = {
  readonly retainedCount: number;
} & {
  readonly status: "complete" | "partial";
  readonly omittedCount: 0 | null;
};

/** Coverage state for one semantic recovery pass. */
export type JavaScriptSemanticCoverage =
  | {
      readonly status: "complete";
      readonly omittedCount: 0;
      readonly resourceLimits?: readonly JavaScriptSemanticResourceLimit[];
      readonly widenedReturnedReferences?: readonly JavaScriptSourceRange[];
    }
  | {
      readonly status: "partial";
      readonly omittedCount: 0 | null;
      readonly resourceLimits?: readonly JavaScriptSemanticResourceLimit[];
      readonly widenedReturnedReferences?: readonly JavaScriptSourceRange[];
    }
  | {
      readonly status: "failed";
      readonly omittedCount: null;
      readonly resourceLimits?: readonly JavaScriptSemanticResourceLimit[];
      readonly widenedReturnedReferences?: readonly JavaScriptSourceRange[];
    };

/** Source-local effect candidates broadened at a projection merge, without dropping targets. */
export const RETURNED_REFERENCE_WIDENING_LIMITATION =
  "Local returned-reference projections were conservatively widened; effects include additional source-local candidates.";

/** Classify whole-file semantic coverage from parsing, value bounds and widened projections. */
export const semanticCoverage = (
  parserPartial: boolean,
  resourceLimits: readonly JavaScriptSemanticResourceLimit[] = [],
  widenedReturnedReferences: readonly JavaScriptSourceRange[] = [],
): JavaScriptSemanticCoverage => {
  const widened =
    widenedReturnedReferences.length > 0 ? { widenedReturnedReferences } : {};
  if (resourceLimits.length > 0)
    return {
      status: "partial",
      omittedCount: null,
      resourceLimits,
      ...widened,
    };
  return {
    status:
      parserPartial || widenedReturnedReferences.length > 0
        ? "partial"
        : "complete",
    omittedCount: 0,
    ...widened,
  };
};

/** Read typed resource-limit classifications from any coverage state. */
export const semanticCoverageResourceLimits = (
  coverage: JavaScriptSemanticCoverage,
): readonly JavaScriptSemanticResourceLimit[] => coverage.resourceLimits ?? [];

const semanticResourceBounds: Record<
  JavaScriptSemanticResourceLimit,
  Pick<ApplicationCoverage["limits"][number], "value" | "unit">
> = {
  "primitive-candidates": {
    value: SEMANTIC_PRIMITIVE_CANDIDATE_LIMIT,
    unit: "items",
  },
  "primitive-bytes": {
    value: SEMANTIC_PRIMITIVE_JSON_BYTES_LIMIT,
    unit: "bytes",
  },
  "expression-depth": {
    value: SEMANTIC_EXPRESSION_DEPTH_LIMIT,
    unit: "depth",
  },
  "getter-expansion": {
    value: SEMANTIC_GETTER_EXPANSION_LIMIT,
    unit: "items",
  },
  "alias-selections": {
    value: SEMANTIC_ALIAS_SELECTION_LIMIT,
    unit: "items",
  },
};

/** Map semantic evaluator bounds to their caller-visible application coverage. */
export const semanticResourceLimitCoverage = (
  resourceLimits: readonly JavaScriptSemanticResourceLimit[],
): ApplicationCoverage["limits"] =>
  resourceLimits.map((resourceLimit) => ({
    name: `javascript_semantic_${resourceLimit.replaceAll("-", "_")}`,
    ...semanticResourceBounds[resourceLimit],
  }));

/** Classify one callable's direct-return coverage. */
export const semanticReturnCoverage = (
  retainedCount: number,
  parserPartial: boolean,
): JavaScriptSemanticReturnCoverage => ({
  status: parserPartial ? "partial" : "complete",
  retainedCount,
  omittedCount: 0,
});
