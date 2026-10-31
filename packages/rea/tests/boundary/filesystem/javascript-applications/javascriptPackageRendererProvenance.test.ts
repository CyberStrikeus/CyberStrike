import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, it } from "vitest";

import { createTestTempDirectory } from "../../../fixtures/temporaryDirectory.js";
import { analyzeJavaScriptApplication } from "../../../support/javascriptApplicationScope.js";
import { javascriptApplicationAnalysisResultSchema } from "../../../../src/domain/javascript/javascriptApplicationAnalysis.js";

const packageGraph = async (metadata: Record<string, unknown>) => {
  const root = await createTestTempDirectory(
    "rea-package-renderer-provenance-",
  );
  await Promise.all([
    writeFile(join(root, "package.json"), JSON.stringify(metadata)),
    writeFile(join(root, "entry.js"), "export const value = 42;"),
  ]);
  const result = await analyzeJavaScriptApplication({
    input_path: root,
    format: "directory",
  });
  if (!result.ok) throw result.error;
  return javascriptApplicationAnalysisResultSchema.parse(
    result.value.normalized_result,
  ).graph;
};

it.each(["renderer", "browser", "module"] as const)(
  "attributes the package renderer candidate to its actual %s field",
  async (field) => {
    const graph = await packageGraph({ [field]: "entry.js" });
    const role = graph.nodes.find(({ kind }) => kind === "electron-renderer");
    expect(role?.observations).toContainEqual(
      expect.objectContaining({
        properties: expect.objectContaining({
          mechanism: `package.json:${field}`,
          resolved_path: "entry.js",
        }),
      }),
    );
    const metadata = graph.nodes.find(({ kind }) => kind === "package");
    expect(metadata?.observations).toContainEqual(
      expect.objectContaining({
        properties: expect.objectContaining({
          renderer_declarations: { [field]: "entry.js" },
        }),
      }),
    );
    expect(metadata?.observations[0]?.properties).not.toHaveProperty(
      "renderer",
    );
    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        source_node_id: metadata?.node_id,
        target_node_id: role?.node_id,
        relation: "loads",
        properties: expect.objectContaining({
          source_field: field,
          declared_path: "entry.js",
        }),
      }),
    );
    expect(metadata?.observations[0]?.properties.renderer_declarations).toEqual(
      { [field]: "entry.js" },
    );
  },
);

it("keeps present browser mappings distinct from absent renderer metadata when module supplies the candidate", async () => {
  const graph = await packageGraph({
    browser: { "./server.js": "./client.js" },
    module: "entry.js",
  });
  const metadata = graph.nodes.find(({ kind }) => kind === "package");
  expect(metadata?.observations[0]?.properties).toMatchObject({
    renderer_declarations: {
      browser: { status: "non-string" },
      module: "entry.js",
    },
  });
  expect(
    graph.nodes.find(({ kind }) => kind === "electron-renderer")
      ?.observations[0]?.properties.mechanism,
  ).toBe("package.json:module");
});

it("retains simultaneous string declarations while keeping renderer priority", async () => {
  const graph = await packageGraph({
    renderer: "entry.js",
    browser: "browser.js",
    module: "module.js",
  });
  const metadata = graph.nodes.find(({ kind }) => kind === "package");
  expect(metadata?.observations[0]?.properties).toMatchObject({
    renderer_declarations: {
      renderer: "entry.js",
      browser: "browser.js",
      module: "module.js",
    },
  });
  expect(
    graph.nodes.find(({ kind }) => kind === "electron-renderer")
      ?.observations[0]?.properties.mechanism,
  ).toBe("package.json:renderer");
});
