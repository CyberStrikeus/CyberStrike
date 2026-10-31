import type { ReconstructionCoverageData } from "./reconstructionCoverage.js";
import { uniqueSorted } from "./canonicalOrdering.js";
import {
  compareOffsetDateTimeInstants,
  parseOffsetDateTimeInstant,
  type OffsetDateTimeInstant,
} from "./offsetDateTime.js";

type VerifierResult = ReconstructionCoverageData["verifier_results"][number];

export interface VerifierObservation {
  readonly result: VerifierResult;
  readonly instant: OffsetDateTimeInstant;
}

/** Index each verifier's latest timestamp group without relying on array order. */
export const latestVerifierObservationsByVerifier = (
  results: readonly VerifierResult[],
): ReadonlyMap<string, readonly VerifierObservation[]> => {
  const latestByVerifier = new Map<string, VerifierObservation[]>();
  for (const result of results) {
    const observation = {
      result,
      instant: parseOffsetDateTimeInstant(result.observed_at),
    };
    const latest = latestByVerifier.get(result.verifier_id);
    const latestInstant = latest?.[0]?.instant;
    const comparison =
      latestInstant === undefined
        ? 1
        : compareOffsetDateTimeInstants(observation.instant, latestInstant);
    if (latest === undefined || comparison > 0)
      latestByVerifier.set(result.verifier_id, [observation]);
    else if (comparison === 0) latest.push(observation);
  }
  return latestByVerifier;
};

/** Compare assessment content while excluding timestamp spelling and provenance. */
export const sameVerifierAssessment = (
  left: VerifierResult,
  right: VerifierResult,
): boolean =>
  verifierAssessmentIdentity(left) === verifierAssessmentIdentity(right);

const verifierAssessmentIdentity = (result: VerifierResult): string =>
  JSON.stringify({
    verifier_id: result.verifier_id,
    contract_sha256: result.contract_sha256,
    status: result.status,
    covered_claim_ids: uniqueSorted(result.covered_claim_ids),
    covered_dimensions: uniqueSorted(result.covered_dimensions),
    artifact_sha256s: uniqueSorted(result.artifact_sha256s),
    owner_sha256s: uniqueSorted(result.owner_sha256s),
    normalization_sha256: result.normalization_sha256,
    repeats: result.repeats,
  });
