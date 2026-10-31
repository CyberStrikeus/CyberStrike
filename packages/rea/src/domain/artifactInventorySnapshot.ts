import type {
  ArtifactInventoryCoverage,
  ArtifactInventoryResult,
  ArtifactNode,
  IntegrityContradiction,
} from "./artifactGraph.js";

/** Immutable inventory produced by one complete artifact scan. */
export interface ArtifactInventorySnapshot {
  readonly manifest: ArtifactInventoryResult["manifest"];
  readonly nodes: readonly ArtifactNode[];
  readonly occurrences: ArtifactInventoryResult["occurrences"];
  readonly edges: ArtifactInventoryResult["edges"];
  readonly provenance: ReadonlyArray<
    ArtifactInventoryResult["provenance"][number]
  >;
  readonly integrity_contradictions: readonly IntegrityContradiction[];
  readonly ines?: ArtifactInventoryResult["ines"];
  readonly coverage: ArtifactInventoryCoverage;
  readonly limitations: readonly string[];
}
