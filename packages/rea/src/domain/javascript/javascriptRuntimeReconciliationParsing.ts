import { digestCanonicalValue } from "../canonicalDigest.js";
import type { Evidence } from "../evidence.js";
import {
  javascriptApplicationAnalysisResultSchema,
  type JavaScriptApplicationAnalysisResult,
} from "./javascriptApplicationAnalysis.js";
import type { JavaScriptApplicationGraph } from "./javascriptApplicationGraph.js";
import type { ReconcileJavaScriptRuntimeFrame } from "./javascriptRuntimeReconciliationSchemas.js";
import {
  assertEvidenceIdentity,
  authenticateRuntimeEvidence,
  invalidInput,
  parseInputAtPath,
} from "./javascriptRuntimeReconciliationInputValidation.js";

type StaticLayerInput =
  ReconcileJavaScriptRuntimeFrame["static_layers"][number];
type RuntimeMapping = StaticLayerInput["runtime_mappings"][number];

export interface ParsedStaticLayer {
  readonly layerId: string;
  readonly role: StaticLayerInput["role"];
  readonly evidence: Evidence;
  readonly result: JavaScriptApplicationAnalysisResult;
  readonly graph: JavaScriptApplicationGraph;
  readonly runtimeMappings: readonly RuntimeMapping[];
}

/** Authenticate and semantically bind one admitted static analysis layer. */
export const parseStaticLayer = (
  layer: StaticLayerInput,
  evidencePath: readonly (string | number)[],
): ParsedStaticLayer => {
  const evidence = authenticateRuntimeEvidence(layer.analysis, evidencePath);
  const result = parseInputAtPath(
    javascriptApplicationAnalysisResultSchema,
    evidence.normalized_result,
    [...evidencePath, "normalized_result"],
  );
  assertEvidenceIdentity(
    evidence,
    {
      operation: "analyze_javascript_application",
      predicate: "rea.javascript-application-analysis",
      providerId: "rea-javascript-application",
      providerName: "REA JavaScript application analyzer",
      providerVersion: "1",
      authority: "shipped-artifact",
      confidence: "derived",
    },
    evidencePath,
  );
  if (
    evidence.subject === null ||
    evidence.subject.digest.sha256 !== result.root_artifact_sha256 ||
    evidence.subject.format !== result.format ||
    evidence.subject.local_path !== result.input_path
  )
    throw invalidInput(
      [...evidencePath, "subject"],
      "JavaScript application Evidence subject disagrees with its result",
    );
  return {
    layerId: `jrl_${digestCanonicalValue(
      {
        role: layer.role,
        evidence_id: evidence.evidence_id,
        runtime_mappings: layer.runtime_mappings,
      },
      "Runtime reconciliation",
    )}`,
    role: layer.role,
    evidence,
    result,
    graph: result.graph,
    runtimeMappings: layer.runtime_mappings,
  };
};
