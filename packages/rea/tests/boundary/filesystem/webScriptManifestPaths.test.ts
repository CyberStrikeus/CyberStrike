import { createHash } from "node:crypto";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { expect, it, onTestFinished } from "vitest";
import { exportWebScripts } from "../../../src/application/WebScriptExportService.js";
import { ArtifactResourceScope } from "../../../src/artifacts/ArtifactResourceScope.js";
import { LocalWebScriptArtifacts } from "../../../src/browser/assets/LocalWebScriptArtifacts.js";
import { LocalWebSourceLocationArtifacts } from "../../../src/browser/assets/WebSourceLocationArtifacts.js";
import { LocalWebModuleArtifacts } from "../../../src/browser/modules/WebModuleArtifacts.js";
import { projectAnalysisError } from "../../../src/domain/analysisErrorProjection.js";
import { webScriptExportResultSchema } from "../../../src/domain/webScriptExport.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { webModuleArtifactsFixture } from "../../fixtures/webModuleTrace.js";
import { scriptScenarioFixture } from "../../fixtures/webScriptCapture.js";
import { webSourceLocationFixture } from "../../fixtures/webSourceLocation.js";

const materialize = async () => {
  const root = join(
    await createTestTempDirectory("rea-script-manifest-path-"),
    "export with spaces",
  );
  const artifact = webModuleArtifactsFixture();
  await mkdir(join(root, "files", "modules"), { recursive: true });
  await mkdir(join(root, "nested"));
  const sourcePath = join(root, "files", "modules", "main.js");
  const manifestPath = join(root, "manifest.json");
  await writeFile(sourcePath, artifact.source);
  await writeFile(manifestPath, JSON.stringify(artifact.manifest));
  return { root, artifact, sourcePath, manifestPath };
};

it.skipIf(process.platform === "win32").each([
  { consumer: "module", sentinel: "different" },
  { consumer: "module", sentinel: "identical" },
  { consumer: "source-location", sentinel: "different" },
  { consumer: "source-location", sentinel: "identical" },
] as const)(
  "loads the POSIX symlink-parent companion through $consumer with $sentinel lexical sibling bytes",
  async ({ consumer, sentinel }) => {
    const base = await createTestTempDirectory("rea-manifest-physical-parent-");
    const source = Buffer.from('export const selected = "physical export";\n');
    const sourceUrl = "https://app.test/modules/main.js";
    const capturePath = join(base, "capture.json");
    await writeFile(
      capturePath,
      JSON.stringify(
        scriptScenarioFixture([{ url: sourceUrl, bytes: source }]),
      ),
    );
    const resources = new ArtifactResourceScope();
    onTestFinished(() => resources.close());
    const exported = await exportWebScripts(
      {
        capture_path: capturePath,
        output_directory: join(base, "physical-export"),
      },
      resources,
    );
    if (!exported.ok) throw exported.error;
    const report = webScriptExportResultSchema.parse(
      exported.value.normalized_result,
    );
    const selected = report.scripts[0];
    if (selected?.content.state !== "exported")
      throw new Error("Expected the real export to retain its selected source");

    const physicalSourcePath = join(
      report.output_directory,
      "files",
      selected.content.relative_path,
    );
    const lexicalSourcePath = join(
      base,
      "files",
      selected.content.relative_path,
    );
    await mkdir(dirname(lexicalSourcePath), { recursive: true });
    await writeFile(
      lexicalSourcePath,
      sentinel === "identical"
        ? source
        : Buffer.from('export const selected = "lexical sibling";\n'),
    );
    const nested = join(report.output_directory, "nested");
    await mkdir(nested);
    await symlink(nested, join(base, "link"));
    const selectedManifestPath = `${base}/link/../manifest.json`;
    const sourceMap = webSourceLocationFixture().sourceMap;
    const mapPath = join(base, "selected.map");
    await writeFile(mapPath, sourceMap.text);

    const artifacts =
      consumer === "module"
        ? new LocalWebModuleArtifacts()
        : new LocalWebSourceLocationArtifacts();
    onTestFinished(() => artifacts.close());
    const input = { manifest_path: selectedManifestPath, script_index: 0 };
    const result =
      artifacts instanceof LocalWebModuleArtifacts
        ? await artifacts.load(input)
        : await artifacts.load({
            ...input,
            source_map: { path: mapPath, url: sourceMap.url },
            generated_position: { line: 1, column: 0 },
          });
    if (!result.ok) throw result.error;

    expect(result.value.source).toBe(source.toString("utf8"));
    expect(result.value.sourceFile).toEqual({
      path: physicalSourcePath,
      sha256: createHash("sha256").update(source).digest("hex"),
      bytes: source.length,
    });
    expect(result.value.sourceFile.path).not.toBe(lexicalSourcePath);
    expect(result.value.manifestFile).toEqual({
      ...report.manifest,
      path: selectedManifestPath,
    });
    expect(result.value.manifest.output_directory).toBe(
      report.output_directory,
    );
    expect(result.value.manifest.scripts[0]?.url).toBe(sourceUrl);
    if (consumer === "source-location")
      expect(result.value).toHaveProperty("sourceMap", {
        ...sourceMap,
        file: { ...sourceMap.file, path: mapPath },
      });
  },
);

