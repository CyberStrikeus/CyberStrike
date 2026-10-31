import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect } from "vitest";

import { artifactInventoryResultSchema } from "../../src/domain/artifactGraph.js";
import { artifactInspectionResultSchema } from "../../src/domain/artifactInspection.js";
import { parseEvidence } from "../../src/domain/evidence.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";
import { zipSymlinkMetadataFixture } from "../fixtures/zipSymlinkMetadata.js";
import { cliTest } from "../support/cli/cliFixture.js";

cliTest(
  "reports ZIP symlinks from type bits when Unix permission bits are absent",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-zip-symlink-metadata-");
    const archivePath = join(root, "symlinks.zip");
    await writeFile(archivePath, await zipSymlinkMetadataFixture());

    const inspected = await cli.run({
      arguments: ["inspect-artifact", archivePath, "--json"],
    });
    expect(inspected.exitCode, inspected.stdout + inspected.stderr).toBe(0);
    const inspection = artifactInspectionResultSchema.parse(
      parseEvidence(inspected.json).normalized_result,
    );
    const inventoryEvidence = inspection.substeps[0]?.evidence;
    if (inventoryEvidence === undefined)
      throw new Error("CLI inspection did not retain ZIP inventory Evidence");
    const inventory = artifactInventoryResultSchema.parse(
      inventoryEvidence.normalized_result,
    );
    const entriesByPath = new Map(
      inventory.occurrences.map((entry) => [entry.logical_path, entry]),
    );

    expect(entriesByPath.get("target.txt")).toMatchObject({
      entry_kind: "file",
    });
    for (const path of ["type-only-link", "permissions-link"])
      expect(entriesByPath.get(path)).toMatchObject({
        entry_kind: "symlink",
        limitations: expect.arrayContaining([
          "Archive symlink target was not read.",
        ]),
      });
  },
);
