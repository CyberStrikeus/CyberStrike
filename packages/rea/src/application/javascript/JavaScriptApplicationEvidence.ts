import {
  createImmutableEvidenceSteps,
  type Evidence,
  type EvidenceObservation,
} from "../../domain/evidence.js";
import type {
  AnalyzeJavaScriptApplicationInput,
  JavaScriptApplicationAnalysisResult,
} from "../../domain/javascript/javascriptApplicationAnalysis.js";
import { JAVASCRIPT_APPLICATION_PROVIDER } from "../../domain/investigationProviders.js";
import { freezeOwnedJsonSnapshotSteps } from "../../domain/immutableJson.js";
import { rememberOwnedApplicationGraphEvidence } from "./JavaScriptApplicationEvidenceGraph.js";
import { completeJavaScriptAnalysisSteps } from "./JavaScriptAnalysisControl.js";
import { jsonValueValidationSteps } from "../../domain/jsonValue.js";
import type { ProgressReporter } from "../ProgressReporter.js";

/** Create owned analysis Evidence while allowing request cancellation during sealing and hashing. */
export const createOwnedJavaScriptApplicationEvidenceCooperatively = async (
  input: AnalyzeJavaScriptApplicationInput,
  result: JavaScriptApplicationAnalysisResult,
  signal?: AbortSignal,
  progress?: ProgressReporter,
): Promise<Evidence> => {
  await reportEvidencePhase(
    progress,
    "seal_javascript_application_result",
    "Sealing the complete application analysis result",
  );
  const snapshot = await completeJavaScriptAnalysisSteps(
    freezeOwnedJsonSnapshotSteps(result),
    signal,
  );
  await reportEvidencePhase(
    progress,
    "validate_javascript_application_evidence",
    "Validating the immutable application Evidence JSON",
  );
  // The Evidence envelope consumes the completed immutable validation cache.
  await completeJavaScriptAnalysisSteps(
    jsonValueValidationSteps(snapshot),
    signal,
  );
  await reportEvidencePhase(
    progress,
    "hash_javascript_application_evidence",
    "Hashing the complete application analysis Evidence",
  );
  const evidence = await completeJavaScriptAnalysisSteps(
    createImmutableEvidenceSteps(
      applicationSubject(snapshot),
      JAVASCRIPT_APPLICATION_PROVIDER,
      applicationObservation(input, snapshot),
    ),
    signal,
  );
  return rememberOwnedApplicationGraphEvidence(evidence, snapshot);
};

const reportEvidencePhase = (
  progress: ProgressReporter | undefined,
  phase: string,
  message: string,
): Promise<void> =>
  progress?.report({ phase, completed: 0, total: 1, message }) ??
  Promise.resolve();

const applicationSubject = (result: JavaScriptApplicationAnalysisResult) => ({
  path: result.input_path,
  sha256: result.root_artifact_sha256,
  format: result.format,
});

const applicationObservation = (
  input: AnalyzeJavaScriptApplicationInput,
  result: JavaScriptApplicationAnalysisResult,
): EvidenceObservation => ({
  predicateType: "rea.javascript-application-analysis",
  operation: "analyze_javascript_application",
  parameters: parameters(input),
  result,
  rawResult: null,
  confidence: "derived",
  authority: "shipped-artifact",
  environment: null,
  limitations: result.limitations,
  locations: [{ kind: "artifact-path", path: "artifact-root" }],
});

const parameters = (
  input: AnalyzeJavaScriptApplicationInput,
): EvidenceObservation["parameters"] => ({
  input_path: input.input_path,
  format: input.format,
  integrity_policy: input.integrity_policy,
  ...(input.max_semantic_nodes === undefined
    ? {}
    : { max_semantic_nodes: input.max_semantic_nodes }),
  ...(input.max_semantic_nodes_per_file === undefined
    ? {}
    : { max_semantic_nodes_per_file: input.max_semantic_nodes_per_file }),
  ...(input.max_semantic_unknowns === undefined
    ? {}
    : { max_semantic_unknowns: input.max_semantic_unknowns }),
  ...(input.max_semantic_unknowns_per_file === undefined
    ? {}
    : { max_semantic_unknowns_per_file: input.max_semantic_unknowns_per_file }),
  ...(input.source_paths === undefined
    ? {}
    : { source_paths: input.source_paths }),
  ...(input.max_heap_mb === undefined
    ? {}
    : { max_heap_mb: input.max_heap_mb }),
  ...(input.analysis_timeout_ms === undefined
    ? {}
    : { analysis_timeout_ms: input.analysis_timeout_ms }),
});
