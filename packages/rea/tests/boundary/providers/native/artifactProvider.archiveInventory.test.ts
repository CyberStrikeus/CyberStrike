import { createOwnedArtifactClient } from "../../../support/artifactClientScope.js";
import { projectCliAnalysisResult } from "../../../../src/cli/projectCliAnalysisResult.js";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { createPackage, createPackageWithOptions } from "@electron/asar";
import { TextReader, Uint8ArrayWriter, ZipWriter } from "@zip.js/zip.js";
import { describe, expect, it } from "vitest";

import { createTestTempDirectory } from "../../../fixtures/temporaryDirectory.js";

import { createDirectAnalysis } from "../../../../src/composition/directAnalysis.js";
import { artifactInventoryResultSchema } from "../../../../src/domain/artifactGraph.js";
import { artifactInspectionResultSchema } from "../../../../src/domain/artifactInspection.js";
import type { BinaryTarget } from "../../../../src/domain/binaryTargetTypes.js";
import { parseBinaryTarget } from "../../../../src/application/BinaryTargetResolver.js";
import { parseEvidence } from "../../../../src/domain/evidence.js";

const { runProviderAnalysis } = createDirectAnalysis({});

describe("artifact archive inventory", () => {
  it("returns complete ZIP and official ASAR inventories inline", async () => {
    const root = await createTestTempDirectory("rea-containers-");
    const zipPath = join(root, "fixture.apk");
    const zipWriter = new ZipWriter(new Uint8ArrayWriter());
    await zipWriter.add("assets/index.js", new TextReader("export default 1;"));
    await zipWriter.add("lib/arm64-v8a/addon.so", new TextReader("native"));
    await writeFile(zipPath, await zipWriter.close());
    const parsed = await parseBinaryTarget(zipPath);
    expect(parsed.ok && parsed.value.format).toBe("apk");
    if (!parsed.ok) return;
    const zipResult = await inventory(parsed.value);
    expect(zipResult.occurrences.length).toBe(3);
    expect(
      zipResult.occurrences.map(({ artifact_kind }) => artifact_kind),
    ).toEqual(expect.arrayContaining(["javascript", "dynamic-library"]));
    const cliEvidence = parseEvidence(
      await runProviderAnalysis(zipPath, "inventory_artifact", {}).then(
        projectCliAnalysisResult,
      ),
    );
    expect(cliEvidence).toMatchObject({
      operation: "inventory_artifact",
      provider: { id: "rea-artifact-graph" },
      subject: { format: "apk" },
    });
    const inspectionEvidence = parseEvidence(
      await runProviderAnalysis(zipPath, "inspect_artifact", {}).then(
        projectCliAnalysisResult,
      ),
    );
    const inspection = artifactInspectionResultSchema.parse(
      inspectionEvidence.normalized_result,
    );
    expect(inspection).toMatchObject({
      substeps: [
        {
          operation: "inventory_artifact",
          status: "completed",
          evidence_id: expect.stringMatching(/^ev_[a-f0-9]{64}$/u),
        },
      ],
      coverage: { status: "complete-within-substeps", substeps_completed: 1 },
    });
    expect(inspectionEvidence.evidence_links).toEqual(
      inspection.evidence_links,
    );
    // The graph is delivered once, in the nested inventory Evidence.
    expect(
      artifactInventoryResultSchema.parse(
        inspection.substeps[0]?.evidence.normalized_result,
      ).occurrences,
    ).toHaveLength(3);
    // Occurrences name every logical path; neither Evidence repeats them.
    expect(inspectionEvidence.locations).toEqual([]);
    expect(inspection.substeps[0]?.evidence.locations).toEqual([]);
    expect(inspection.observations.map(({ kind }) => kind)).toEqual([
      "root-manifest",
    ]);
    const cancellation = new AbortController();
    cancellation.abort();
    await expect(
      runProviderAnalysis(
        zipPath,
        "inventory_artifact",
        {},
        undefined,
        cancellation.signal,
      ).then(projectCliAnalysisResult),
    ).resolves.toMatchObject({ code: "cancelled" });
    await expect(
      runProviderAnalysis(
        zipPath,
        "inspect_artifact",
        {},
        undefined,
        cancellation.signal,
      ).then(projectCliAnalysisResult),
    ).resolves.toMatchObject({ code: "cancelled" });

    const source = join(root, "asar-source");
    await mkdir(source);
    await writeFile(join(source, "main.js"), "console.log('ok');\n");
    const asarPath = join(root, "app.asar");
    await createPackage(source, asarPath);
    const asarResult = await inventory(await target(asarPath));
    expect(asarResult.occurrences).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ logical_path: "main.js" }),
      ]),
    );

    const unpackedPath = join(root, "unpacked.asar");
    await createPackageWithOptions(source, unpackedPath, { unpack: "*.js" });
    const unpackedResult = await inventory(await target(unpackedPath));
    expect(unpackedResult.occurrences).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          logical_path: "main.js",
          hash_status: "verified",
        }),
      ]),
    );
    await writeFile(
      join(`${unpackedPath}.unpacked`, "main.js"),
      "changed();\n",
    );
    const corrupted = await createOwnedArtifactClient(
      await target(unpackedPath),
    ).execute("inventory_artifact", {});
    expect(corrupted).toMatchObject({
      ok: false,
      error: {
        _tag: "ArtifactOperationError",
        reason: "integrity",
        artifactDetails: {
          logicalPath: "main.js",
          unpacked: true,
        },
      },
    });
    const failedInspection = await createOwnedArtifactClient(
      await target(unpackedPath),
    ).execute("inspect_artifact", {});
    expect(failedInspection).toMatchObject({
      ok: false,
      error: { _tag: "ArtifactOperationError", reason: "integrity" },
    });
  });
});
const inventory = async (targetValue: BinaryTarget) => {
  const result = await createOwnedArtifactClient(targetValue).execute(
    "inventory_artifact",
    {},
  );
  if (!result.ok) throw result.error;
  return artifactInventoryResultSchema.parse(result.value.result);
};

const target = async (path: string): Promise<BinaryTarget> => {
  const parsed = await parseBinaryTarget(path);
  if (!parsed.ok) throw parsed.error;
  return parsed.value;
};
