import type { ArtifactInventorySnapshot } from "./artifactInventorySnapshot.js";
import type { ArtifactExtractionResult } from "./artifactGraph.js";

/** A complete inventory retained when releasing its provider resources fails. */
export interface ArtifactInventoryPartialObservation {
  readonly kind: "artifact-inventory";
  readonly inventory: ArtifactInventorySnapshot;
}

/** Durable extracted files retained when their descriptor cleanup is unresolved. */
export interface ArtifactExtractionPartialObservation {
  readonly kind: "artifact-extraction";
  readonly extraction: ArtifactExtractionResult;
}
