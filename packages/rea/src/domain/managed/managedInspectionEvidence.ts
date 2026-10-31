import type { Evidence } from "../evidence.js";
import { AnalysisInputError } from "../analysisErrorCore.js";
import { EvidenceIntegrityError } from "../evidenceErrors.js";
import { readEvidence, readEvidencePayload } from "../evidenceValidation.js";
import { err, ok, type Result } from "../result.js";
import type { z } from "zod";

/** Build-local metadata tokens join only under a known, matching module MVID. */
export const managedTokenScopesMatch = (
  leftMvid: string | null,
  rightMvid: string | null,
): boolean =>
  leftMvid !== null &&
  rightMvid !== null &&
  leftMvid.toLowerCase() === rightMvid.toLowerCase();

/**
 * Authenticate managed inspection Evidence and bind its artifact to any available subject.
 * A null subject remains valid and means there is no digest to cross-check.
 */
export const readManagedInspectionEvidence = <
  Payload extends {
    readonly artifact: { readonly sha256: string };
    readonly identity_scope?: {
      readonly requires_artifact_sha256: string;
      readonly requires_mvid: string | null;
    };
    readonly module?: { readonly mvid: string | null } | null;
  },
>(
  rawEvidence: unknown,
  operation: string,
  schema: z.ZodType<Payload>,
  selection: {
    readonly operation: string;
    readonly path: readonly (string | number)[];
  },
): Result<
  { readonly evidence: Evidence; readonly result: Payload },
  AnalysisInputError | EvidenceIntegrityError
> => {
  const record = readEvidence(rawEvidence);
  if (!record.ok) return record;
  const evidence = record.value;
  if (
    evidence.operation !== operation ||
    evidence.predicate_type !== "rea.analysis"
  ) {
    const message = `Expected rea.analysis ${operation} Evidence, received ${evidence.predicate_type} ${evidence.operation}`;
    return err(
      new AnalysisInputError(selection.operation, { userMessage: message }, [
        { path: selection.path, reason: "invalid_value", message },
      ]),
    );
  }
  const payload = readEvidencePayload(schema, evidence.normalized_result);
  if (!payload.ok) return payload;
  const result = payload.value;
  const artifactSha256 = result.artifact.sha256;
  const subjectSha256 = evidence.subject?.digest.sha256;
  if (subjectSha256 !== undefined && artifactSha256 !== subjectSha256)
    return err(
      integrityFailure(
        `Managed Evidence ${operation} (${evidence.evidence_id}) subject SHA-256 ${subjectSha256} does not match normalized artifact SHA-256 ${artifactSha256}`,
      ),
    );
  const scope = result.identity_scope;
  if (scope !== undefined && scope.requires_artifact_sha256 !== artifactSha256)
    return err(
      integrityFailure(
        `Managed Evidence ${operation} (${evidence.evidence_id}) token scope SHA-256 ${scope.requires_artifact_sha256} does not match normalized artifact SHA-256 ${artifactSha256}`,
      ),
    );
  const moduleMvid = result.module?.mvid ?? null;
  const scopedMvid = scope?.requires_mvid;
  if (
    scopedMvid !== undefined &&
    scopedMvid?.toLowerCase() !== moduleMvid?.toLowerCase()
  )
    return err(
      integrityFailure(
        `Managed Evidence ${operation} (${evidence.evidence_id}) token scope MVID ${String(scopedMvid)} does not match module MVID ${String(moduleMvid)}`,
      ),
    );
  return ok({ evidence, result });
};

const integrityFailure = (message: string): EvidenceIntegrityError =>
  new EvidenceIntegrityError(message, { userMessage: message });
