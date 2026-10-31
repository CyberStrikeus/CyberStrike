import { z } from "zod";

import { uniqueSorted } from "./canonicalOrdering.js";
import { prefixedDigestSchema } from "./digests.js";
import { EvidenceIntegrityError } from "./evidenceErrors.js";
import { readEvidencePayload } from "./evidenceValidation.js";
import type { Evidence } from "./evidence.js";

const evidenceIdSchema = prefixedDigestSchema("ev");
const sideParametersSchema = z.object({
  left_evidence_id: evidenceIdSchema.optional(),
  right_evidence_id: evidenceIdSchema.optional(),
  left_evidence_ids: z.array(evidenceIdSchema).min(1).optional(),
  right_evidence_ids: z.array(evidenceIdSchema).min(1).optional(),
});

/** Resolve each selected side and validate aliases and duplicates within that role. */
export const comparisonSourceEvidenceSides = (
  evidence: Evidence,
): { left: string[]; right: string[] } => {
  const parsed = readEvidencePayload(sideParametersSchema, evidence.parameters);
  if (!parsed.ok) throw parsed.error;
  const parameters = parsed.value;
  if (
    (parameters.left_evidence_id === undefined) !==
      (parameters.right_evidence_id === undefined) ||
    (parameters.left_evidence_ids === undefined) !==
      (parameters.right_evidence_ids === undefined)
  )
    throw new EvidenceIntegrityError(
      "Comparison Evidence source representation omitted one side",
    );
  const side = (single: string | undefined, multiple: string[] | undefined) => {
    if (
      single !== undefined &&
      multiple !== undefined &&
      (multiple.length !== 1 || multiple[0] !== single)
    )
      throw new EvidenceIntegrityError(
        "Comparison Evidence source representations disagree",
      );
    const selected = single === undefined ? (multiple ?? []) : [single];
    if (selected.length === 0)
      throw new EvidenceIntegrityError(
        "Comparison Evidence omitted its source parameters",
      );
    if (new Set(selected).size !== selected.length)
      throw new EvidenceIntegrityError(
        "Comparison Evidence repeats a source within one side",
      );
    return selected;
  };
  return {
    left: side(parameters.left_evidence_id, parameters.left_evidence_ids),
    right: side(parameters.right_evidence_id, parameters.right_evidence_ids),
  };
};

/** Resolve the source closure without counting observations shared by both roles twice. */
export const comparisonSourceEvidenceIds = (evidence: Evidence): string[] => {
  const sides = comparisonSourceEvidenceSides(evidence);
  return uniqueSorted([...sides.left, ...sides.right]);
};
