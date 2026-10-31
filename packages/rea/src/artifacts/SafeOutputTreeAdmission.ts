import { AnalysisInputError } from "../domain/analysisErrorCore.js";
import { ArtifactReaderFailure } from "./ArtifactReader.js";

/**
 * `SafeOutputTree.create` refused the caller's selected destination itself:
 * a relative or reserved root, an existing root, or an accepted existing root
 * that is not an empty directory, or an unavailable parent observed during
 * destination admission.
 * Setup failures after a tree is acquired are not refusals of the selection.
 */
export class SafeOutputTreeDestinationRefusal extends ArtifactReaderFailure {
  constructor(message: string, options?: { readonly cause?: unknown }) {
    super("path", message, options);
    this.name = "SafeOutputTreeDestinationRefusal";
  }
}

/**
 * Attribute a destination refusal to the caller's selected directory argument.
 * A refusal raised after tree acquisition, such as a non-empty accepted root,
 * arrives wrapped by `SafeOutputTreeCreationFailure`; every other failure,
 * including acquired-tree setup failures, keeps its artifact semantics.
 */
export const outputDirectoryAdmissionRefusal = (
  operation: string,
  field: string,
  cause: unknown,
): unknown => {
  if (!(cause instanceof ArtifactReaderFailure) || cause.cleanup !== undefined)
    return cause;
  const refusal =
    cause instanceof SafeOutputTreeDestinationRefusal
      ? cause
      : cause.cause instanceof SafeOutputTreeDestinationRefusal
        ? cause.cause
        : undefined;
  return refusal === undefined
    ? cause
    : new AnalysisInputError(
        operation,
        { cause, userMessage: refusal.message },
        [{ path: [field], reason: "invalid_value", message: refusal.message }],
      );
};
