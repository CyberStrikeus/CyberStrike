import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createTestTempDirectory } from "../../../fixtures/temporaryDirectory.js";

import { parseBinaryTarget } from "../../../../src/application/BinaryTargetResolver.js";
import {
  CPU,
  machoImage,
} from "../../../../src/artifacts/apple/MachoImage.fixture.js";
import { artifactExtractionExecutionSchema } from "../../../../src/contracts/artifactToolContracts.js";
import {
  artifactExtractionResultSchema,
  artifactInventoryResultSchema,
} from "../../../../src/domain/artifactGraph.js";
import type { BinaryTarget } from "../../../../src/domain/binaryTargetTypes.js";
import {
  createOwnedArtifactClient,
  withArtifactClient,
} from "../../../support/artifactClientScope.js";

describe("artifact extraction", () => {
  it.skipIf(process.platform === "win32").each(["file/..", "missing"])(
    "refuses an invalid parent (%s) before acquiring output and permits a corrected request",
    async (parent) => {
      const root = await createTestTempDirectory("rea-extract-invalid-parent-");
      const source = join(root, "source.app");
      await mkdir(source);
      await writeFile(join(source, "payload.txt"), "selected payload\n");
      await writeFile(join(root, "file"), "parent is a file");
      const output = join(root, "out");

      await withArtifactClient(await target(source), async (client) => {
        const refused = await client.execute("extract_artifact", {
          output_root: `${root}/${parent}/out`,
        });
        expect(refused).toMatchObject({
          ok: false,
          error: { _tag: "ArtifactOperationError", reason: "path" },
        });
        if (!refused.ok) expect(refused.error.cleanupIncomplete).toBe(false);
        await expect(access(output)).rejects.toMatchObject({ code: "ENOENT" });

        const corrected = await client.execute("extract_artifact", {
          output_root: output,
        });
        if (!corrected.ok) throw corrected.error;
        expect(
          artifactExtractionResultSchema.parse(corrected.value.result),
        ).toMatchObject({ output_root: output, containment_verified: true });
        expect(await readFile(join(output, "payload.txt"), "utf8")).toBe(
          "selected payload\n",
        );
      });
    },
  );

  it("keeps committed files after the owning client closes", async () => {
    const root = await createTestTempDirectory("rea-extract-client-close-");
    const source = join(root, "source.app");
    await mkdir(source);
    await writeFile(join(source, "payload.txt"), "committed\n");
    const output = join(root, "output");
    const client = createOwnedArtifactClient(await target(source));

    const result = await client.execute("extract_artifact", {
      output_root: output,
    });
    if (!result.ok) throw result.error;
    expect((await client.close()).ok).toBe(true);
    expect(await readFile(join(output, "payload.txt"), "utf8")).toBe(
      "committed\n",
    );
  });

  it("extracts all regular occurrences through an exclusively owned output tree", async () => {
    const root = await createTestTempDirectory("rea-extract-");
    const source = join(root, "source.app");
    await mkdir(join(source, "assets"), { recursive: true });
    await writeFile(join(source, "assets", "selected.js"), "selected();\n");
    await writeFile(join(source, "assets", "ignored.js"), "ignored();\n");
    const targetValue = await target(source);
    const graph = await inventory(targetValue);
    expect(
      graph.occurrences.some(
        ({ logical_path }) => logical_path === "assets/selected.js",
      ),
    ).toBe(true);
    const cancelledOutput = join(root, "cancelled-output");
    const controller = new AbortController();
    controller.abort();
    const cancelled = await createOwnedArtifactClient(targetValue).execute(
      "extract_artifact",
      artifactExtractionExecutionSchema.parse({
        output_root: cancelledOutput,
      }),
      { signal: controller.signal },
    );
    expect(cancelled).toMatchObject({
      ok: false,
      error: { _tag: "ArtifactOperationError", reason: "cancelled" },
    });
    await expect(access(cancelledOutput)).rejects.toThrow();
    const output = join(root, "output");
    const result = await createOwnedArtifactClient(targetValue).execute(
      "extract_artifact",
      artifactExtractionExecutionSchema.parse({
        output_root: output,
      }),
    );
    if (!result.ok) throw result.error;
    const firstExtraction = artifactExtractionResultSchema.parse(
      result.value.result,
    );
    expect(firstExtraction).toMatchObject({
      output_root: output,
      containment_verified: true,
      artifacts: expect.arrayContaining([
        expect.objectContaining({ relative_path: "assets/selected.js" }),
      ]),
      extraction_manifest: { output_root_alias: "$OUTPUT_ROOT" },
    });
    // artifacts names every extracted path; the Evidence does not repeat them.
    expect(result.value.locations).toEqual([]);
    expect(await readFile(join(output, "assets", "selected.js"), "utf8")).toBe(
      "selected();\n",
    );
    expect(await readFile(join(output, "assets", "ignored.js"), "utf8")).toBe(
      "ignored();\n",
    );

    const relocatedOutput = join(root, "relocated-output");
    const relocated = await createOwnedArtifactClient(targetValue).execute(
      "extract_artifact",
      artifactExtractionExecutionSchema.parse({
        output_root: relocatedOutput,
      }),
    );
    if (!relocated.ok) throw relocated.error;
    expect(
      artifactExtractionResultSchema.parse(relocated.value.result)
        .extraction_manifest,
    ).toEqual(firstExtraction.extraction_manifest);

    const second = await createOwnedArtifactClient(targetValue).execute(
      "extract_artifact",
      artifactExtractionExecutionSchema.parse({
        output_root: output,
      }),
    );
    expect(second).toMatchObject({
      ok: false,
      error: { _tag: "ArtifactOperationError", reason: "path" },
    });
    expect((await readdir(root)).sort()).toEqual([
      "output",
      "relocated-output",
      "source.app",
    ]);
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

/** A real bundle target has an executable identity distinct from its resource tree. */
const target = async (path: string): Promise<BinaryTarget> => {
  await writeFile(
    join(path, "Info.plist"),
    '<plist version="1.0"><dict><key>CFBundleExecutable</key><string>Main</string></dict></plist>',
  );
  await writeFile(join(path, "Main"), machoImage({ cpu: CPU.arm64 }));
  const parsed = await parseBinaryTarget(path);
  if (!parsed.ok) throw parsed.error;
  expect(parsed.value.bundleInfoPlist).toBe(join(path, "Info.plist"));
  return parsed.value;
};
