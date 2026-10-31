import { expect } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";
import { analyzeJavaScriptDirectory } from "../../support/cli/javascriptApplication.js";
import { writeFixtureFiles } from "../../support/javascriptApplicationFixture.js";

cliTest.for(
  (["CLI", "stdio MCP"] as const).flatMap((surface) =>
    [
      {
        name: "local helper",
        declaration: "const helper={resolve(value){return value}};",
        expression: 'helper.resolve(runtimePath,__dirname,"decoy.cjs")',
        preload: null,
      },
      {
        name: "Node path resolver",
        declaration: 'const path=require("node:path");',
        expression: 'path.resolve(runtimePath,__dirname,"decoy.cjs")',
        preload: "decoy.cjs",
      },
      {
        name: "untouched CommonJS directory parameter",
        declaration: 'var __dirname;const path=require("node:path");',
        expression: 'path.join(__dirname,"decoy.cjs")',
        preload: "decoy.cjs",
      },
      {
        name: "local dirname helper",
        declaration:
          'import path from "node:path";const helper={dirname(){return "/local"}};',
        expression:
          'path.resolve(runtimePath,helper.dirname(import.meta.url),"decoy.cjs")',
        preload: null,
        mainFile: "main.mjs",
      },
      {
        name: "Node dirname and source URL",
        declaration:
          'import path from "node:path";import {fileURLToPath} from "node:url";',
        expression:
          'path.resolve(runtimePath,path.dirname(fileURLToPath(import.meta.url)),"decoy.cjs")',
        preload: "decoy.cjs",
        mainFile: "main.mjs",
      },
      {
        name: "separate default path write",
        declaration:
          'import changed from "node:path";import path from "path";changed.resolve=first=>first;',
        expression: 'path.resolve(runtimePath,__dirname,"decoy.cjs")',
        preload: null,
        mainFile: "main.mjs",
      },
      {
        name: "separate default URL write",
        declaration:
          'import changed from "node:url";import url from "url";import path from "node:path";changed.fileURLToPath=()=>"/changed/main.mjs";',
        expression:
          'path.resolve(runtimePath,path.dirname(url.fileURLToPath(import.meta.url)),"decoy.cjs")',
        preload: null,
        mainFile: "main.mjs",
      },
      {
        name: "shadowed directory",
        declaration: 'const path=require("node:path");',
        expression: 'path.resolve(runtimePath,__dirname,"decoy.cjs")',
        preload: null,
        scopeStart: "function build(__dirname){",
        scopeEnd: "}build('local-directory');",
      },
    ].map((testCase) => ({
      surface,
      scopeStart: "",
      scopeEnd: "",
      mainFile: "main.cjs",
      ...testCase,
    })),
  ),
)(
  "requires the $name owner for preload resolve semantics through $surface",
  async (
    {
      surface,
      declaration,
      expression,
      preload,
      scopeStart,
      scopeEnd,
      mainFile,
    },
    { cli },
  ) => {
    const root = await createTestTempDirectory("rea-preload-resolve-owner-");
    await writeFixtureFiles(root, {
      "package.json": JSON.stringify({ main: mainFile }),
      [mainFile]: `throw new Error('Static fixture must never execute');${mainFile.endsWith(".mjs") ? "import {BrowserWindow} from 'electron';" : "const {BrowserWindow}=require('electron');"}${declaration}${scopeStart}new BrowserWindow({webPreferences:{preload:${expression}}});${scopeEnd}`,
      "decoy.cjs": "throw new Error('Static preload must never execute');",
    });
    const { graph, statistics } = await analyzeJavaScriptDirectory(
      surface,
      cli,
      root,
    );
    expect(statistics.parse_failures).toBe(0);
    const windows = graph.nodes.filter(({ kind }) => kind === "browser-window");
    expect(windows).toHaveLength(1);
    expect(windows[0]?.observations[0]?.properties.preload_path).toBe(preload);
    const associations = graph.edges.filter(
      ({ source_node_id, evidence }) =>
        source_node_id === windows[0]?.node_id &&
        evidence.extractor.operation === "associate-browser-window-preload",
    );
    if (preload === null) expect(associations).toEqual([]);
    else
      expect(associations).toEqual([
        expect.objectContaining({
          relation: "loads",
          properties: expect.objectContaining({
            resolved_path: preload,
            resolution_status: "resolved",
          }),
        }),
      ]);
  },
);
