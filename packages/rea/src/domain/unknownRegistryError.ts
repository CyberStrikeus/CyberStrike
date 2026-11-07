import type { ResidualUnknownGraphConstraint } from "./residualUnknownGraphError.js";
import { AnalysisError } from "./analysisErrorBase.js";

/** Residual-unknown mutation failed a lifecycle, reference, or CAS invariant. */
export class UnknownRegistryError extends AnalysisError {
  readonly _tag = "UnknownRegistryError";

  readonly constraint: ResidualUnknownGraphConstraint | undefined;
  readonly reason:
    | "not-found"
    | "already-exists"
    | "revision-conflict"
    | "invalid-transition"
    | "integrity"
    | "limit"
    | "constraint";

  constructor(
    failure:
      | "not-found"
      | "already-exists"
      | "revision-conflict"
      | "invalid-transition"
      | "integrity"
      | "limit"
      | ResidualUnknownGraphConstraint,
    options?: ErrorOptions,
  ) {
    const reason =
      typeof failure === "string"
        ? failure
        : failure.kind === "history_gap" || failure.kind === "revision_chain"
          ? "integrity"
          : "constraint";
    super(`Residual unknown registry mutation failed: ${reason}`, options);
    this.reason = reason;
    this.constraint = typeof failure === "string" ? undefined : failure;
  }
}
