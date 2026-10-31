import { expect } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";
import { analyzeJavaScriptDirectory } from "../../support/cli/javascriptApplication.js";
import { writeFixtureFiles } from "../../support/javascriptApplicationFixture.js";

const cases = [
  { declared: "sub\\index.html", status: "unavailable", path: null },
  { declared: "C:index.html", status: "unavailable", path: null },
  {
    declared: "sub/index.html",
    status: "resolved",
    path: "app/sub/index.html",
  },
  { declared: "sub\\index\0.html", status: "rejected", path: null },
] as const;

cliTest.for(
  (["CLI", "stdio MCP"] as const).flatMap((surface) =>
    cases.map((testCase) => ({ surface, ...testCase })),
  ),
)(
  "preserves loadFile host path semantics through $surface: $declared",
  async ({ surface, declared, status, path }, { cli }) => {
    const root = await createTestTempDirectory("rea-windows-loadfile-path-");
    await writeFixtureFiles(root, {
      "app/package.json": JSON.stringify({ main: "main.cjs" }),
      "app/main.cjs": [
        'throw new Error("Static fixture must never execute");',
        'const {BrowserWindow}=require("electron");',
        `new BrowserWindow().loadFile(${JSON.stringify(declared)});`,
      ].join("\n"),
      "app/sub/index.html": "application page",
      "sub/index.html": "artifact-root decoy",
    });
    const { graph, statistics } = await analyzeJavaScriptDirectory(
      surface,
      cli,
      root,
    );
    expect(statistics.parse_failures).toBe(0);
    const roles = graph.nodes.filter(
      ({ kind }) => kind === "electron-renderer",
    );
    expect(roles).toHaveLength(1);
    const role = roles[0];
    expect(role?.observations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          properties: expect.objectContaining({
            declared_path: declared,
            resolution_status: status,
            resolved_path: path,
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
    ).toEqual(path === null ? [] : [path]);
  },
);
