import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";

import { nodeSeaPe } from "../../src/artifacts/nodeSea/NodeSea.fixture.js";
import {
  artifactInventoryResultSchema,
  type ArtifactInventoryResult,
} from "../../src/domain/artifactGraph.js";
import { artifactComparisonResultSchema } from "../../src/domain/artifactComparison.js";
import { artifactInspectionResultSchema } from "../../src/domain/artifactInspection.js";
import {
  artifactGraphDigest,
  artifactManifestId,
} from "../../src/domain/artifactIdentity.js";
import { parseArtifactInventoryEvidence } from "../../src/domain/artifactInventoryEvidence.js";
import {
  createEvidence,
  parseEvidence,
  type Evidence,
} from "../../src/domain/evidence.js";
import { connectLocalToolsMcp } from "../fixtures/localToolsMcp.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";

const withoutEntryMetadata = (source: Evidence): Evidence => {
  const inventory = artifactInventoryResultSchema.parse(
    source.normalized_result,
  );
  const occurrences = inventory.occurrences.map((occurrence) => {
    if (occurrence.format_metadata?.kind !== "node-sea-entry")
      return occurrence;
    const { format_metadata: _metadata, ...historical } = occurrence;
    return historical;
  });
  const graphSha256 = artifactGraphDigest({
    nodes: inventory.nodes,
    occurrences,
    edges: inventory.edges,
    contradictions: inventory.integrity_contradictions,
  });
  const historical: ArtifactInventoryResult = {
    ...inventory,
    occurrences,
    manifest: {
      ...inventory.manifest,
      graph_sha256: graphSha256,
      manifest_id: artifactManifestId(
        inventory.manifest.root_artifact_id,
        graphSha256,
      ),
    },
  };
  return createEvidence(
    {
      path: source.subject!.local_path,
      sha256: inventory.manifest.root_sha256,
      format: inventory.manifest.root_format,
    },
    source.provider,
    {
      operation: "inventory_artifact",
      parameters: {},
      result: historical,
      confidence: "derived",
      authority: "shipped-artifact",
    },
  );
};

it("compares raw SEA asset keys without interpreting serialization order as metadata", async () => {
  const root = await createTestTempDirectory("rea-sea-key-comparison-");
  const nfc = "caf\u00e9.txt";
  const nfd = "cafe\u0301.txt";
  const body = "identical asset bytes";
  const { call } = await connectLocalToolsMcp();
  const inspect = async (
    name: string,
    assets: readonly { name: string; body: string }[],
  ): Promise<Evidence> => {
    const path = join(root, name);
    await writeFile(path, nodeSeaPe({ fuse: "set", assets }));
    const opened = await call("open_binary", { path });
    expect(opened.isError, JSON.stringify(opened)).not.toBe(true);
    const response = await call("inspect_artifact", {});
    expect(response.isError, JSON.stringify(response)).not.toBe(true);
    const inspection = artifactInspectionResultSchema.parse(
      parseEvidence(response.structuredContent).normalized_result,
    );
    const inventory = inspection.substeps.find(
      ({ operation }) => operation === "inventory_artifact",
    )?.evidence;
    if (inventory === undefined) throw new Error("Missing inventory Evidence");
    return parseEvidence(inventory);
  };
  const compare = async (left: Evidence, right: Evidence) => {
    const response = await call("compare_artifacts", { left, right });
    expect(response.isError, JSON.stringify(response)).not.toBe(true);
    return artifactComparisonResultSchema.parse(
      parseEvidence(response.structuredContent).normalized_result,
    );
  };
  const child = (evidence: Evidence) => {
    const occurrence = artifactInventoryResultSchema
      .parse(evidence.normalized_result)
      .occurrences.find(({ logical_path }) => logical_path === nfc);
    if (occurrence === undefined)
      throw new Error("Missing SEA asset occurrence");
    return occurrence;
  };

  const left = await inspect("nfc.exe", [{ name: nfc, body }]);
  const right = await inspect("nfd.exe", [{ name: nfd, body }]);
  const originalLeft = JSON.stringify(left);
  const originalRight = JSON.stringify(right);
  const leftChild = child(left);
  const rightChild = child(right);
  expect(leftChild).toMatchObject({
    logical_path: nfc,
    source_path: nfc,
    hash_status: "verified",
    format_metadata: { kind: "node-sea-entry", source_path: nfc },
  });
  expect(rightChild).toMatchObject({
    logical_path: nfc,
    source_path: nfd,
    hash_status: "verified",
    artifact_id: leftChild.artifact_id,
    format_metadata: { kind: "node-sea-entry", source_path: nfd },
  });
  const changed = await compare(left, right);
  expect(
    changed.changes.find(({ logical_path }) => logical_path === nfc),
  ).toEqual({
    classification: "changed",
    logical_path: nfc,
    dimensions: ["metadata"],
    left_occurrence_id: leftChild.occurrence_id,
    right_occurrence_id: rightChild.occurrence_id,
    left_artifact_id: leftChild.artifact_id,
    right_artifact_id: rightChild.artifact_id,
    evidence_links: [left.evidence_id, right.evidence_id],
  });

  const ordered = await inspect("ordered.exe", [
    { name: nfc, body },
    { name: "other.txt", body: "other" },
  ]);
  const reordered = await inspect("reordered.exe", [
    { name: "other.txt", body: "other" },
    { name: nfc, body },
  ]);
  const orderedMetadata = child(ordered).format_metadata;
  const reorderedMetadata = child(reordered).format_metadata;
  expect(orderedMetadata).toMatchObject({ source_path: nfc, index: 1 });
  expect(reorderedMetadata).toMatchObject({ source_path: nfc, index: 2 });
  expect(orderedMetadata).not.toEqual(reorderedMetadata);
  const sameKey = await compare(ordered, reordered);
  expect(
    sameKey.changes.filter(({ logical_path }) => logical_path !== "."),
  ).toEqual([]);

  // Recommit the reduced graph before sealing modeled historical Evidence.
  const historical = withoutEntryMetadata(left);
  const parsed = parseArtifactInventoryEvidence(historical);
  expect(
    parsed.inventory.occurrences.find(
      ({ logical_path }) => logical_path === nfc,
    ),
  ).not.toHaveProperty("format_metadata");
  const unknown = await compare(historical, right);
  expect(
    unknown.changes.find(({ logical_path }) => logical_path === nfc),
  ).toMatchObject({
    classification: "unknown",
    dimensions: ["availability"],
    evidence_links: [historical.evidence_id, right.evidence_id],
  });
  const reversed = await compare(right, historical);
  expect(
    reversed.changes.find(({ logical_path }) => logical_path === nfc),
  ).toMatchObject({
    classification: "unknown",
    dimensions: ["availability"],
    evidence_links: [right.evidence_id, historical.evidence_id],
  });
  expect(JSON.stringify(left)).toBe(originalLeft);
  expect(JSON.stringify(right)).toBe(originalRight);
});
