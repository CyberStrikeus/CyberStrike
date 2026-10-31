import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import { createEvidence, type Evidence } from "../../domain/evidence.js";
import {
  executeManagedReconstructionImport,
  managedReconstructionImportRequestSchema,
  resolveManagedReconstructionImport,
  type ManagedReconstructionImportRequest,
  type ManagedReconstructionImportResult,
  type ResolvedManagedReconstructionImport,
} from "../../domain/managed/managedReconstruction.js";
import { ok, type Result } from "../../domain/result.js";
import { MANAGED_WORKFLOW_PROVIDER } from "../../domain/investigationProviders.js";
import {
  resolveEvidenceRequest,
  type EvidenceLookup,
} from "../EvidenceInputResolver.js";
import type { ExecutionOptions } from "../AnalysisProvider.js";

const OPERATION = "import_managed_reconstruction" as const;

/** Validate the request envelope and authenticate its managed Evidence source once. */
export const resolveManagedReconstructionEvidenceInput = (
  rawInput: unknown,
  lookup?: EvidenceLookup,
  options: Pick<ExecutionOptions, "signal"> = {},
): Result<ResolvedManagedReconstructionImport, AnalysisError> => {
  const parsed = resolveEvidenceRequest(
    OPERATION,
    rawInput,
    managedReconstructionImportRequestSchema,
    lookup,
    options,
  );
  if (!parsed.ok) return parsed;
  return resolveManagedReconstructionImport(parsed.value.input);
};

/** Execute from the source facts returned by the resolver. */
export const importManagedReconstructionEvidenceResolved = (
  resolved: ResolvedManagedReconstructionImport,
): Result<Evidence, AnalysisError> => {
  const result = executeManagedReconstructionImport(resolved);
  return ok(createManagedReconstructionEvidence(resolved.request, result));
};

/** Validate the raw request envelope, then authenticate and import its source. */
export const importManagedReconstructionEvidence = (
  rawInput: unknown,
  lookup?: EvidenceLookup,
  options: Pick<ExecutionOptions, "signal"> = {},
): Result<Evidence, AnalysisError> => {
  const resolved = resolveManagedReconstructionEvidenceInput(
    rawInput,
    lookup,
    options,
  );
  if (!resolved.ok) return resolved;
  return importManagedReconstructionEvidenceResolved(resolved.value);
};

const createManagedReconstructionEvidence = (
  input: ManagedReconstructionImportRequest,
  result: ManagedReconstructionImportResult,
): Evidence =>
  createEvidence(
    {
      path: result.static_observation.artifact_path,
      sha256: result.static_observation.artifact_sha256,
      format: "pe",
    },
    MANAGED_WORKFLOW_PROVIDER,
    {
      predicateType: "rea.managed-reconstruction-import",
      operation: OPERATION,
      parameters: {
        static_members_evidence_id: result.static_observation.evidence_id,
        decompiler: result.decompiler,
        method_locks: input.methods.map(
          ({ token, signature_sha256, normalized_il_sha256 }) => ({
            token,
            signature_sha256,
            normalized_il_sha256,
          }),
        ),
        notes: input.notes,
      },
      result,
      rawResult: null,
      confidence: "inferred",
      authority: "analyst-inference",
      environment: null,
      limitations: result.limitations,
      locations: [
        {
          kind: "artifact-path",
          path: result.static_observation.artifact_path,
        },
      ],
      evidenceLinks: result.evidence_links,
    },
  );
