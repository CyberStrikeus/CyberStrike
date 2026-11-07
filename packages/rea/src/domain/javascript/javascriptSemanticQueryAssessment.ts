import { uniqueSorted } from "../canonicalOrdering.js";
import type { JavaScriptSemanticGraph } from "./javascriptSemanticGraph.js";
import type { JavaScriptSemanticGraphUnknown } from "./javascriptSemanticGraphSchemas.js";
import type { JavaScriptSemanticQueryResult } from "./javascriptSemanticQuerySchemas.js";

/** Inputs needed to classify one completed semantic traversal. */
export interface JavaScriptSemanticQueryAssessmentInput {
  readonly graph: JavaScriptSemanticGraph;
  readonly totalSeeds: number;
  readonly expectedMatches: number;
  readonly hasExpectation: boolean;
  readonly unknowns: readonly JavaScriptSemanticGraphUnknown[];
  readonly candidateRelations: number;
}

/** Status, coverage, and limitations derived from one traversal. */
export interface JavaScriptSemanticQueryAssessment {
  readonly status: JavaScriptSemanticQueryResult["status"];
  readonly coverage: JavaScriptSemanticQueryResult["coverage"];
  readonly limitations: string[];
}

/** Classify a complete semantic traversal without promoting unknowns to absence. */
export const assessJavaScriptSemanticQuery = (
  input: JavaScriptSemanticQueryAssessmentInput,
): JavaScriptSemanticQueryAssessment => ({
  status: queryStatus(input),
  coverage: queryCoverage(input),
  limitations: queryLimitations(input),
});

const queryCoverage = (
  input: JavaScriptSemanticQueryAssessmentInput,
): JavaScriptSemanticQueryResult["coverage"] => ({
  status:
    input.graph.coverage.status === "unavailable"
      ? "unavailable"
      : input.unknowns.length > 0 ||
          input.candidateRelations > 0 ||
          input.graph.coverage.status !== "complete" ||
          input.graph.coverage.truncated
        ? "partial"
        : "complete",
});

const queryStatus = (
  input: JavaScriptSemanticQueryAssessmentInput,
): JavaScriptSemanticQueryResult["status"] => {
  if (input.graph.coverage.status === "unavailable") return "unsupported";
  if (input.candidateRelations > 0) return "ambiguous";
  if (input.unknowns.length > 0 || input.graph.coverage.truncated)
    return "partial";
  if (
    input.totalSeeds === 0 ||
    (input.hasExpectation && input.expectedMatches === 0)
  )
    return input.unknowns.length > 0 ||
      input.graph.coverage.status !== "complete" ||
      input.graph.coverage.truncated
      ? "partial"
      : "no-match";
  return input.totalSeeds > 1 ? "ambiguous" : "found";
};

const queryLimitations = (
  input: JavaScriptSemanticQueryAssessmentInput,
): string[] =>
  uniqueSorted([
    "Semantic graph reachability is a static inference and does not prove runtime execution.",
    ...input.graph.limitations,
    ...(input.unknowns.length === 0
      ? []
      : [
          "Relevant dynamic, unsupported, incomplete, or ambiguous semantics remain unknown.",
        ]),
    ...(input.candidateRelations === 0
      ? []
      : [
          "Candidate relations remain ambiguous and do not establish a resolved semantic path.",
        ]),
  ]);
