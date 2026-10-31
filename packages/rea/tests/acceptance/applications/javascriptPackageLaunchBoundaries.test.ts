import { createPackageWithOptions } from "@electron/asar";
import { join } from "node:path";
import { expect } from "vitest";

import type { JavaScriptApplicationGraph } from "../../../src/domain/javascript/javascriptApplicationGraph.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";
import { analyzeJavaScriptDirectory } from "../../support/cli/javascriptApplication.js";
import { writeFixtureFiles } from "../../support/javascriptApplicationFixture.js";

const windowSource =
  'const { BrowserWindow } = require("electron"); new BrowserWindow().loadFile("index.html");';

const expectRendererOwner = (
  graph: JavaScriptApplicationGraph,
  competing: boolean,
): void => {
  const renderers = graph.nodes.filter(
    ({ kind }) => kind === "electron-renderer",
  );
  expect(renderers).toHaveLength(1);
  const role = renderers[0];
  expect(role?.observations).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        properties: expect.objectContaining({
          resolution_status: competing ? "unavailable" : "resolved",
          resolved_path: competing ? null : "a/index.html",
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
  ).toEqual(competing ? [] : ["a/index.html"]);
};

const launchCases = [
  {
    name: "package index fallback",
    main: "missing.cjs",
    files: { "b/index.js": 'require("../shared/window.cjs");' },
    competing: true,
    entry: "b/index.js",
  },
  {
    name: "absent package index",
    main: "missing.cjs",
    files: {},
    competing: false,
  },
  {
    name: "main before package index",
    main: "main.cjs",
    files: {
      "b/main.cjs": "module.exports = {};",
      "b/index.js": 'require("../shared/window.cjs");',
    },
    competing: false,
    entry: "b/main.cjs",
  },
  {
    name: "inert JSON index fallback",
    main: "missing.cjs",
    files: { "b/index.json": "{}" },
    competing: false,
  },
] as const;

cliTest.for(
  (["CLI", "stdio MCP"] as const).flatMap((surface) =>
    launchCases.map((testCase) => ({ surface, ...testCase })),
  ),
)(
  "keeps launch ownership for $name through $surface",
  async (testCase, { cli }) => {
    const root = await createTestTempDirectory("rea-package-launch-");
    await writeFixtureFiles(root, {
      "a/package.json": JSON.stringify({ main: "main.cjs" }),
      "a/main.cjs": 'require("../shared/window.cjs");',
      "a/index.html": "first application page",
      "b/package.json": JSON.stringify({ main: testCase.main }),
      "b/index.html": "second application page",
      "shared/window.cjs": windowSource,
      "shared/index.html": "source-directory decoy",
      ...testCase.files,
    });
    const { graph } = await analyzeJavaScriptDirectory(
      testCase.surface,
      cli,
      root,
    );
    expectRendererOwner(graph, testCase.competing);
    if ("entry" in testCase)
      expect(graph.edges).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            relation: "loads",
            properties: expect.objectContaining({
              declared_path: testCase.main,
              resolved_path: testCase.entry,
              resolution_status: "resolved",
            }),
          }),
        ]),
      );
  },
);

cliTest.for(
  (["CLI", "stdio MCP"] as const).flatMap((surface) =>
    ["code.asar", "APP.ASAR", "app.AsAr"].map((archive) => ({
      surface,
      archive,
    })),
  ),
)(
  "keeps competing package launch owners across $archive through $surface",
  async ({ surface, archive }, { cli }) => {
    const root = await createTestTempDirectory("rea-package-archive-main-");
    const source = join(root, "source");
    const application = join(root, "application");
    const declaredMain = `../resources/${archive}/window.cjs`;
    await writeFixtureFiles(source, {
      "window.cjs": windowSource,
      "index.html": "archive-root decoy",
    });
    await writeFixtureFiles(application, {
      "a/package.json": JSON.stringify({ main: "main.cjs" }),
      "a/main.cjs": `require(${JSON.stringify(declaredMain)});`,
      "a/index.html": "first application page",
      "b/package.json": JSON.stringify({ main: declaredMain }),
      "b/index.js": "module.exports = {};",
      "b/index.html": "second application page",
    });
    await createPackageWithOptions(
      source,
      join(application, `resources/${archive}`),
      {},
    );
    const { graph } = await analyzeJavaScriptDirectory(
      surface,
      cli,
      application,
    );
    expectRendererOwner(graph, true);
    expect(graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          relation: "loads",
          properties: expect.objectContaining({
            declared_path: declaredMain,
            resolved_path: `resources/${archive}/window.cjs`,
            resolution_status: "resolved",
          }),
        }),
      ]),
    );
  },
);
