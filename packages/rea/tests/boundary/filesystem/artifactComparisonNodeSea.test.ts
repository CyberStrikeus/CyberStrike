import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { nodeSeaElf } from "../../../src/artifacts/nodeSea/NodeSea.fixture.js";
import { scanCanonicalArtifactInventory } from "../../fixtures/artifactInventory.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { compareArtifacts } from "../../../src/domain/artifactComparison.js";
import {
  artifactInventoryResultSchema,
  type ArtifactInventoryResult,
} from "../../../src/domain/artifactGraph.js";
import {
  artifactGraphDigest,
  artifactManifestId,
} from "../../../src/domain/artifactIdentity.js";
import { createEvidence } from "../../../src/domain/evidence.js";

const observe = (inventory: ArtifactInventoryResult) => {
  const graph = artifactGraphDigest({
    nodes: inventory.nodes,
    occurrences: inventory.occurrences,
    edges: inventory.edges,
    contradictions: inventory.integrity_contradictions,
  });
  inventory.manifest.graph_sha256 = graph;
  inventory.manifest.manifest_id = artifactManifestId(
    inventory.manifest.root_artifact_id,
    graph,
  );
  return createEvidence(
    {
      path: "sea",
      sha256: inventory.manifest.root_sha256,
      format: inventory.manifest.root_format,
    },
    { id: "rea-artifact", name: "REA artifact graph", version: "1" },
    {
      operation: "inventory_artifact",
      parameters: {},
      result: inventory,
      confidence: "observed",
      authority: "shipped-artifact",
    },
  );
};

const inventory = async (key = "data/café.txt") => {
  const directory = await createTestTempDirectory("rea-sea-comparison-");
  const path = join(directory, "app");
  await writeFile(path, nodeSeaElf({ assets: [{ name: key, body: "asset" }] }));
  return artifactInventoryResultSchema.parse(
    await scanCanonicalArtifactInventory(path),
  );
};

const asset = (value: ArtifactInventoryResult) => {
  const occurrence = value.occurrences.find(
    (item) =>
      item.format_metadata?.kind === "node-sea-entry" &&
      item.format_metadata.role === "asset",
  );
  if (occurrence === undefined) throw new Error("Missing asset fixture");
  return occurrence;
};

it("compares exact runtime asset keys despite normalized equal logical paths and bytes", async () => {
  const left = await inventory("data/café.txt");
  const right = await inventory("data/cafe\u0301.txt");
  expect(asset(left).logical_path).toBe(asset(right).logical_path);
  expect(asset(left).artifact_id).toBe(asset(right).artifact_id);
  expect(
    compareArtifacts(observe(left), observe(right)).changes,
  ).toContainEqual(
    expect.objectContaining({
      logical_path: "data/café.txt",
      classification: "changed",
      dimensions: ["metadata"],
    }),
  );
});

it("compares runtime roles while ignoring directory order", async () => {
  const left = await inventory();
  const right = structuredClone(left);
  const metadata = asset(right).format_metadata;
  if (metadata?.kind !== "node-sea-entry")
    throw new Error("Missing SEA metadata");
  metadata.index += 1;
  expect(compareArtifacts(observe(left), observe(right)).status).toBe(
    "unchanged",
  );
  metadata.role = "code-cache";
  expect(compareArtifacts(observe(left), observe(right)).changes).toEqual([
    expect.objectContaining({
      logical_path: "data/café.txt",
      dimensions: ["metadata"],
    }),
  ]);
});

it.each(["verified", "unavailable", "mismatched"] as const)(
  "preserves %s content semantics when runtime metadata differs",
  async (hashStatus) => {
    const left = await inventory();
    const right = structuredClone(left);
    const occurrence = asset(right);
    const metadata = occurrence.format_metadata;
    if (metadata?.kind !== "node-sea-entry")
      throw new Error("Missing SEA metadata");
    metadata.source_path = "changed-key";
    occurrence.source_path = "changed-key";
    occurrence.hash_status = hashStatus;
    const result = compareArtifacts(observe(left), observe(right));
    expect(result.changes).toEqual([
      expect.objectContaining(
        hashStatus === "mismatched"
          ? { classification: "contradiction", dimensions: ["integrity"] }
          : {
              classification: "changed",
              dimensions:
                hashStatus === "unavailable"
                  ? ["metadata", "availability"]
                  : ["metadata"],
            },
      ),
    ]);
  },
);

it("keeps omitted legacy member metadata unknown", async () => {
  const left = await inventory();
  const right = structuredClone(left);
  delete asset(right).format_metadata;
  expect(compareArtifacts(observe(left), observe(right)).changes).toEqual([
    expect.objectContaining({
      classification: "unknown",
      dimensions: ["availability"],
    }),
  ]);
});

it("retains proven executable differences alongside missing legacy metadata", async () => {
  const left = await inventory();
  const right = structuredClone(left);
  const occurrence = asset(right);
  delete occurrence.format_metadata;
  occurrence.executable = true;
  expect(compareArtifacts(observe(left), observe(right)).changes).toEqual([
    expect.objectContaining({
      classification: "changed",
      dimensions: ["executable", "availability"],
    }),
  ]);
});

it("retains known runtime key changes when a partial inventory omits the content node", async () => {
  const left = await inventory();
  const right = structuredClone(left);
  const occurrence = asset(right);
  const metadata = occurrence.format_metadata;
  if (metadata?.kind !== "node-sea-entry")
    throw new Error("Missing SEA metadata");
  metadata.source_path = "changed-key";
  occurrence.source_path = "changed-key";
  right.nodes = right.nodes.filter(
    (node) => node.artifact_id !== occurrence.artifact_id,
  );
  const result = compareArtifacts(observe(left), observe(right));
  expect(result.status).toBe("truncated");
  expect(result.changes).toEqual([
    expect.objectContaining({
      logical_path: "data/café.txt",
      classification: "changed",
      dimensions: ["metadata", "availability"],
    }),
  ]);
});