it("reads equivalent local manifest spellings without changing reported identity", async () => {
  const fixture = await materialize();
  const paths = new Set([
    fixture.manifestPath,
    fixture.manifestPath.replaceAll("\\", "/"),
    `${fixture.root}${sep}nested${sep}..${sep}manifest.json`,
  ]);
  const fromWorkingDirectory = relative(process.cwd(), fixture.manifestPath);
  // A target on another Windows drive has no relative path from this cwd.
  if (!isAbsolute(fromWorkingDirectory))
    paths.add(`.${sep}${fromWorkingDirectory}`);
  for (const operation of [
    "trace_web_module_imports",
    "trace_web_source_location",
  ] as const) {
    for (const manifestPath of paths) {
      const response = await new LocalWebScriptArtifacts(operation).load({
        manifest_path: manifestPath,
        script_index: 0,
      });
      if (!response.ok) throw response.error;
      expect(response.value.source).toBe(fixture.artifact.source);
      expect(response.value.sourceFile).toEqual({
        ...fixture.artifact.sourceFile,
        path: fixture.sourcePath,
      });
      expect(response.value.manifestFile.path).toBe(manifestPath);
      expect(response.value.manifest.output_directory).toBe(
        fixture.artifact.manifest.output_directory,
      );
      expect(response.value.manifest.scripts[0]?.url).toBe(
        fixture.artifact.manifest.scripts[0]?.url,
      );
    }
  }
});

it("still rejects changed source bytes after resolving the selected manifest's physical directory", async () => {
  const fixture = await materialize();
  await writeFile(fixture.sourcePath, "tampered source");
  const response = await new LocalWebScriptArtifacts(
    "trace_web_module_imports",
  ).load({
    manifest_path: `${fixture.root}/nested/../manifest.json`.replaceAll(
      "\\",
      "/",
    ),
    script_index: 0,
  });
  if (response.ok) throw new Error("Expected source integrity mismatch");
  expect(projectAnalysisError(response.error).code).toBe(
    "artifact_integrity_mismatch",
  );
});

const literalSourcePath = "..\\sibling.js";

const literalManifest = async () => {
  const fixture = await materialize();
  const selected = fixture.artifact.manifest.scripts[0];
  if (selected?.content.state !== "exported")
    throw new Error("Expected exported source");
  selected.content.relative_path = literalSourcePath;
  await writeFile(join(fixture.root, "sibling.js"), fixture.artifact.source);
  if (process.platform !== "win32")
    await writeFile(
      join(fixture.root, "files", selected.content.relative_path),
      fixture.artifact.source,
    );
  await writeFile(
    fixture.manifestPath,
    JSON.stringify(fixture.artifact.manifest),
  );
  return fixture;
};

it.each(["trace_web_module_imports", "trace_web_source_location"] as const)(
  "refuses Windows backslash source interpretation for %s",
  async (operation) => {
    const fixture = await literalManifest();
    const originalPlatform = Object.getOwnPropertyDescriptor(
      process,
      "platform",
    );
    const artifacts = new LocalWebScriptArtifacts(operation);
    let response;
    try {
      // Exercise the Windows admission branch; this is not native Windows IO.
      Object.defineProperty(process, "platform", { value: "win32" });
      response = await artifacts.load({
        manifest_path: fixture.manifestPath,
        script_index: 0,
      });
    } finally {
      if (originalPlatform !== undefined)
        Object.defineProperty(process, "platform", originalPlatform);
      await artifacts.close();
    }
    if (response.ok) throw new Error("Expected Windows source path refusal");
    const error = projectAnalysisError(response.error);
    expect(error).toMatchObject({
      code: "artifact_operation_failed",
      details: {
        operation,
        reason: "path",
        detail: expect.stringContaining(
          "Windows source path cannot contain backslashes",
        ),
      },
    });
    expect(error).toHaveProperty(
      "details.detail",
      expect.stringContaining(JSON.stringify(literalSourcePath)),
    );
  },
);

it.skipIf(process.platform === "win32")(
  "reads the same saved POSIX literal name without selecting its sibling",
  async () => {
    const fixture = await literalManifest();
    await writeFile(join(fixture.root, "sibling.js"), "wrong sibling source");
    const artifacts = new LocalWebScriptArtifacts("trace_web_module_imports");
    try {
      const result = await artifacts.load({
        manifest_path: fixture.manifestPath,
        script_index: 0,
      });
      if (!result.ok) throw result.error;
      expect(result.value.source).toBe(fixture.artifact.source);
      expect(result.value.sourceFile.path).toBe(
        join(fixture.root, "files", literalSourcePath),
      );
    } finally {
      await artifacts.close();
    }
  },
);
