import {
  resolveEvidenceRequest,
  type EvidenceLookup,
} from "../EvidenceInputResolver.js";
import type { ExecutionOptions } from "../AnalysisProvider.js";
import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import { createEvidence, type Evidence } from "../../domain/evidence.js";
import { ok, type Result } from "../../domain/result.js";
import {
  managedNativeVerificationHasUnknowns,
  verifyManagedNativeVerificationSource,
} from "../../domain/managed/managedNativeVerification.js";
import {
  readManagedNativeVerificationSource,
  type ManagedNativeVerificationSource,
} from "../../domain/managed/managedNativeVerificationSource.js";
import {
  managedNativeVerificationRequestSchema,
  type ManagedNativeVerificationResult,
} from "../../domain/managed/managedNativeVerificationSchemas.js";
import { MANAGED_WORKFLOW_PROVIDER } from "../../domain/investigationProviders.js";

const OPERATION = "verify_managed_native_boundaries" as const;

export interface ManagedNativeVerificationExecution {
  readonly evidence: Evidence;
  readonly summary: ManagedNativeVerificationResult["summary"];
  readonly sourceEvidence: readonly Evidence[];
  readonly hasUnknowns: boolean;
}

/** Resolve untrusted source Evidence, then execute over the trusted parsed source. */
export const executeManagedNativeBoundaries = (
  rawInput: unknown,
  lookup?: EvidenceLookup,
  options: Pick<ExecutionOptions, "signal"> = {},
): Result<ManagedNativeVerificationExecution, AnalysisError> => {
  const request = resolveEvidenceRequest(
    OPERATION,
    rawInput,
    managedNativeVerificationRequestSchema,
    lookup,
    options,
  );
  if (!request.ok) return request;
  const source = readManagedNativeVerificationSource(request.value.input);
  if (!source.ok) return source;
  const result = verifyManagedNativeVerificationSource(source.value);
  const evidence = createManagedNativeVerificationEvidence(
    source.value,
    result,
  );
  return ok({
    evidence,
    summary: result.summary,
    hasUnknowns: managedNativeVerificationHasUnknowns(result),
    sourceEvidence: [
      source.value.managedEvidence,
      ...source.value.nativeObservations.map(
        ({ evidence: observation }) => observation,
      ),
    ],
  });
};

const createManagedNativeVerificationEvidence = (
  source: ManagedNativeVerificationSource,
  result: ManagedNativeVerificationResult,
): Evidence =>
  createEvidence(undefined, MANAGED_WORKFLOW_PROVIDER, {
    predicateType: "rea.managed-native-verification",
    operation: OPERATION,
    parameters: {
      managed_boundaries_evidence_id: source.managedEvidence.evidence_id,
      native_evidence_ids: source.nativeObservations.map(
        ({ evidence }) => evidence.evidence_id,
      ),
    },
    result,
    rawResult: null,
    confidence: "inferred",
    authority: "analyst-inference",
    environment: null,
    limitations: result.limitations,
    evidenceLinks: result.evidence_links,
  });
