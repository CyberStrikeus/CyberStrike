import { expect } from "vitest";

import { capturedGenericInvocations } from "../../fixtures/javascriptCapturedGenericInvocations.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";
import { analyzeJavaScriptDirectory } from "../../support/cli/javascriptApplication.js";
import { writeFixtureFiles } from "../../support/javascriptApplicationFixture.js";

cliTest.for(
  (["CLI", "stdio MCP"] as const).flatMap((surface) =>
    capturedGenericInvocations
      .filter(({ chain }) => chain === "call.call" || chain === "apply.call")
      .map((testCase) => ({ surface, ...testCase })),
  ),
)(
  "retains competing application owners for $name through $surface",
  async (testCase, { cli }) => {
    const root = await createTestTempDirectory("rea-captured-generic-");
    await writeFixtureFiles(root, {
      "a/package.json": JSON.stringify({ main: "main.cjs" }),
      "a/main.cjs": "require('../shared/window.cjs');",
      "a/index.html": "first application page",
      "b/package.json": JSON.stringify({ main: "main.cjs" }),
      "b/main.cjs": testCase.source,
      "b/index.html": "second application page",
      "shared/window.cjs":
        "const {BrowserWindow}=require('electron');new BrowserWindow().loadFile('index.html');",
      "shared/index.html": "source-directory decoy",
    });
    const { graph, statistics } = await analyzeJavaScriptDirectory(
      testCase.surface,
      cli,
      root,
    );
    expect(statistics.parse_failures).toBe(0);
    const renderer = graph.nodes.filter(
      ({ kind }) => kind === "electron-renderer",
    );
    expect(renderer).toHaveLength(1);
    expect(renderer[0]?.observations).toContainEqual(
      expect.objectContaining({
        properties: expect.objectContaining({
          resolved_path: testCase.host ? null : "a/index.html",
          resolution_status: testCase.host ? "unavailable" : "resolved",
        }),
      }),
    );
    const unknownLoads = graph.edges.filter(
      ({ relation, properties }) =>
        relation === "imports" && properties.specifier === null,
    );
    expect(unknownLoads.length > 0).toBe(testCase.host);
    if (testCase.host)
      expect(unknownLoads).toContainEqual(
        expect.objectContaining({
          properties: expect.objectContaining({
            expression: testCase.expression,
          }),
        }),
      );
    const mapped = graph.edges.filter(
      ({ relation, source_node_id }) =>
        relation === "maps_to" && source_node_id === renderer[0]?.node_id,
    );
    expect(mapped.map(({ properties }) => properties.resolved_path)).toEqual(
      testCase.host ? [] : ["a/index.html"],
    );
  },
);
