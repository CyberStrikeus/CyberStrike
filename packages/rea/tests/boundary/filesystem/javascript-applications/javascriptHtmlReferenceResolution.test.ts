import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, it } from "vitest";

import { reconstructJavaScriptArtifact } from "../../../support/javascriptApplicationScope.js";
import { createTestTempDirectory } from "../../../fixtures/temporaryDirectory.js";

it("resolves empty-path HTML script URLs against their canonical base path", async () => {
  const root = await createTestTempDirectory("rea-html-empty-reference-");
  await Promise.all([
    mkdir(join(root, "base-file", "assets"), { recursive: true }),
    mkdir(join(root, "base-directory", "assets"), { recursive: true }),
    mkdir(join(root, "escaped"), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(
      join(root, "document.html"),
      '<script src="?document=1"></script><script src="#document-fragment"></script>',
    ),
    writeFile(
      join(root, "base-file", "index.html"),
      '<base href="assets/entry.html?base=1#base-fragment"><script src="?base-file=1#script-fragment"></script>',
    ),
    writeFile(join(root, "base-file", "assets", "entry.html"), "<main></main>"),
    writeFile(
      join(root, "base-directory", "index.html"),
      '<base href="assets/"><script src="?base-directory=1"></script>',
    ),
    writeFile(
      join(root, "base-directory", "assets", "index.js"),
      "export const value = 1;",
    ),
    writeFile(
      join(root, "escaped", "index.html"),
      '<base href="../../outside/"><script src="?escape=1"></script>',
    ),
  ]);

  const result = await reconstructJavaScriptArtifact({
    input_path: root,
    format: "directory",
  });
  const graph = result.graph;
  const loadFor = (scriptPath: string) =>
    graph.edges.find(
      (edge) =>
        edge.relation === "loads" && edge.properties.script_path === scriptPath,
    );
  const targetPath = (edge: NonNullable<ReturnType<typeof loadFor>>) =>
    graph.nodes
      .find(({ node_id }) => node_id === edge.target_node_id)
      ?.observations.find(
        ({ properties }) => typeof properties.path === "string",
      )?.properties.path;
  const unresolvedReference = (scriptPath: string) =>
    graph.nodes
      .flatMap(({ observations }) => observations)
      .find(
        ({ properties }) =>
          properties.mechanism === "html-script-reference" &&
          properties.script_path === scriptPath,
      )?.properties;

  for (const scriptPath of ["?document=1", "#document-fragment"]) {
    const edge = loadFor(scriptPath);
    expect(edge).toMatchObject({
      properties: {
        script_path: scriptPath,
        resolved_path: "document.html",
        resolution_status: "resolved",
      },
    });
    if (edge !== undefined) expect(targetPath(edge)).toBe("document.html");
  }

  const baseFileEdge = loadFor("?base-file=1#script-fragment");
  expect(baseFileEdge).toMatchObject({
    properties: {
      script_path: "?base-file=1#script-fragment",
      base_href: "assets/entry.html?base=1#base-fragment",
      resolved_path: "base-file/assets/entry.html",
      resolution_status: "resolved",
    },
  });
  if (baseFileEdge !== undefined)
    expect(targetPath(baseFileEdge)).toBe("base-file/assets/entry.html");

  expect(unresolvedReference("?base-directory=1")).toMatchObject({
    resolution_status: "not-found",
    limitations: [expect.stringContaining("resolves to directory")],
  });
  expect(unresolvedReference("?escape=1")).toMatchObject({
    resolution_status: "rejected",
    limitations: [
      expect.stringContaining("escapes the canonical artifact root"),
    ],
  });
});
