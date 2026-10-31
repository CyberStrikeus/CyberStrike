import { readArtifactInspectionSources } from "../domain/artifactInspection.js";
import type { AnalysisError } from "../domain/analysisErrorBase.js";
import type { Evidence } from "../domain/evidence.js";
import { err, ok, type Result } from "../domain/result.js";

/** Resolve the embedded publication closure without reinterpreting it in delivery adapters. */
export const analysisEvidenceSources = (
  complete: Evidence,
): Result<Evidence[], AnalysisError> => {
  const embedded =
    complete.operation === "inspect_artifact"
      ? readArtifactInspectionSources(complete.normalized_result)
      : ok([]);
  if (!embedded.ok)
    return err(embedded.error.retainPartialObservation(complete));
  return ok([...embedded.value, complete]);
};
