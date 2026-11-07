import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, it } from "vitest";

import { scanCanonicalArtifactInventory } from "../../fixtures/artifactInventory.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { readJavaScriptArtifactFiles } from "../../support/javascriptApplicationScope.js";
import { analyzeArtifactFiles } from "../../fixtures/javascriptArtifactAnalysis.js";
import { immutableArtifactGraph } from "../../fixtures/javascriptArtifactGraph.js";
import { createJavaScriptArtifactReader } from "../../../src/artifacts/javascript/JavaScriptArtifactReader.js";
import type {
  JavaScriptJsonModuleObservation,
  JavaScriptPackageObservation,
  JavaScriptSourceMapObservation,
} from "../../../src/application/javascript/JavaScriptArtifactAnalysisTypes.js";

it("uses the first structured observation when paths repeat", async () => {
  const root = await createTestTempDirectory("rea-artifact-graph-index-");
  await Promise.all([
    writeFile(join(root, "package.json"), JSON.stringify({ name: "fixture" })),
    writeFile(join(root, "data.json"), JSON.stringify({ actual: true })),
    writeFile(join(root, "app.js"), "//# sourceMappingURL=app.js.map"),
    writeFile(
      join(root, "app.js.map"),
      JSON.stringify({
        version: 3,
        sources: ["app.ts"],
        names: [],
        mappings: "",
      }),
    ),
  ]);
  const snapshot = await scanCanonicalArtifactInventory(root, {});
  const reader = createJavaScriptArtifactReader(root, "directory");
  try {
    const files = await readJavaScriptArtifactFiles(reader, snapshot);
    const { analysis } = await analyzeArtifactFiles(files);
    const packageObservation = analysis.packages.find(
      ({ path }) => path === "package.json",
    );
    const jsonObservation = analysis.json_modules.find(
      ({ path }) => path === "data.json",
    );
    const sourceMapObservation = analysis.source_maps.find(
      ({ path }) => path === "app.js.map",
    );
    expect(packageObservation).toBeDefined();
    expect(jsonObservation).toBeDefined();
    expect(sourceMapObservation).toBeDefined();
    if (
      packageObservation === undefined ||
      jsonObservation === undefined ||
      sourceMapObservation === undefined
    )
      throw new TypeError("Expected structured artifact observations");

    const graph = await immutableArtifactGraph(snapshot, files, {
      ...analysis,
      packages: [
        packageObservation,
        {
          ...packageObservation,
          status: "invalid",
          main_status: "unavailable",
          main_entrypoint: null,
          name: null,
          version: null,
          main: null,
          renderer_declarations: null,
          renderer_entrypoint: null,
          limitation: "later duplicate",
        } satisfies JavaScriptPackageObservation,
      ],
      json_modules: [
        jsonObservation,
        {
          ...jsonObservation,
          status: "invalid",
          top_level_keys: [],
          omitted_top_level_keys: 0,
          limitation: "later duplicate",
        } satisfies JavaScriptJsonModuleObservation,
      ],
      source_maps: [
        sourceMapObservation,
        {
          ...sourceMapObservation,
          status: "invalid",
          sources: [],
          limitation: "later duplicate",
        } satisfies JavaScriptSourceMapObservation,
      ],
    });

    const dataFile = graph.nodes.find(({ observations }) =>
      observations.some(({ properties }) => properties.path === "data.json"),
    );
    expect(dataFile?.observations[0]?.properties).toMatchObject({
      json_parse_status: "included",
      json_top_level_keys: ["actual"],
      omitted_json_top_level_keys: 0,
    });
    const unavailablePaths = graph.nodes
      .filter(({ kind }) => kind === "unknown")
      .flatMap(({ observations }) =>
        observations.map(({ properties }) => ({
          path: properties.path,
          operation: properties.operation,
        })),
      );
    expect(unavailablePaths).not.toContainEqual({
      path: "package.json",
      operation: "parse-package-json",
    });
    expect(unavailablePaths).not.toContainEqual({
      path: "data.json",
      operation: "parse-json-module",
    });
    expect(unavailablePaths).not.toContainEqual({
      path: "app.js.map",
      operation: "parse-local-source-map",
    });
  } finally {
    await reader.close();
  }
});

