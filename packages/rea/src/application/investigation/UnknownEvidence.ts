import type { BinaryTarget } from "../../domain/binaryTargetTypes.js";
import { createEvidence, type Evidence } from "../../domain/evidence.js";
import type {
  RecordUnknownInput,
  UpdateUnknownInput,
} from "../../domain/residualUnknown.js";
import type { ProviderIdentity } from "../AnalysisProvider.js";

/** Provider identity for analyst-authored residual-unknown mutations. */
const UNKNOWN_REGISTRY_PROVIDER: ProviderIdentity = {
  id: "rea-unknown-registry",
  name: "REA residual unknown registry",
  version: "1",
};

type UnknownMutation =
  | { readonly operation: "record_unknown"; readonly input: RecordUnknownInput }
  | {
      readonly operation: "update_unknown";
      readonly input: UpdateUnknownInput;
    };

/** Create immutable evidence for one approved residual-unknown mutation. */
export const unknownMutationEvidence = (
  target: BinaryTarget | undefined,
  mutation: UnknownMutation,
): Evidence =>
  createEvidence(target, UNKNOWN_REGISTRY_PROVIDER, {
    predicateType: "rea.residual-unknown-mutation",
    operation: mutation.operation,
    parameters: { ...mutation.input },
    result:
      mutation.operation === "record_unknown"
        ? {
            action: "record",
            question: mutation.input.question,
            required_authority: mutation.input.required_authority,
            required_confidence: mutation.input.required_confidence,
          }
        : { action: "update", status: mutation.input.status },
    confidence: "derived",
    authority: "analyst-inference",
    evidenceLinks: unknownEvidenceLinks(mutation.input),
    limitations: [
      "Registry mutation evidence records analyst intent, not proof of the answer.",
    ],
  });

/** Deduplicate evidence links carried by an unknown mutation. */
const unknownEvidenceLinks = (
  input: RecordUnknownInput | UpdateUnknownInput,
): string[] => [
  ...new Set([
    ...input.supporting_evidence_ids,
    ...input.contradicting_evidence_ids,
    ...("resolution" in input && input.resolution !== null
      ? input.resolution.evidence_ids
      : []),
  ]),
];
