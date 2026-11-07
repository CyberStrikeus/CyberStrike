import { expect } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";
import { analyzeJavaScriptDirectory } from "../../support/cli/javascriptApplication.js";
import { writeFixtureFiles } from "../../support/javascriptApplicationFixture.js";

cliTest.for(
  (["CLI", "stdio MCP"] as const).flatMap((surface) =>
    [false, true].map((invalidJson) => ({ surface, invalidJson })),
  ),
)(
  "separates an absent default main from malformed package JSON through $surface (invalidJson=$invalidJson)",
  async ({ surface, invalidJson }, { cli }) => {
    const root = await createTestTempDirectory("rea-nonstring-main-controls-");
    await writeFixtureFiles(root, {
      "a/package.json": JSON.stringify({ main: "main.cjs" }),
      "a/main.cjs": [
        'throw new Error("Static fixture must never execute");',
        'const {BrowserWindow}=require("electron");new BrowserWindow().loadFile("index.html");',
      ].join("\n"),
      "a/index.html": "known first application page",
      "b/package.json": invalidJson ? "{" : JSON.stringify({ main: false }),
      ...(invalidJson ? { "b/index.js": "module.exports={};" } : {}),
      "index.html": "artifact-root decoy",
    });
    const { graph } = await analyzeJavaScriptDirectory(surface, cli, root);
    const packages = graph.nodes.filter(({ kind }) => kind === "package");
    expect(packages).toContainEqual(
      expect.objectContaining({
        observations: expect.arrayContaining([
          expect.objectContaining({
            properties: expect.objectContaining({
              path: "b/package.json",
              main_status: invalidJson ? "unavailable" : "invalid",
              parse_status: invalidJson ? "invalid" : "included",
            }),
          }),
        ]),
      }),
    );
    const roles = graph.nodes.filter(
      ({ kind }) => kind === "electron-renderer",
    );
    expect(roles).toHaveLength(1);
    const role = roles[0];
    const target = invalidJson ? null : "a/index.html";
    expect(role?.observations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          properties: expect.objectContaining({
            resolution_status: invalidJson ? "unavailable" : "resolved",
            resolved_path: target,
          }),
        }),
      ]),
    );
    expect(
      graph.edges
        .filter(
          ({ source_node_id, relation }) =>
            source_node_id === role?.node_id && relation === "maps_to",
        )
        .map(({ properties }) => properties.resolved_path),
    ).toEqual(target === null ? [] : [target]);
  },
);
