import {
  resolveEvidenceInput,
  resolvePairedEvidenceSources,
  type EvidenceLookup,
} from "../EvidenceInputResolver.js";
import { AnalysisError } from "../../domain/analysisErrorBase.js";
import { AnalysisInputError } from "../../domain/analysisErrorCore.js";
import { inspectAnalysisViewValidated } from "../analysisView/AnalysisViewService.js";
import type { EvidenceFileReadOptions } from "../analysisView/evidenceFileSource.js";
import { artifactComparisonInputSchema } from "../../contracts/artifactComparisonContracts.js";
import { parseAnalysisInput } from "../AnalysisInput.js";
import { artifactInventorySummaryViewResultSchema } from "../../domain/analysisView/analysisView.js";
import {
  compareArtifacts,
  type ArtifactComparisonResult,
} from "../../domain/artifactComparison.js";
import { ARTIFACT_COMPARISON_PROVIDER } from "../../domain/comparisonEvidenceIdentity.js";
import {
  EvidenceIntegrityError,
  EvidenceReferenceError,
} from "../../domain/evidenceErrors.js";
import {
  createEvidence,
  rebindEvidenceToTargetPath,
  type Evidence,
} from "../../domain/evidence.js";
import { readEvidence } from "../../domain/evidenceValidation.js";
import { artifactInventorySummaryProjectionIds } from "../../domain/analysisView/artifactInventorySummaryProjection.js";
import { err, ok, type Result } from "../../domain/result.js";

const OPERATION = "compare_artifacts";

/** Both comparison sides, each resolved to its exact complete inventory owner. */
export interface ArtifactComparisonSources {
  readonly left: Evidence;
  readonly right: Evidence;
}

/** A completed comparison and the derived Evidence citing both complete inputs. */
export interface ArtifactComparisonOutcome {
  readonly comparison: ArtifactComparisonResult;
  readonly evidence: Evidence;
}

/**
 * Select both sides through the shared paired-source owner, authenticate them,
 * then resolve a summary to its exact retained parent inventory.
 */
export const resolveArtifactComparisonSources = async (
  input: unknown,
  evidenceById: EvidenceLookup | undefined,
  options: EvidenceFileReadOptions = {},
): Promise<Result<ArtifactComparisonSources, AnalysisError>> => {
  const request = parseAnalysisInput(
    OPERATION,
    input,
    artifactComparisonInputSchema,
    options.signal,
  );
  if (!request.ok) return request;
  return resolvePairedEvidenceSources(request.value, evidenceById, {
    ...options,
    operation: OPERATION,
    resolveEvidence: (candidate, related, side) => {
      const authenticated = readEvidence(candidate);
      return authenticated.ok
        ? resolveArtifactComparisonEvidence(authenticated.value, related, [
            side,
          ])
        : authenticated;
    },
  });
};

/** Compare resolved inventories and derive Evidence citing both complete owners. */
export const compareArtifactEvidence = ({
  left,
  right,
}: ArtifactComparisonSources): Result<
  ArtifactComparisonOutcome,
  AnalysisError
> => {
  let comparison: ArtifactComparisonResult;
  try {
    comparison = compareArtifacts(left, right);
  } catch (cause: unknown) {
    // Typed causes already name the failed constraint; keep their issues.
    if (cause instanceof AnalysisError) return err(cause);
    throw cause;
  }
  const leftEvidenceIds = [left.evidence_id];
  const rightEvidenceIds = [right.evidence_id];
  return ok({
    comparison,
    evidence: createEvidence(undefined, ARTIFACT_COMPARISON_PROVIDER, {
      predicateType: "rea.artifact-comparison",
      operation: OPERATION,
      parameters: {
        left_evidence_ids: leftEvidenceIds,
        right_evidence_ids: rightEvidenceIds,
      },
      result: comparison,
      confidence: "derived",
      authority: "analyst-inference",
      limitations: comparison.limitations,
      evidenceLinks: [...leftEvidenceIds, ...rightEvidenceIds],
    }),
  });
};

/**
 * Resolve an already-authenticated artifact summary's exact retained owner.
 * The caller must authenticate the supplied Evidence before invoking this helper.
 */
export const resolveArtifactComparisonEvidence = (
  evidence: Evidence,
  evidenceById: EvidenceLookup | undefined,
  path: readonly (string | number)[] = [],
): Result<Evidence, AnalysisError> => {
  if (evidence.operation !== "inspect_analysis_view") return ok(evidence);

  const summary = artifactInventorySummaryViewResultSchema.safeParse(
    evidence.normalized_result,
  );
  if (!summary.success)
    return err(
      new AnalysisInputError(OPERATION, undefined, [
        {
          path: [...path],
          reason: "invalid_value",
          message:
            "Artifact comparison accepts only an artifact inventory summary from inspect_analysis_view.",
        },
      ]),
    );

  const parentId = summary.data.parent_evidence_id;
  const parent = evidenceById?.(parentId);
  if (parent === undefined)
    return err(
      new EvidenceReferenceError(parentId, "missing", {
        expected: "retained complete artifact inventory Evidence",
        actual: null,
      }),
    );
  const selected = resolveEvidenceInput(
    { kind: "retained-evidence", evidence_id: parentId },
    () => parent,
  );
  if (!selected.ok) return selected;
  const authenticated = readEvidence(selected.value);
  if (!authenticated.ok) return authenticated;
  const owner = authenticated.value;
  const subject = evidence.subject;
  if (
    subject === null ||
    owner.subject === null ||
    subject.digest.sha256 !== owner.subject.digest.sha256 ||
    subject.format !== owner.subject.format ||
    subject.architecture !== owner.subject.architecture
  )
    return mismatch();
  // The ledger preserves its original display path; summary delivery may use a
  // later caller-selected alias for this same authenticated owner identity.
  const presentation = rebindEvidenceToTargetPath(owner, {
    path: summary.data.artifact.path,
    sha256: subject.digest.sha256,
    format: subject.format,
    ...(subject.architecture === null
      ? {}
      : { architecture: subject.architecture }),
  });
  const reprojected = inspectAnalysisViewValidated(
    {
      source: { kind: "retained-evidence", evidence_id: parentId },
      view: { kind: "summary" },
    },
    (evidenceId) => (evidenceId === parentId ? presentation : undefined),
  );
  if (!reprojected.ok) return reprojected;
  if (
    !artifactInventorySummaryProjectionIds(reprojected.value).includes(
      evidence.evidence_id,
    )
  )
    return mismatch();
  return ok(owner);
};

const mismatch = (): Result<never, EvidenceIntegrityError> =>
  err(
    new EvidenceIntegrityError(
      "Artifact summary does not match its retained parent inventory.",
    ),
  );
