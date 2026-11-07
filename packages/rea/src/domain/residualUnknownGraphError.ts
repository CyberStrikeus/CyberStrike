/** Facts emitted by the residual-unknown graph validator, without bundle payloads. */
export type ResidualUnknownGraphConstraint = { readonly unknown_id: string } & (
  | {
      readonly kind:
        | "history_gap"
        | "revision_chain"
        | "contradicting_evidence"
        | "resolution_unproven"
        | "dependency_cycle";
    }
  | { readonly kind: "missing_evidence"; readonly evidence_id: string }
  | { readonly kind: "missing_unknown"; readonly related_unknown_id: string }
);

export const describeResidualUnknownGraphConstraint = (
  constraint: ResidualUnknownGraphConstraint,
): string => {
  switch (constraint.kind) {
    case "history_gap":
      return `Residual unknown ${constraint.unknown_id} revision history has a gap`;
    case "revision_chain":
      return `Residual unknown ${constraint.unknown_id} revision chain is broken`;
    case "missing_evidence":
      return `Residual unknown references missing evidence ${constraint.evidence_id}`;
    case "missing_unknown":
      return `Residual unknown references missing unknown ${constraint.related_unknown_id}`;
    case "contradicting_evidence":
      return `Residual unknown ${constraint.unknown_id} retains contradicting evidence`;
    case "resolution_unproven":
      return `Residual unknown ${constraint.unknown_id} has no qualifying resolution evidence`;
    case "dependency_cycle":
      return "Residual unknown dependency graph contains a cycle";
  }
};

/** Caller input violates a residual-unknown reference or history constraint. */
export class InvalidResidualUnknownGraphError extends TypeError {
  constructor(readonly constraint: ResidualUnknownGraphConstraint) {
    super(describeResidualUnknownGraphConstraint(constraint));
    this.name = "InvalidResidualUnknownGraphError";
  }
}
