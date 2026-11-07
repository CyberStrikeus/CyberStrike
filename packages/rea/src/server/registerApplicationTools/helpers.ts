import type { ToolResultDelivery } from "../ToolResultDelivery.js";
import { APPLICATION_TOOL_CONTRACTS } from "../../contracts/applicationToolContracts.js";
import type { Evidence } from "../../domain/evidence.js";
import type { ApplicationToolRegistration } from "./types.js";

export const recordResult = (
  options: ApplicationToolRegistration & {
    readonly delivery: ToolResultDelivery;
  },
  contract: (typeof APPLICATION_TOOL_CONTRACTS)[number],
  evidence: Evidence,
  unknownKind?:
    | "application-version-comparison"
    | "javascript-export-shape"
    | "source-to-bundle-comparison",
) => {
  const recorded = recordApplicationResult(options, evidence, unknownKind);
  return options.delivery.toEvidenceToolResult(evidence, contract, recorded);
};

/** Record the complete parent before choosing a delivery projection. */
export const recordApplicationResult = (
  options: ApplicationToolRegistration,
  evidence: Evidence,
  unknownKind?:
    | "application-version-comparison"
    | "javascript-export-shape"
    | "source-to-bundle-comparison",
) =>
  unknownKind === undefined
    ? options.recordEvidence?.(evidence)
    : options.recordEvidenceWithUnknown?.(
        evidence,
        unknownRegistration(evidence, unknownKind),
      );

const unknownRegistration = (
  evidence: Evidence,
  kind:
    | "application-version-comparison"
    | "javascript-export-shape"
    | "source-to-bundle-comparison",
) => ({
  // Scope unknown identity to the comparison while keeping exact replays stable.
  question: `${
    kind === "application-version-comparison"
      ? "Which application entities remain unmatched or ambiguous across these versions?"
      : kind === "source-to-bundle-comparison"
        ? "Which historical source files remain unmatched or ambiguously mapped to the shipped bundle?"
        : "Which selected JavaScript export return shapes remain dynamic, incomplete, or ambiguously paired?"
  } (comparison ${evidence.evidence_id})`,
  severity: "medium" as const,
  domain: kind,
  supporting_evidence_ids: [evidence.evidence_id],
  contradicting_evidence_ids: [],
  required_authority: "shipped-artifact" as const,
  required_confidence: "observed" as const,
  required_environment: null,
  recommended_probes: [
    {
      operation: "analyze_javascript_application",
      rationale:
        "Repeat static reconstruction with complete artifacts and source maps when available.",
    },
    ...(kind === "application-version-comparison"
      ? [
          {
            operation: "reconcile_javascript_runtime",
            rationale:
              "Add passive runtime Evidence without promoting it to static fact.",
          },
        ]
      : []),
  ],
  relationships: [],
});
