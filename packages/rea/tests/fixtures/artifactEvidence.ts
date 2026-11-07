import { artifactInventoryResultSchema } from "../../src/domain/artifactGraph.js";
import { createEvidence, type Evidence } from "../../src/domain/evidence.js";

/** Partition a real scan into authenticated partial observations for merge tests. */
export const fragmentInventoryEvidence = (
  evidence: Evidence,
  count: number,
): readonly Evidence[] => {
  const inventory = artifactInventoryResultSchema.parse(
    evidence.normalized_result,
  );
  const subject = evidence.subject;
  if (subject === null)
    throw new TypeError("Inventory has no artifact subject");
  return Array.from({ length: count }, (_, index) =>
    createEvidence(
      {
        path: subject.local_path,
        sha256: subject.digest.sha256,
        format: subject.format,
      },
      evidence.provider,
      {
        operation: "inventory_artifact",
        parameters: evidence.parameters,
        confidence: "derived",
        authority: evidence.authority,
        result: {
          ...inventory,
          nodes: inventory.nodes.filter(
            (_, ordinal) => ordinal % count === index,
          ),
          occurrences: inventory.occurrences.filter(
            (_, ordinal) => ordinal % count === index,
          ),
          edges: inventory.edges.filter(
            (_, ordinal) => ordinal % count === index,
          ),
        },
      },
    ),
  );
};
