import type {
  ReconstructionObligation,
  ReconstructionObligationManifest,
} from "../domain/reconstructionObligationLedgerSchemas.js";
import { reconstructionObligationEvidenceIds } from "../domain/reconstructionObligationLedgerIntegrity.js";
import { compareUnicodeCodePoints } from "../domain/unicodeCodePointOrder.js";

export const obligationLedgerEvidenceLinks = (
  obligations: readonly ReconstructionObligation[],
  manifest: ReconstructionObligationManifest,
): string[] =>
  [
    ...new Set([
      ...reconstructionObligationEvidenceIds(obligations),
      ...manifest.bindings.flatMap((binding) => [
        ...binding.original_cases.map(({ evidence_id: id }) => id),
        ...binding.fixtures.flatMap(({ evidence_ids: ids }) => ids),
        ...(binding.verifier === null
          ? []
          : [binding.verifier.result_evidence_id]),
      ]),
      ...manifest.contradictions.flatMap(({ evidence_ids: ids }) => ids),
    ]),
  ].sort(compareUnicodeCodePoints);
