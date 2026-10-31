import { expect } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";
import { analyzeJavaScriptDirectory } from "../../support/cli/javascriptApplication.js";
import { writeFixtureFiles } from "../../support/javascriptApplicationFixture.js";

const cases = [
  ...(["ESM", "CommonJS", "Object.assign"] as const).flatMap((format) =>
    [false, true].map((replaced) => ({ format, replaced })),
  ),
  { format: "local exports Object.assign", replaced: false },
  { format: "detached exports Object.assign", replaced: false },
] as const;

cliTest.for(
  (["CLI", "stdio MCP"] as const).flatMap((surface) =>
    cases.map((testCase) => ({ surface, ...testCase })),
  ),
)(
  "retains $format exported app setter uncertainty (replaced=$replaced) through $surface",
  async ({ surface, format, replaced }, { cli }) => {
    const root = await createTestTempDirectory("rea-exported-app-path-");
    const connected =
      format !== "local exports Object.assign" &&
      format !== "detached exports Object.assign";
    const possible = connected && !replaced;
    const publication =
      format === "CommonJS"
        ? "module.exports={change,app};"
        : format === "local exports Object.assign"
          ? "function publish(exports){Object.assign(exports,{change,app})}publish({});"
          : `${format === "detached exports Object.assign" ? "module.exports={};" : ""}Object.assign(exports,{change,app});`;
    const files: Record<string, string> =
      format !== "ESM"
        ? {
            "a/package.json": '{"main":"main.cjs"}',
            "a/setter.cjs": `throw new Error('Static fixture must never execute');const {app}=require('electron');${replaced ? "app.setAppPath=()=>{};" : ""}const change=app.setAppPath;${publication}`,
            "a/main.cjs": `throw new Error('Static fixture must never execute');const {change,app}=require('./setter.cjs');const path=require('node:path');${connected ? "" : "if(typeof change==='function')"}change.call(app,path.join(__dirname,'lib'));require('./win.cjs');`,
            "a/win.cjs": `throw new Error('Static fixture must never execute');const {BrowserWindow}=require('electron');new BrowserWindow().loadFile('index.html');`,
          }
        : {
            "a/package.json": '{"main":"main.mjs"}',
            "a/main.mjs": `throw new Error('Static fixture must never execute');import {app,change} from '../shared/change.mjs';import {BrowserWindow} from 'electron';change.call(app,'./lib');new BrowserWindow().loadFile('index.html');`,
            "shared/change.mjs": `throw new Error('Static fixture must never execute');import {app} from 'electron';${replaced ? "app.setAppPath=()=>{};" : ""}const change=app.setAppPath;export {app,change};`,
          };
    await writeFixtureFiles(root, {
      ...files,
      "a/index.html": "application page",
      "a/lib/index.html": "changed application page",
      "shared/index.html": "source-relative decoy",
      "index.html": "artifact-root decoy",
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
    expect(roles[0]?.observations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          properties: expect.objectContaining({
            resolution_status: possible ? "unavailable" : "resolved",
          }),
        }),
      ]),
    );
    const mapped = graph.edges.filter(
      ({ relation, source_node_id }) =>
        relation === "maps_to" && source_node_id === roles[0]?.node_id,
    );
    expect(mapped).toHaveLength(possible ? 0 : 1);
    if (!possible)
      expect(mapped[0]?.properties.resolved_path).toBe("a/index.html");
  },
);
