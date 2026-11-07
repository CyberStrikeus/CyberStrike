import { expect } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";
import { analyzeJavaScriptDirectory } from "../../support/cli/javascriptApplication.js";
import { writeFixtureFiles } from "../../support/javascriptApplicationFixture.js";

cliTest.for(
  (["CLI", "stdio MCP"] as const).flatMap((surface) =>
    [false, true].map((unknownLoader) => ({ surface, unknownLoader })),
  ),
)(
  "retains possible application path setter owners through $surface (unknown loader: $unknownLoader)",
  async ({ surface, unknownLoader }, { cli }) => {
    const root = await createTestTempDirectory("rea-possible-setter-owner-");
    await writeFixtureFiles(root, {
      "a/package.json": JSON.stringify({ main: "main.cjs" }),
      "a/main.cjs": 'require("../shared/change.cjs");',
      "b/package.json": JSON.stringify({ main: "main.cjs" }),
      "b/main.cjs": `${unknownLoader ? "require(process.env.LOADER);" : ""} require("./window.cjs");`,
      "b/window.cjs":
        'const { BrowserWindow } = require("electron"); new BrowserWindow().loadFile("index.html");',
      "b/index.html": "second application page",
      "shared/change.cjs":
        'const { app } = require("electron"); app.setAppPath("/runtime/changed");',
      "shared/index.html": "setter-relative decoy",
      "index.html": "artifact-root decoy",
    });
    const { graph } = await analyzeJavaScriptDirectory(surface, cli, root);
    const roles = graph.nodes.filter(
      ({ kind }) => kind === "electron-renderer",
    );
    expect(roles).toHaveLength(1);
    const role = roles[0];
    const target = unknownLoader ? null : "b/index.html";
    expect(role?.observations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          properties: expect.objectContaining({
            resolved_path: target,
            resolution_status: unknownLoader ? "unavailable" : "resolved",
          }),
        }),
      ]),
    );
    expect(
      graph.edges
        .filter(
          ({ relation, source_node_id }) =>
            relation === "maps_to" && source_node_id === role?.node_id,
        )
        .map(({ properties }) => properties.resolved_path),
    ).toEqual(target === null ? [] : [target]);
    if (unknownLoader)
      expect(graph.edges).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            relation: "imports",
            properties: expect.objectContaining({
              kind: "require",
              specifier: null,
              resolved_path: null,
            }),
          }),
        ]),
      );
  },
);
