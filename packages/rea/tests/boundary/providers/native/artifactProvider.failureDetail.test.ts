import { createOwnedArtifactClient } from "../../../support/artifactClientScope.js";
import { join } from "node:path";

import { expect, it } from "vitest";

import { writeOrderedZip } from "../../../fixtures/artifactEntryOrder.js";
import { createTestTempDirectory } from "../../../fixtures/temporaryDirectory.js";

import { parseBinaryTarget } from "../../../../src/application/BinaryTargetResolver.js";
import {
  destinationCaseCollision,
  ENGLISH_UNICODE_CASE_INVENTORY_LIMITATION,
} from "../../../../src/artifacts/ArtifactPaths.js";
import { artifactInventoryResultSchema } from "../../../../src/domain/artifactGraph.js";
import { ArtifactOperationError } from "../../../../src/domain/artifactOperationError.js";
import { projectAnalysisError } from "../../../../src/domain/analysisErrorProjection.js";

it("keeps logical names that differ only in case and records the limitation", async () => {
  const root = await createTestTempDirectory("rea-artifact-detail-");
  const path = join(root, "fixture.zip");
  await writeOrderedZip(path, ["Main.js", "main.js"]);
  const target = await parseBinaryTarget(path);
  if (!target.ok) throw new Error("expected a ZIP target");
  const result = await createOwnedArtifactClient(target.value).execute(
    "inventory_artifact",
    {},
  );
  if (!result.ok) throw result.error;
  const inventory = artifactInventoryResultSchema.parse(result.value.result);
  expect(inventory.occurrences.map(({ logical_path }) => logical_path)).toEqual(
    expect.arrayContaining(["Main.js", "main.js"]),
  );
  expect(inventory.limitations).toContain(
    ENGLISH_UNICODE_CASE_INVENTORY_LIMITATION,
  );
  for (const logicalPath of ["Main.js", "main.js"]) {
    expect(
      inventory.occurrences
        .find((occurrence) => occurrence.logical_path === logicalPath)
        ?.limitations.join("\n"),
    ).toContain("English (en-US) Unicode case folding");
  }
});

it("keeps literal backslash ZIP names distinct from slash paths", async () => {
  const root = await createTestTempDirectory("rea-artifact-detail-");
  const path = join(root, "fixture.zip");
  await writeOrderedZip(path, ["a\\b.js", "a/b.js"]);
  const target = await parseBinaryTarget(path);
  if (!target.ok) throw new Error("expected a ZIP target");
  const result = await createOwnedArtifactClient(target.value).execute(
    "inventory_artifact",
    {},
  );
  if (!result.ok) throw result.error;
  const inventory = artifactInventoryResultSchema.parse(result.value.result);
  const literal = inventory.occurrences.find(
    ({ logical_path }) => logical_path === "a\\b.js",
  );
  const slash = inventory.occurrences.find(
    ({ logical_path }) => logical_path === "a/b.js",
  );
  expect(literal).toBeDefined();
  expect(slash).toBeDefined();
  expect(literal?.occurrence_id).not.toBe(slash?.occurrence_id);
});

it("reports an unsafe path as a hostile artifact path", async () => {
  const root = await createTestTempDirectory("rea-artifact-detail-");
  const path = join(root, "fixture.zip");
  await writeOrderedZip(path, ["../outside.js"]);
  const target = await parseBinaryTarget(path);
  if (!target.ok) throw new Error("expected a ZIP target");
  const result = await createOwnedArtifactClient(target.value).execute(
    "inventory_artifact",
    {},
  );
  if (result.ok) throw new Error("expected the path constraint to fail");
  expect(projectAnalysisError(result.error)).toMatchObject({
    code: "artifact_operation_failed",
    message: 'Artifact path is not normalized: "../outside.js"',
    details: {
      operation: "inventory_artifact",
      reason: "path",
      detail: 'Artifact path is not normalized: "../outside.js"',
    },
  });
});

it("returns a destination case collision as the user-facing path message", () => {
  const collision = destinationCaseCollision("res/2f.xml", ["2F.xml"]);
  if (collision === undefined)
    throw new Error("Expected destination collision");
  const detail = collision.message;
  expect(
    projectAnalysisError(
      new ArtifactOperationError("extract_artifact", "path", undefined, detail),
    ),
  ).toMatchObject({
    message: detail,
    details: { reason: "path", detail },
  });

  expect(
    projectAnalysisError(new ArtifactOperationError("extract_artifact", "path"))
      .message,
  ).toBe(
    "Artifact contains a conflicting internal path. Inspect the reported path before retrying.",
  );
});
