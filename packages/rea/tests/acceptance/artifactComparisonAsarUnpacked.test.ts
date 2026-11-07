import { createPackageWithOptions } from "@electron/asar";
import { TextReader, Uint8ArrayWriter, ZipWriter } from "@zip.js/zip.js";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";

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

const historicalInventory = (source: Evidence): Evidence => {
  const inventory = artifactInventoryResultSchema.parse(
    source.normalized_result,
  );
  const occurrences = inventory.occurrences.map(
    ({ unpacked: _unpacked, ...occurrence }) => occurrence,
  );
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

it("compares ASAR companion declarations from public MCP inventories and preserves historical unknowns", async () => {
  const root = await createTestTempDirectory("rea-asar-unpacked-comparison-");
  const input = join(root, "source");
  await mkdir(input);
  await writeFile(join(input, "member.bin"), "identical child bytes");
  const packedPath = join(root, "packed.asar");
  const unpackedPath = join(root, "unpacked.asar");
  await createPackageWithOptions(input, packedPath, {});
  await createPackageWithOptions(input, unpackedPath, { unpack: "*.bin" });

  // This fixture validates advertised SDK-converted input/output schemas and
  // every structured response against the declared JSON Schema dialect.
  const { call } = await connectLocalToolsMcp();
  const inspect = async (path: string): Promise<Evidence> => {
    const opened = await call("open_binary", { path });
    expect(opened.isError, JSON.stringify(opened)).not.toBe(true);
    const inspected = await call("inspect_artifact", {});
    expect(inspected.isError, JSON.stringify(inspected)).not.toBe(true);
    const inspection = artifactInspectionResultSchema.parse(
      parseEvidence(inspected.structuredContent).normalized_result,
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
  const packed = await inspect(packedPath);
  const unpacked = await inspect(unpackedPath);
  const packedInventory = artifactInventoryResultSchema.parse(
    packed.normalized_result,
  );
  const unpackedInventory = artifactInventoryResultSchema.parse(
    unpacked.normalized_result,
  );
  const packedChild = packedInventory.occurrences.find(
    ({ logical_path }) => logical_path === "member.bin",
  );
  const unpackedChild = unpackedInventory.occurrences.find(
    ({ logical_path }) => logical_path === "member.bin",
  );
  expect(packedChild).toMatchObject({
    unpacked: false,
    hash_status: "verified",
  });
  expect(unpackedChild).toMatchObject({
    unpacked: true,
    hash_status: "verified",
    artifact_id: packedChild?.artifact_id,
  });
  expect(
    packedInventory.occurrences.find(
      ({ logical_path }) => logical_path === ".",
    ),
  ).not.toHaveProperty("unpacked");

  const known = await compare(packed, unpacked);
  expect(
    known.changes.find(({ logical_path }) => logical_path === "member.bin"),
  ).toEqual({
    classification: "changed",
    logical_path: "member.bin",
    dimensions: ["metadata"],
    left_occurrence_id: packedChild?.occurrence_id,
    right_occurrence_id: unpackedChild?.occurrence_id,
    left_artifact_id: packedChild?.artifact_id,
    right_artifact_id: unpackedChild?.artifact_id,
    evidence_links: [packed.evidence_id, unpacked.evidence_id],
  });

  // Model an authenticated pre-field snapshot with its original graph commitment,
  // rather than editing a current Evidence payload without updating its identity.
  const historical = historicalInventory(packed);
  const historicalParsed = parseArtifactInventoryEvidence(historical);
  expect(
    historicalParsed.inventory.occurrences.map(
      ({ occurrence_id }) => occurrence_id,
    ),
  ).toEqual(
    packedInventory.occurrences.map(({ occurrence_id }) => occurrence_id),
  );
  expect(
    historicalParsed.inventory.occurrences.every(
      (occurrence) => !Object.hasOwn(occurrence, "unpacked"),
    ),
  ).toBe(true);
  const unknown = await compare(historical, unpacked);
  expect(
    unknown.changes.find(({ logical_path }) => logical_path === "member.bin"),
  ).toMatchObject({
    classification: "unknown",
    dimensions: ["availability"],
    evidence_links: [historical.evidence_id, unpacked.evidence_id],
  });

  const zipPath = join(root, "control.zip");
  const writer = new ZipWriter(new Uint8ArrayWriter());
  await writer.add("member.bin", new TextReader("identical child bytes"));
  await writeFile(zipPath, await writer.close());
  const zip = await inspect(zipPath);
  const zipOccurrences = artifactInventoryResultSchema.parse(
    zip.normalized_result,
  ).occurrences;
  expect(zipOccurrences).toContainEqual(
    expect.objectContaining({ logical_path: "member.bin" }),
  );
  expect(
    zipOccurrences.every(
      (occurrence) => !Object.hasOwn(occurrence, "unpacked"),
    ),
  ).toBe(true);
  const unchanged = await compare(zip, zip);
  expect(unchanged).toMatchObject({
    status: "unchanged",
    changes: [],
    summary: { unknown: 0 },
  });
});
