import { createRequire } from "node:module";
import { join } from "node:path";

import { expect, it } from "vitest";

import { analyzeArtifactFiles } from "../../../fixtures/javascriptArtifactAnalysis.js";
import { immutableArtifactGraph } from "../../../fixtures/javascriptArtifactGraph.js";
import { resolveArtifactPathByContext } from "../../../../src/application/javascript/JavaScriptArtifactPathResolution.js";
import { createJavaScriptArtifactReader } from "../../../../src/artifacts/javascript/JavaScriptArtifactReader.js";
import { scanCanonicalArtifactInventory } from "../../../fixtures/artifactInventory.js";
import { createTestTempDirectory } from "../../../fixtures/temporaryDirectory.js";
import { readJavaScriptArtifactFiles } from "../../../support/javascriptApplicationScope.js";
import { writeFixtureFiles } from "../../../support/javascriptApplicationFixture.js";

const windowSource =
  'const {BrowserWindow}=require("electron");new BrowserWindow().loadFile("index.html");';

it.each(
  [null, false, 123, {}, []].flatMap((main) =>
    [false, true].map((index) => ({ main, index, request: "./b" })),
  ),
)(
  "follows Node index admission for main=$main with index=$index",
  async ({ main, index, request }) => {
    const root = await createTestTempDirectory("rea-nonstring-package-main-");
    await writeFixtureFiles(root, {
      "a/package.json": JSON.stringify({ main: "main.cjs" }),
      "a/main.cjs": index ? "module.exports={};" : windowSource,
      "a/index.html": "first application page",
      "b/package.json": JSON.stringify({ main }),
      ...(index ? { "b/index.js": windowSource } : {}),
      "b/index.html": "second application page",
      "index.html": "artifact-root decoy",
    });
    const require = createRequire(join(root, "node-control.cjs"));
    if (index) expect(require.resolve(request)).toBe(join(root, "b/index.js"));
    else
      expect(() => require.resolve(request)).toThrow(
        expect.objectContaining({ code: "MODULE_NOT_FOUND" }),
      );
    const snapshot = await scanCanonicalArtifactInventory(root, {});
    const reader = createJavaScriptArtifactReader(root, "directory");
    try {
      const files = await readJavaScriptArtifactFiles(reader, snapshot);
      const { analysis } = await analyzeArtifactFiles(files);
      expect(
        analysis.packages.find(({ path }) => path === "b/package.json"),
      ).toMatchObject({ main_status: "invalid", main_entrypoint: "" });
      const graph = await immutableArtifactGraph(snapshot, files, analysis);
      const roles = graph.nodes.filter(
        ({ kind }) => kind === "electron-renderer",
      );
      expect(roles).toHaveLength(1);
      expect(roles[0]?.observations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            properties: expect.objectContaining({
              resolution_status: "resolved",
              resolved_path: index ? "b/index.html" : "a/index.html",
            }),
          }),
        ]),
      );
    } finally {
      await reader.close();
    }
  },
);

it.each(
  (
    [
      ["{", false],
      ["[]", false],
      ["[{}]", false],
      ["123", false],
      ['"root"', false],
      ["null", false],
      ["false", false],
      ["{}", true],
      ['{"main":[]}', true],
    ] as const
  ).map(([text, valid]) => ({ text, valid, request: "./b" })),
)(
  "distinguishes malformed package root $text from a valid index fallback",
  async ({ text, valid, request }) => {
    const root = await createTestTempDirectory("rea-invalid-package-main-");
    await writeFixtureFiles(root, {
      "a/package.json": JSON.stringify({ main: "main.cjs" }),
      "a/main.cjs": windowSource,
      "a/index.html": "first application page",
      "b/package.json": text,
      "b/index.js": "module.exports={};",
      "index.html": "artifact-root decoy",
    });
    const require = createRequire(join(root, "node-control.cjs"));
    if (valid) expect(require.resolve(request)).toBe(join(root, "b/index.js"));
    else
      expect(() => require.resolve(request)).toThrow(
        expect.objectContaining({ code: "ERR_INVALID_PACKAGE_CONFIG" }),
      );
    const snapshot = await scanCanonicalArtifactInventory(root, {});
    const reader = createJavaScriptArtifactReader(root, "directory");
    try {
      const files = await readJavaScriptArtifactFiles(reader, snapshot);
      const { analysis } = await analyzeArtifactFiles(files);
      expect(
        analysis.packages.find(({ path }) => path === "b/package.json"),
      ).toMatchObject({
        status: valid ? "included" : "invalid",
        main_entrypoint: valid ? "" : null,
      });
      expect(
        resolveArtifactPathByContext({
          sourcePath: "a/main.cjs",
          declaredPath: "../b",
          context: "module-specifier",
          moduleKind: "require",
          files: new Map(files.files.map((file) => [file.path, file])),
          jsonDocuments: analysis.jsonDocuments,
        }),
      ).toMatchObject({
        resolution_status: valid ? "resolved" : "unavailable",
        resolved_path: valid ? "b/index.js" : null,
      });
      const graph = await immutableArtifactGraph(snapshot, files, analysis);
      const role = graph.nodes.find(({ kind }) => kind === "electron-renderer");
      expect(role?.observations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            properties: expect.objectContaining({
              resolution_status: valid ? "resolved" : "unavailable",
              resolved_path: valid ? "a/index.html" : null,
            }),
          }),
        ]),
      );
    } finally {
      await reader.close();
    }
  },
);
