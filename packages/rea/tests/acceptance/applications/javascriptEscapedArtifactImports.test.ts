import { expect } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";
import { analyzeJavaScriptDirectory } from "../../support/cli/javascriptApplication.js";
import { writeFixtureFiles } from "../../support/javascriptApplicationFixture.js";

cliTest.for(
  (["CLI", "stdio MCP"] as const).flatMap((surface) =>
    [
      {
        request: "../../rea-artifact/shared/window.cjs",
        status: "rejected",
      },
      { request: "../shared/window.cjs", status: "resolved" },
    ].map((testCase) => ({ surface, ...testCase })),
  ),
)(
  "keeps ESM request $request within its real artifact boundary through $surface",
  async ({ surface, request, status }, { cli }) => {
    const root = await createTestTempDirectory("rea-esm-artifact-escape-");
    await writeFixtureFiles(root, {
      "a/package.json": '{"main":"main.mjs"}',
      "a/main.mjs": `throw new Error('Static fixture must never execute');import ${JSON.stringify(request)};`,
      "a/index.html": "first application page",
      "b/package.json": '{"main":"main.mjs"}',
      "b/main.mjs":
        'throw new Error("Static fixture must never execute");import "../shared/window.cjs";',
      "b/index.html": "second application page",
      "shared/window.cjs":
        'throw new Error("Static fixture must never execute");const {BrowserWindow}=require("electron");new BrowserWindow().loadFile("index.html");',
      "shared/index.html": "source-relative decoy",
      "index.html": "artifact-root decoy",
    });
    const { graph, statistics } = await analyzeJavaScriptDirectory(
      surface,
      cli,
      root,
    );
    expect(statistics.parse_failures).toBe(0);
    const imports = graph.edges.filter(
      ({ relation, properties }) =>
        relation === "imports" && properties.specifier === request,
    );
    expect(imports.length).toBeGreaterThan(0);
    for (const edge of imports)
      expect(edge.properties).toMatchObject({
        resolution_status: status,
        resolved_path: status === "resolved" ? "shared/window.cjs" : null,
      });
    const roles = graph.nodes.filter(
      ({ kind }) => kind === "electron-renderer",
    );
    expect(roles).toHaveLength(1);
    const mapped = graph.edges.filter(
      ({ relation, source_node_id }) =>
        relation === "maps_to" && source_node_id === roles[0]?.node_id,
    );
    expect(mapped).toHaveLength(status === "rejected" ? 1 : 0);
    if (status === "rejected")
      expect(mapped[0]?.properties.resolved_path).toBe("b/index.html");
  },
);
