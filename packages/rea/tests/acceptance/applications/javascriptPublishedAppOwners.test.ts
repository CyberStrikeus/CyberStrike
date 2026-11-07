import { expect } from "vitest";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";
import {
  analyzeJavaScriptDirectory,
  runNodeJsonControl,
} from "../../support/cli/javascriptApplication.js";
import { writeFixtureFiles } from "../../support/javascriptApplicationFixture.js";

const cases = [
  {
    name: "whole app ESM",
    body: "export {app};",
    esm: true,
    changed: true,
    oracle: "module.exports={app};",
  },
  { name: "whole app CommonJS", body: "module.exports={app};", changed: true },
  {
    name: "later local assign",
    body: "Object.assign(exports,{change:app.setAppPath},{change(){}});",
    changed: false,
  },
  {
    name: "later native assign",
    body: "Object.assign(exports,{change(){}},{change:app.setAppPath});",
    changed: true,
  },
  {
    name: "inherited setter",
    body: "const source={__proto__:{change:app.setAppPath}};Object.assign(exports,source);",
    changed: false,
  },
  {
    name: "own setter",
    body: "const source={__proto__:{change(){}},change:app.setAppPath};Object.assign(exports,source);",
    changed: true,
  },
] as const;
cliTest.for(
  (["CLI", "stdio MCP"] as const).flatMap((surface) =>
    cases.map((test) => ({ ...test, surface })),
  ),
)(
  "retains only the actually published $name app capability through $surface",
  async (test, { cli }) => {
    const { surface, body, changed } = test;
    const esm = "esm" in test && test.esm;
    const root = await createTestTempDirectory("rea-published-app-owner-");
    const prefix = esm
      ? 'import {app} from "electron";'
      : 'const {app}=require("electron");';
    const helper = `shared/helper.${esm ? "mjs" : "cjs"}`;
    const oracleBody = "oracle" in test ? test.oracle : body;
    await writeFixtureFiles(root, {
      "app/package.json": JSON.stringify({
        main: esm ? "main.mjs" : "main.cjs",
      }),
      [`app/main.${esm ? "mjs" : "cjs"}`]: esm
        ? 'import * as api from "../shared/helper.mjs";import {BrowserWindow} from "electron";api.app.setAppPath("./other");new BrowserWindow().loadFile("index.html");'
        : 'const api=require("../shared/helper.cjs");const {BrowserWindow}=require("electron");if(api.app)api.app.setAppPath("./other");else if(api.change)api.change("./other");new BrowserWindow().loadFile("index.html");',
      [helper]: prefix + body,
      "app/index.html": "package root decoy for native setters",
      "shared/index.html": "helper-relative decoy",
      "oracle.cjs": `const vm=require('node:vm');let changed=0;const app={setAppPath(){changed++}};const fixtureModule={exports:{}};vm.runInNewContext(${JSON.stringify(oracleBody)},{app,module:fixtureModule,exports:fixtureModule.exports});const value=fixtureModule.exports;if(value.app)value.app.setAppPath('./other');else if(value.change)value.change.call(app,'./other');console.log(JSON.stringify({changed:changed>0}));`,
    });
    expect(await runNodeJsonControl(root, "oracle.cjs")).toEqual({ changed });
    const { graph } = await analyzeJavaScriptDirectory(surface, cli, root, {
      sourcePaths: [
        "app/package.json",
        `app/main.${esm ? "mjs" : "cjs"}`,
        helper,
      ],
    });
    const roles = graph.nodes.filter(
      ({ kind }) => kind === "electron-renderer",
    );
    expect(roles).toHaveLength(1);
    const target = changed ? null : "app/index.html";
    expect(roles[0]?.observations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          properties: expect.objectContaining({
            resolved_path: target,
            resolution_status: changed ? "unavailable" : "resolved",
          }),
        }),
      ]),
    );
    expect(
      graph.edges
        .filter(
          ({ relation, source_node_id }) =>
            relation === "maps_to" && source_node_id === roles[0]?.node_id,
        )
        .map(({ properties }) => properties.resolved_path),
    ).toEqual(target === null ? [] : [target]);
  },
);
