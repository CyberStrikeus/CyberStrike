import { ArtifactReaderFailure } from "./ArtifactReader.js";
import type { SafeOutputTree } from "./SafeOutputTree.js";

/** Setup failed after this tree was acquired; callers still own this exact tree. */
export class SafeOutputTreeCreationFailure extends ArtifactReaderFailure {
  readonly tree: SafeOutputTree;

  constructor(cause: unknown, tree: SafeOutputTree) {
    const primary =
      cause instanceof ArtifactReaderFailure
        ? cause
        : new ArtifactReaderFailure("io", errorMessage(cause), { cause });
    super(
      primary.reason,
      primary.message,
      {
        cause: primary,
        cancellation: primary.cancellation,
        ...(primary.cleanup === undefined ? {} : { cleanup: primary.cleanup }),
        ...(primary.partialObservation === undefined
          ? {}
          : { partialObservation: primary.partialObservation }),
      },
      primary.details,
    );
    this.name = "SafeOutputTreeCreationFailure";
    this.tree = tree;
  }
}

const errorMessage = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);
