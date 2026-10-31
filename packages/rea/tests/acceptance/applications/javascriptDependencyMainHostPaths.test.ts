import { expect } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";
import { analyzeJavaScriptDirectory } from "../../support/cli/javascriptApplication.js";
import { writeFixtureFiles } from "../../support/javascriptApplicationFixture.js";

cliTest.for(
  (["CLI", "stdio MCP"] as const).flatMap((surface) =>
    [
      { main: "/shared/window.cjs", status: "unavailable" },
      { main: "../../shared/window.cjs", status: "resolved" },
      { main: "sub\\entry.cjs", status: "unavailable" },
    ].map((testCase) => ({ surface, ...testCase })),
  ),
)(
  "keeps dependency main $main in its lookup domain through $surface",
  async ({ surface, main, status }, { cli }) => {
    const root = await createTestTempDirectory("rea-dependency-host-main-");
    await writeFixtureFiles(root, {
      "a/package.json": '{"main":"main.cjs"}',
      "a/main.cjs":
        'throw new Error("Static fixture must never execute");require("fixture");',
      "a/index.html": "first application page",
      "b/package.json": '{"main":"main.cjs"}',
      "b/main.cjs":
        'throw new Error("Static fixture must never execute");require("../shared/window.cjs");',
      "b/index.html": "second application page",
      "node_modules/fixture/package.json": JSON.stringify({ main }),
      ...(main.includes("\\")
        ? {
            "node_modules/fixture/sub/entry.cjs":
              'throw new Error("Static fixture must never execute");require("../../../shared/window.cjs");',
          }
        : {}),
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
        relation === "imports" && properties.specifier === "fixture",
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
    expect(
      graph.edges.filter(
        ({ relation, source_node_id }) =>
          relation === "maps_to" && source_node_id === roles[0]?.node_id,
      ),
    ).toEqual([]);
  },
);
