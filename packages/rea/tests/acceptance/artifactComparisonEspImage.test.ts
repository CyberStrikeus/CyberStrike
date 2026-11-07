import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";

import { ESP32C3_APP_SEGMENTS, espImage } from "../fixtures/espImage.js";
import { artifactInventorySummaryViewResultSchema } from "../../src/domain/analysisView/analysisView.js";
import { artifactComparisonResultSchema } from "../../src/domain/artifactComparison.js";
import { artifactInspectionResultSchema } from "../../src/domain/artifactInspection.js";
import { artifactInventoryResultSchema } from "../../src/domain/artifactGraph.js";
import {
  artifactGraphDigest,
  artifactManifestId,
} from "../../src/domain/artifactIdentity.js";
import {
  createEvidence,
  parseEvidence,
  type Evidence,
} from "../../src/domain/evidence.js";
import { connectLocalToolsMcp } from "../fixtures/localToolsMcp.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";

it("reports an ESP segment whose load address alone changed", async () => {
  const root = await createTestTempDirectory("rea-esp-comparison-");
  const { call } = await connectLocalToolsMcp();
  const inspect = async (
    name: string,
    segments: typeof ESP32C3_APP_SEGMENTS,
  ): Promise<Evidence> => {
    const path = join(root, name);
    await writeFile(path, espImage({ segments }));
    const opened = await call("open_binary", { path });
    expect(opened.isError, JSON.stringify(opened)).not.toBe(true);
    const response = await call("inspect_artifact", {});
    expect(response.isError, JSON.stringify(response)).not.toBe(true);
    const inventory = artifactInspectionResultSchema
      .parse(parseEvidence(response.structuredContent).normalized_result)
      .substeps.find(
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
  const segment = (evidence: Evidence, path: string) => {
    const occurrence = artifactInventoryResultSchema
      .parse(evidence.normalized_result)
      .occurrences.find(({ logical_path }) => logical_path === path);
    if (occurrence === undefined) throw new Error(`Missing ${path}`);
    return occurrence;
  };

  // The same bytes, with the DRAM segment loading 8 KiB higher.
  const moved = ESP32C3_APP_SEGMENTS.map((item, index) =>
    index === 1 ? { ...item, address: 0x3fc8_a000 } : item,
  );
  const left = await inspect("app.bin", ESP32C3_APP_SEGMENTS);
  const right = await inspect("moved.bin", moved);
  const leftSegment = segment(left, "segment-01.bin");
  const rightSegment = segment(right, "segment-01.bin");
  expect(rightSegment.artifact_id).toBe(leftSegment.artifact_id);
  expect(leftSegment.format_metadata).toMatchObject({ load_addr: 0x3fc8_8000 });
  expect(rightSegment.format_metadata).toMatchObject({
    load_addr: 0x3fc8_a000,
  });

  const changed = await compare(left, right);
  expect(
    changed.changes.filter(({ logical_path }) => logical_path !== "."),
  ).toEqual([
    {
      classification: "changed",
      logical_path: "segment-01.bin",
      dimensions: ["metadata"],
      left_occurrence_id: leftSegment.occurrence_id,
      right_occurrence_id: rightSegment.occurrence_id,
      left_artifact_id: leftSegment.artifact_id,
      right_artifact_id: rightSegment.artifact_id,
      evidence_links: [left.evidence_id, right.evidence_id],
    },
  ]);

  // Equal declarations leave every segment unchanged.
  const same = await compare(
    left,
    await inspect("copy.bin", ESP32C3_APP_SEGMENTS),
  );
  expect(same.changes).toEqual([]);
});

/** The inventory as REA recorded it before ESP image roots had `flash_dump`. */
const withoutFlashDump = (source: Evidence): Evidence => {
  const inventory = artifactInventoryResultSchema.parse(
    source.normalized_result,
  );
  const occurrences = inventory.occurrences.map((occurrence) => {
    if (occurrence.format_metadata?.kind !== "esp-image") return occurrence;
    const { flash_dump: _dump, ...historical } = occurrence.format_metadata;
    return { ...occurrence, format_metadata: historical };
  });
  // Recommit the reduced graph, as that REA committed it.
  const graphSha256 = artifactGraphDigest({
    nodes: inventory.nodes,
    occurrences,
    edges: inventory.edges,
    contradictions: inventory.integrity_contradictions,
  });
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
      result: {
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
      },
      confidence: "observed",
      authority: "shipped-artifact",
    },
  );
};

it("reads and compares ESP image Evidence recorded before flash_dump", async () => {
  const root = await createTestTempDirectory("rea-esp-historical-");
  const path = join(root, "app.bin");
  await writeFile(path, espImage({ segments: ESP32C3_APP_SEGMENTS }));
  const { call } = await connectLocalToolsMcp();
  const opened = await call("open_binary", { path });
  expect(opened.isError, JSON.stringify(opened)).not.toBe(true);
  const inspected = await call("inspect_artifact", {});
  expect(inspected.isError, JSON.stringify(inspected)).not.toBe(true);
  const current = parseEvidence(
    artifactInspectionResultSchema
      .parse(parseEvidence(inspected.structuredContent).normalized_result)
      .substeps.find(({ operation }) => operation === "inventory_artifact")
      ?.evidence,
  );
  const historical = withoutFlashDump(current);
  const recorded = JSON.stringify(historical);
  const rootMetadata = (evidence: Evidence) =>
    artifactInventoryResultSchema
      .parse(evidence.normalized_result)
      .occurrences.find(({ logical_path }) => logical_path === ".")
      ?.format_metadata;
  expect(rootMetadata(current)).toMatchObject({
    kind: "esp-image",
    flash_dump: null,
  });
  expect(rootMetadata(historical)).not.toHaveProperty("flash_dump");

  const compared = await call("compare_artifacts", {
    left: historical,
    right: current,
  });
  expect(compared.isError, JSON.stringify(compared)).not.toBe(true);
  expect(
    artifactComparisonResultSchema.parse(
      parseEvidence(compared.structuredContent).normalized_result,
    ),
  ).toMatchObject({ status: "unchanged", changes: [] });

  const viewed = await call("inspect_analysis_view", {
    source: { kind: "inline", evidence: historical },
    view: { kind: "summary" },
  });
  expect(viewed.isError, JSON.stringify(viewed)).not.toBe(true);
  const summary = artifactInventorySummaryViewResultSchema.parse(
    parseEvidence(viewed.structuredContent).normalized_result,
  ).summary;
  expect(summary.root_format_metadata).toMatchObject({ kind: "esp-image" });
  expect(summary.root_format_metadata).not.toHaveProperty("flash_dump");
  // Reading the record leaves the graph its digest covers unchanged.
  expect(JSON.stringify(historical)).toBe(recorded);
});
