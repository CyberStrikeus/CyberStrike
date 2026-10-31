import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { inventoryArtifact } from "../../fixtures/artifactInventory.js";
import { compareArtifacts } from "../../../src/domain/artifactComparison.js";
import { createEvidence } from "../../../src/domain/evidence.js";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

const observe = async (
  path: string,
  omit: { readonly nodes?: boolean; readonly occurrences?: boolean } = {},
) => {
  const observed = await inventoryArtifact(path);
  const inventory = {
    ...observed,
    ...(omit.nodes === true ? { nodes: [] } : {}),
    ...(omit.occurrences === true ? { occurrences: [] } : {}),
  };
  const partial = omit.nodes === true || omit.occurrences === true;
  return createEvidence(
    {
      path,
      sha256: inventory.manifest.root_sha256,
      format: inventory.manifest.root_format,
    },
    { id: "rea-artifact-graph", name: "REA artifact graph", version: "1" },
    {
      operation: "inventory_artifact",
      parameters: {},
      result: inventory,
      confidence: partial ? "derived" : "observed",
      authority: "shipped-artifact",
    },
  );
};

describe("artifact comparison summary", () => {
  it("counts unchanged paths alongside additions and removals", async () => {
    const root = await createTestTempDirectory("rea-artifact-summary-");
    const leftPath = join(root, "left");
    const rightPath = join(root, "right");
    await Promise.all([mkdir(leftPath), mkdir(rightPath)]);
    await Promise.all(
      [leftPath, rightPath].flatMap((path) =>
        ["same.txt", "duplicate.txt"].map((name) =>
          writeFile(join(path, name), "unchanged content"),
        ),
      ),
    );
    await Promise.all([
      writeFile(join(leftPath, "removed.txt"), "old content"),
      writeFile(join(rightPath, "added.txt"), "new content"),
    ]);
    const [left, right] = await Promise.all([
      observe(leftPath),
      observe(rightPath),
    ]);
    const comparison = compareArtifacts(left, right);
    expect(comparison.summary).toEqual({
      unchanged: 2,
      added: 1,
      removed: 1,
      changed: 1,
      unknown: 0,
      contradiction: 0,
    });
    expect(comparison.changes).toHaveLength(3);
  });

  const writeChangedFiles = async () => {
    const root = await createTestTempDirectory("rea-artifact-partial-root-");
    const leftPath = join(root, "left.txt");
    const rightPath = join(root, "right.txt");
    await Promise.all([
      writeFile(leftPath, "before"),
      writeFile(rightPath, "after"),
    ]);
    return { leftPath, rightPath };
  };

  it("counts a changed root once when partial inventories omit node details", async () => {
    const { leftPath, rightPath } = await writeChangedFiles();
    const [left, right] = await Promise.all([
      observe(leftPath, { nodes: true }),
      observe(rightPath, { nodes: true }),
    ]);
    const comparison = compareArtifacts(left, right);

    expect(comparison.status).toBe("truncated");
    expect(comparison.summary).toMatchObject({ changed: 1, unknown: 0 });
    expect(comparison.changes).toEqual([
      expect.objectContaining({
        logical_path: ".",
        classification: "changed",
        dimensions: ["content", "availability"],
        left_occurrence_id: expect.stringMatching(/^occ_/u),
        right_occurrence_id: expect.stringMatching(/^occ_/u),
        evidence_links: [left.evidence_id, right.evidence_id],
      }),
    ]);
  });

  it("reports a root content change when partial inventories omit every member", async () => {
    const { leftPath, rightPath } = await writeChangedFiles();
    const [left, right] = await Promise.all([
      observe(leftPath, { nodes: true, occurrences: true }),
      observe(rightPath, { nodes: true, occurrences: true }),
    ]);
    const comparison = compareArtifacts(left, right);

    expect(comparison.status).toBe("truncated");
    expect(comparison.summary).toMatchObject({ changed: 1 });
    expect(comparison.changes).toEqual([
      expect.objectContaining({
        logical_path: ".",
        classification: "changed",
        dimensions: ["content"],
      }),
    ]);
  });

  it("does not infer a content change between identical partial inventories", async () => {
    const { leftPath } = await writeChangedFiles();
    const [left, right] = await Promise.all([
      observe(leftPath, { nodes: true }),
      observe(leftPath, { nodes: true }),
    ]);
    const comparison = compareArtifacts(left, right);

    expect(comparison.status).toBe("truncated");
    expect(comparison.summary).toMatchObject({ changed: 0, unknown: 1 });
    expect(comparison.changes).toEqual([
      expect.objectContaining({
        logical_path: ".",
        classification: "unknown",
        dimensions: ["availability"],
      }),
    ]);
  });
});
