import {
  resolveEvidenceRequest,
  type EvidenceLookup,
} from "./EvidenceInputResolver.js";
import type { ExecutionOptions } from "./AnalysisProvider.js";
import type { AnalysisInputError } from "../domain/analysisErrorCore.js";
import type { AnalysisError } from "../domain/analysisErrorBase.js";
import {
  createEvidence,
  type Evidence,
  type EvidenceProvider,
  type EvidenceSubjectTarget,
} from "../domain/evidence.js";
import type { JsonValue } from "../domain/jsonValue.js";
import type { ParsedInventorySet } from "../domain/artifactInventoryEvidence.js";
import {
  applicationInventoryProjectionInputSchema,
  readApplicationInventoryProjection,
} from "../domain/mobileApplicationGraphProjection.js";
import { ok, type Result } from "../domain/result.js";

interface InventoryProjectionResult {
  readonly root_sha256: string;
  readonly source_evidence_ids: readonly string[];
  readonly limitations: readonly string[];
}

export interface InventoryProjectionEvidenceResult {
  readonly evidence: Evidence;
  readonly sources: readonly Evidence[];
}

interface InventoryProjectionOptions<
  Output extends InventoryProjectionResult & JsonValue,
> {
  readonly rawInput: unknown;
  readonly lookup?: EvidenceLookup;
  readonly execution?: Pick<ExecutionOptions, "signal">;
  readonly project: (
    input: ParsedInventorySet,
  ) => Result<Output, AnalysisInputError>;
  readonly operation: string;
  readonly predicateType: string;
  readonly provider: EvidenceProvider;
  readonly subjectFormat: (first: Evidence) => EvidenceSubjectTarget["format"];
}

/** Resolve source inventory once, then wrap its family projection in Evidence. */
export const projectInventoryEvidence = <
  Output extends InventoryProjectionResult & JsonValue,
>(
  options: InventoryProjectionOptions<Output>,
): Result<InventoryProjectionEvidenceResult, AnalysisError> => {
  const request = resolveEvidenceRequest(
    options.operation,
    options.rawInput,
    applicationInventoryProjectionInputSchema,
    options.lookup,
    options.execution,
  );
  if (!request.ok) return request;
  const source = readApplicationInventoryProjection(
    request.value.input,
    options.operation,
  );
  if (!source.ok) return source;
  const projected = options.project(source.value);
  if (!projected.ok) return projected;
  const result = projected.value;
  const first = source.value.evidence[0];
  return ok({
    evidence: createEvidence(
      first?.subject === null || first?.subject === undefined
        ? undefined
        : {
            path: first.subject.local_path,
            sha256: result.root_sha256,
            format: options.subjectFormat(first),
          },
      options.provider,
      {
        predicateType: options.predicateType,
        operation: options.operation,
        parameters: { inventory_evidence_ids: [...result.source_evidence_ids] },
        result,
        rawResult: null,
        confidence: "inferred",
        authority: "analyst-inference",
        environment: null,
        limitations: result.limitations,
        evidenceLinks: result.source_evidence_ids,
      },
    ),
    sources: source.value.evidence,
  });
};
