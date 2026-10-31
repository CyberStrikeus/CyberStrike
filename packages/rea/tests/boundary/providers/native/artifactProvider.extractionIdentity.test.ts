import { createOwnedArtifactClient } from "../../../support/artifactClientScope.js";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { writeOrderedZip } from "../../../fixtures/artifactEntryOrder.js";
import { createTestTempDirectory } from "../../../fixtures/temporaryDirectory.js";

import { parseBinaryTarget } from "../../../../src/application/BinaryTargetResolver.js";
import { artifactExtractionExecutionSchema } from "../../../../src/contracts/artifactToolContracts.js";
import { artifactExtractionResultSchema } from "../../../../src/domain/artifactGraph.js";
import type { BinaryTarget } from "../../../../src/domain/binaryTargetTypes.js";

describe("artifact extraction identity", () => {
  it("uses code-point order for path-independent extraction identities", async () => {
    const root = await createTestTempDirectory("rea-extract-order-");
    const source = join(root, "source.zip");
    await writeOrderedZip(source, ["ä.js", "a.js", "Z.js"]);
    const result = await createOwnedArtifactClient(
      await archiveTarget(source),
    ).execute(
      "extract_artifact",
      artifactExtractionExecutionSchema.parse({
        output_root: join(root, "output"),
      }),
    );
    if (!result.ok) throw result.error;
    const extracted = artifactExtractionResultSchema.parse(result.value.result);
    expect(
      extracted.artifacts.map(({ relative_path }) => relative_path),
    ).toEqual(["Z.js", "a.js", "ä.js"]);
    expect(extracted.extraction_manifest.selected_occurrence_ids).toEqual(
      [...extracted.extraction_manifest.selected_occurrence_ids].sort(),
    );
  });
});

const archiveTarget = async (path: string): Promise<BinaryTarget> => {
  const parsed = await parseBinaryTarget(path);
  if (!parsed.ok) throw parsed.error;
  return parsed.value;
};
