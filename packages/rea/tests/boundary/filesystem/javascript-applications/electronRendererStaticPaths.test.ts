import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, it } from "vitest";

import { createTestTempDirectory } from "../../../fixtures/temporaryDirectory.js";
import { analyzeJavaScriptApplication } from "../../../support/javascriptApplicationScope.js";
import { javascriptApplicationAnalysisResultSchema } from "../../../../src/domain/javascript/javascriptApplicationAnalysis.js";

it("distinguishes module-anchored and application-relative BrowserWindow loadFile calls", async () => {
  const root = await createTestTempDirectory("rea-renderer-static-path-");
  await mkdir(join(root, "src"));
  await Promise.all([
    writeFile(
      join(root, "package.json"),
      JSON.stringify({ main: "src/main.cjs" }),
    ),
    writeFile(
      join(root, "src", "main.cjs"),
      `const path = require('node:path');
const { BrowserWindow } = require('electron');
new BrowserWindow().loadFile(path.join(__dirname, 'anchored.html'));
new BrowserWindow().loadFile('literal.html');
new BrowserWindow().loadFile(runtimePage);`,
    ),
    writeFile(
      join(root, "src", "anchored.html"),
      "actual source-anchored page",
    ),
    writeFile(join(root, "anchored.html"), "wrong app-root decoy"),
    writeFile(join(root, "literal.html"), "actual app-root page"),
    writeFile(join(root, "src", "literal.html"), "wrong source-relative decoy"),
  ]);
  const result = await analyzeJavaScriptApplication({
    input_path: root,
    format: "directory",
  });
  if (!result.ok) throw result.error;
  const graph = javascriptApplicationAnalysisResultSchema.parse(
    result.value.normalized_result,
  ).graph;
  const rendererPaths = graph.nodes
    .filter(({ kind }) => kind === "electron-renderer")
    .flatMap(({ observations }) =>
      observations.map(({ properties }) => properties.resolved_path),
    );
  expect(rendererPaths.sort()).toEqual(["literal.html", "src/anchored.html"]);
  expect(graph.coverage.status).toBe("partial");
  const anchored = graph.nodes.find(
    ({ kind, observations }) =>
      kind === "electron-renderer" &&
      observations.some(
        ({ properties }) => properties.resolved_path === "src/anchored.html",
      ),
  );
  expect(anchored?.observations[0]?.evidence.limitations).toContain(
    "The source-directory anchor is inferred from authored code; bundled or transformed runtime path behavior was not verified.",
  );
});
