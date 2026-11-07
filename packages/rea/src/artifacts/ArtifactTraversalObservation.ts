import { compareUnicodeCodePoints } from "../domain/unicodeCodePointOrder.js";
import { normalizeArtifactPath } from "./ArtifactPaths.js";
import type {
  ArtifactReaderTraversal,
  ArtifactTraversalOmission,
  ArtifactTraversalOptions,
} from "./ArtifactReader.js";

/** Retain producer coverage and omissions across one or more exhausted traversals. */
export class ArtifactTraversalObservation implements ArtifactTraversalOptions {
  readonly #limitations = new Set<string>();
  #unknown = false;

  readonly onCoverage = (coverage: ArtifactReaderTraversal): void => {
    this.#unknown ||= coverage.status === "unknown";
    for (const limitation of coverage.limitations)
      this.#limitations.add(limitation);
  };

  readonly onOmission = (omission: ArtifactTraversalOmission): void => {
    const path = normalizeArtifactPath(omission.path);
    this.#unknown = true;
    this.#limitations.add(
      `Artifact traversal omitted ${omission.kind} at ${JSON.stringify(path)}.`,
    );
  };

  snapshot(): ArtifactReaderTraversal {
    return {
      status: this.#unknown ? "unknown" : "complete",
      limitations: [...this.#limitations].sort(compareUnicodeCodePoints),
    };
  }
}
