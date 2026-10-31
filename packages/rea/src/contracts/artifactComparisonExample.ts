import {
  artifactGraphDigest,
  artifactIdForContent,
  artifactManifestId,
  occurrenceIdForLocation,
} from "../domain/artifactIdentity.js";
import type {
  ArtifactEdge,
  ArtifactNode,
  ArtifactOccurrence,
  IntegrityContradiction,
} from "../domain/artifactGraph.js";
import { createEvidence } from "../domain/evidence.js";
import { jsonValueSchema } from "../domain/jsonValue.js";

const inventory = (digit: string) => {
  const sha = digit.repeat(64);
  const artifactId = artifactIdForContent(sha);
  const nodes: ArtifactNode[] = [
    {
      artifact_id: artifactId,
      format: "file",
      sha256: sha,
      size: 1,
      media_type: null,
      architecture: null,
      content_state: "materialized",
      limitations: [],
    },
  ];
  const occurrences: ArtifactOccurrence[] = [
    {
      occurrence_id: occurrenceIdForLocation({
        rootArtifactId: artifactId,
        logicalPath: ".",
        entryKind: "file",
      }),
      artifact_id: artifactId,
      parent_occurrence_id: null,
      logical_path: ".",
      entry_kind: "file",
      artifact_kind: "resource",
      artifact_format: "file",
      declared_size: 1,
      compressed_size: null,
      executable: false,
      encrypted: false,
      hash_status: "verified",
      source_location: null,
      limitations: [],
    },
  ];
  const edges: ArtifactEdge[] = [];
  const integrityContradictions: IntegrityContradiction[] = [];
  const graphSha256 = artifactGraphDigest({
    nodes,
    occurrences,
    edges,
    contradictions: integrityContradictions,
  });
  return jsonValueSchema.parse({
    manifest: {
      manifest_id: artifactManifestId(artifactId, graphSha256),
      root_artifact_id: artifactId,
      root_sha256: sha,
      root_format: "file",
      graph_sha256: graphSha256,
      node_count: nodes.length,
      occurrence_count: occurrences.length,
      edge_count: edges.length,
    },
    nodes,
    occurrences,
    edges,
    provenance: [],
    integrity_contradictions: integrityContradictions,
    coverage: { scope: "root", status: "complete" },
    limitations: [],
  });
};

const provider = {
  id: "rea-artifact",
  name: "REA artifact graph",
  version: "1",
} as const;

/** Canonical complete inputs used to advertise artifact comparison. */
export const ARTIFACT_COMPARISON_EXAMPLE = {
  left: createEvidence(
    { path: "fixture-left", sha256: "0".repeat(64), format: "file" },
    provider,
    {
      operation: "inventory_artifact",
      parameters: {},
      result: inventory("0"),
      confidence: "observed",
      authority: "shipped-artifact",
    },
  ),
  right: createEvidence(
    { path: "fixture-right", sha256: "1".repeat(64), format: "file" },
    provider,
    {
      operation: "inventory_artifact",
      parameters: {},
      result: inventory("1"),
      confidence: "observed",
      authority: "shipped-artifact",
    },
  ),
} as const;