it("preserves unknown omitted-key count for unavailable JSON", async () => {
  const root = await createTestTempDirectory("rea-unavailable-json-");
  await Promise.all([
    writeFile(join(root, "package.json"), JSON.stringify({ name: "fixture" })),
    writeFile(join(root, "config.json"), Buffer.from([0xff])),
  ]);

  const snapshot = await scanCanonicalArtifactInventory(root, {});
  const reader = createJavaScriptArtifactReader(root, "directory");

  try {
    const files = await readJavaScriptArtifactFiles(reader, snapshot);
    const { analysis } = await analyzeArtifactFiles(files);
    const graph = await immutableArtifactGraph(snapshot, files, analysis);

    const configFile = graph.nodes.find(({ observations }) =>
      observations.some(
        ({ properties }) =>
          properties.path === "config.json" && properties.file_kind === "json",
      ),
    );

    const configObservation = configFile?.observations.find(
      ({ properties }) =>
        properties.path === "config.json" && properties.file_kind === "json",
    );

    expect(configObservation?.properties).toMatchObject({
      path: "config.json",
      text_status: "invalid-utf8",
      json_parse_status: "unavailable",
      omitted_json_top_level_keys: null,
    });
  } finally {
    await reader.close();
  }
});

it("preserves unknown omitted-key count for unselected JSON", async () => {
  const root = await createTestTempDirectory("rea-unselected-json-");

  await Promise.all([
    writeFile(join(root, "package.json"), JSON.stringify({ name: "fixture" })),
    writeFile(join(root, "config.json"), JSON.stringify({ setting: true })),
  ]);

  const snapshot = await scanCanonicalArtifactInventory(root, {});
  const reader = createJavaScriptArtifactReader(root, "directory");

  try {
    const files = await readJavaScriptArtifactFiles(
      reader,
      snapshot,
      undefined,
      ["package.json"],
    );

    const { analysis } = await analyzeArtifactFiles(files);
    const graph = await immutableArtifactGraph(snapshot, files, analysis);

    const configFile = graph.nodes.find(({ observations }) =>
      observations.some(
        ({ properties }) =>
          properties.path === "config.json" && properties.file_kind === "json",
      ),
    );

    const configObservation = configFile?.observations.find(
      ({ properties }) =>
        properties.path === "config.json" && properties.file_kind === "json",
    );

    expect(configObservation?.properties).toMatchObject({
      path: "config.json",
      text_status: "outside-analysis-scope",
      json_parse_status: null,
      omitted_json_top_level_keys: null,
    });
  } finally {
    await reader.close();
  }
});

it("preserves unknown omitted-key count for unselected uppercase JSON", async () => {
  const root = await createTestTempDirectory("rea-unselected-uppercase-json-");

  await Promise.all([
    writeFile(join(root, "package.json"), JSON.stringify({ name: "fixture" })),
    writeFile(join(root, "config.JSON"), JSON.stringify({ setting: true })),
  ]);

  const snapshot = await scanCanonicalArtifactInventory(root, {});
  const reader = createJavaScriptArtifactReader(root, "directory");

  try {
    const files = await readJavaScriptArtifactFiles(
      reader,
      snapshot,
      undefined,
      ["package.json"],
    );

    const { analysis } = await analyzeArtifactFiles(files);
    const graph = await immutableArtifactGraph(snapshot, files, analysis);

    const configFile = graph.nodes.find(({ observations }) =>
      observations.some(
        ({ properties }) =>
          properties.path === "config.JSON" && properties.file_kind === "json",
      ),
    );

    const configObservation = configFile?.observations.find(
      ({ properties }) =>
        properties.path === "config.JSON" && properties.file_kind === "json",
    );

    expect(configObservation?.properties).toMatchObject({
      path: "config.JSON",
      text_status: "outside-analysis-scope",
      json_parse_status: null,
      omitted_json_top_level_keys: null,
    });
  } finally {
    await reader.close();
  }
});
