import { projectCliAnalysisResult } from "../../../../src/cli/projectCliAnalysisResult.js";
import { lstat, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { TextReader, Uint8ArrayWriter, ZipWriter } from "@zip.js/zip.js";
import { describe, expect, it } from "vitest";

import { createTestTempDirectory } from "../../../fixtures/temporaryDirectory.js";

import { createDirectAnalysis } from "../../../../src/composition/directAnalysis.js";
import { ENGLISH_UNICODE_CASE_INVENTORY_LIMITATION } from "../../../../src/artifacts/ArtifactPaths.js";
import { artifactExtractionExecutionSchema } from "../../../../src/contracts/artifactToolContracts.js";
import { artifactInventoryResultSchema } from "../../../../src/domain/artifactGraph.js";
import type { BinaryTarget } from "../../../../src/domain/binaryTargetTypes.js";
import { parseBinaryTarget } from "../../../../src/application/BinaryTargetResolver.js";
import { parseEvidence } from "../../../../src/domain/evidence.js";
import { projectAnalysisError } from "../../../../src/domain/analysisErrorProjection.js";
import { withArtifactClient } from "../../../support/artifactClientScope.js";

const { runProviderAnalysis } = createDirectAnalysis({});

describe("artifact archive safety", () => {
  it.each([
    ["fixture.msix", "msix"],
    ["fixture.appxbundle", "appx"],
  ] as const)(
    "reuses the hardened ZIP reader for %s package inventory",
    async (name, format) => {
      const root = await createTestTempDirectory("rea-windows-package-");
      const path = join(root, name);
      const writer = new ZipWriter(new Uint8ArrayWriter());
      await writer.add(
        "Assets/main.js",
        new TextReader("export default 'windows';"),
      );
      await writer.add(
        "VFS/ProgramFilesX64/App/addon.node",
        new TextReader("native"),
      );
      await writeFile(path, await writer.close());

      const parsed = await parseBinaryTarget(path);
      expect(parsed.ok && parsed.value).toMatchObject({
        kind: "archive",
        format,
      });
      if (!parsed.ok) return;
      const result = await inventory(parsed.value);
      expect(result.manifest.root_format).toBe(format);
      expect(
        result.occurrences.map(({ artifact_kind }) => artifact_kind),
      ).toEqual(expect.arrayContaining(["javascript", "native-addon"]));
      expect(
        result.occurrences.some(
          ({ logical_path: logicalPath }) => logicalPath === "Assets/main.js",
        ),
      ).toBe(true);
      const output = join(root, "output");
      const extracted = await withArtifactClient(parsed.value, (client) =>
        client.execute(
          "extract_artifact",
          artifactExtractionExecutionSchema.parse({
            output_root: output,
          }),
        ),
      );
      if (!extracted.ok) throw extracted.error;
      expect(await readFile(join(output, "Assets", "main.js"), "utf8")).toBe(
        "export default 'windows';",
      );
      expect(
        parseEvidence(
          await runProviderAnalysis(path, "inventory_artifact", {}).then(
            projectCliAnalysisResult,
          ),
        ),
      ).toMatchObject({
        operation: "inventory_artifact",
        subject: { format },
      });
    },
  );
});

it("extracts case-distinct names only when the destination can preserve them", async () => {
  const root = await createTestTempDirectory("rea-case-distinct-zip-");
  await writeFile(join(root, "case-probe"), "lower");
  await writeFile(join(root, "CASE-PROBE"), "upper");
  const caseSensitive =
    (await readFile(join(root, "case-probe"), "utf8")) === "lower";
  const path = join(root, "fixture.zip");
  const writer = new ZipWriter(new Uint8ArrayWriter());
  await writer.add("Main.js", new TextReader("upper"));
  await writer.add("main.js", new TextReader("lower"));
  await writeFile(path, await writer.close());
  const parsed = await parseBinaryTarget(path);
  if (!parsed.ok) throw parsed.error;
  const result = await inventory(parsed.value);
  expect(result.limitations).toContain(
    ENGLISH_UNICODE_CASE_INVENTORY_LIMITATION,
  );
  expect(
    result.occurrences
      .filter(({ logical_path }) => logical_path !== ".")
      .map(({ logical_path }) => logical_path)
      .sort(),
  ).toEqual(["Main.js", "main.js"]);
  const output = join(root, "output");
  const extracted = await withArtifactClient(parsed.value, (client) =>
    client.execute(
      "extract_artifact",
      artifactExtractionExecutionSchema.parse({ output_root: output }),
    ),
  );
  if (!caseSensitive) {
    if (extracted.ok) throw new Error("expected a destination case collision");
    expect(projectAnalysisError(extracted.error)).toMatchObject({
      message:
        "Destination filesystem cannot store both main.js and Main.js; inventory retains both logical names.",
      details: { operation: "extract_artifact", reason: "path" },
    });
    await expect(lstat(output)).rejects.toMatchObject({ code: "ENOENT" });
    return;
  }
  if (!extracted.ok) throw extracted.error;
  expect(await readFile(join(output, "Main.js"), "utf8")).toBe("upper");
  expect(await readFile(join(output, "main.js"), "utf8")).toBe("lower");
});

it("preserves colon names in inventory and refuses Windows stream materialization", async () => {
  const root = await createTestTempDirectory("rea-artifact-stream-");
  const path = join(root, "fixture.zip");
  const writer = new ZipWriter(new Uint8ArrayWriter());
  await writer.add("0-ordinary.txt", new TextReader("ordinary content"));
  await writer.add("hello.txt:hidden", new TextReader("secret payload"));
  await writeFile(path, await writer.close());
  const parsed = await parseBinaryTarget(path);
  if (!parsed.ok) throw parsed.error;
  const result = await inventory(parsed.value);
  expect(result.occurrences.map(({ logical_path }) => logical_path)).toContain(
    "hello.txt:hidden",
  );

  const output = join(root, "output");
  const extracted = await withArtifactClient(parsed.value, (client) =>
    client.execute(
      "extract_artifact",
      artifactExtractionExecutionSchema.parse({ output_root: output }),
    ),
  );
  if (process.platform === "win32") {
    if (extracted.ok) throw new Error("expected a Windows stream path refusal");
    const detail =
      "Windows destination cannot materialize artifact path as a regular file: hello.txt:hidden; ':' denotes alternate data stream syntax.";
    expect(projectAnalysisError(extracted.error)).toMatchObject({
      message: detail,
      details: { operation: "extract_artifact", reason: "path", detail },
    });
    await expect(lstat(output)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      readFile(join(output, "hello.txt:hidden")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    return;
  }
  if (!extracted.ok) throw extracted.error;
  expect(await readFile(join(output, "0-ordinary.txt"), "utf8")).toBe(
    "ordinary content",
  );
  expect(await readFile(join(output, "hello.txt:hidden"), "utf8")).toBe(
    "secret payload",
  );
  await expect(lstat(join(output, "hello.txt"))).rejects.toMatchObject({
    code: "ENOENT",
  });
});

const inventory = async (targetValue: BinaryTarget) => {
  const result = await withArtifactClient(targetValue, (client) =>
    client.execute("inventory_artifact", {}),
  );
  if (!result.ok) throw result.error;
  return artifactInventoryResultSchema.parse(result.value.result);
};
