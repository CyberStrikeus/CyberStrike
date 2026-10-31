import { posix } from "node:path";

import { expect, it } from "vitest";

import { analyzeCommonJsStaticFixture } from "../../../tests/fixtures/javascriptCommonJsAnalysis.js";

it.each(["/other", "relative"])(
  "keeps a shadowed source-directory parameter dynamic: %s",
  (directory) => {
    const actual = posix.resolve("/runtime/base", directory, "decoy.cjs");
    expect(actual).not.toBe("/source/app/decoy.cjs");
    const analysis = analyzeCommonJsStaticFixture(`
      const path = require('node:path');
      const {BrowserWindow, utilityProcess} = require('electron');
      function build(__dirname) {
        new BrowserWindow({webPreferences:{preload:path.resolve(runtimeBase,__dirname,'decoy.cjs')}});
        utilityProcess.fork(path.resolve(runtimeBase,__dirname,'decoy.cjs'));
      }
      build(${JSON.stringify(directory)});
    `);
    expect(analysis.role_paths).toEqual([]);
    expect(analysis.electron.browser_windows).toMatchObject([
      { preload_path: null, preload_resolution_context: null },
    ]);
    expect(analysis.electron.utility_processes).toMatchObject([
      { module_path: null, module_resolution_context: null },
    ]);
  },
);

const localResolvers = [
  [
    "local object",
    "const helper = {resolve(first) {return first;}};",
    "helper.resolve",
  ],
  [
    "familiar name",
    "const path = {resolve(first) {return first;}};",
    "path.resolve",
  ],
  [
    "shadowed require",
    "const require = () => ({resolve(first) {return first;}}); const helper = require('node:path');",
    "helper.resolve",
  ],
  [
    "replaced Node method",
    "const helper = require('node:path'); helper.resolve = first => first;",
    "helper.resolve",
  ],
  [
    "ambiguous owner",
    "const helper = flag ? require('node:path') : {resolve(first) {return first;}};",
    "helper.resolve",
  ],
] as const;

it.each(localResolvers)(
  "keeps %s resolve calls dynamic",
  (_name, setup, callee) => {
    const expression = `${callee}(runtimePath, __dirname, "decoy.cjs")`;
    const native = new Function(
      "require",
      "runtimePath",
      "__dirname",
      "flag",
      `{ ${setup} return ${expression}; }`,
    );
    expect(
      native(
        () => ({ ...posix }),
        "/actual/runtime.cjs",
        "/fixture/app",
        false,
      ),
    ).toBe("/actual/runtime.cjs");
    const analysis = analyzeCommonJsStaticFixture(`
    import {BrowserWindow, utilityProcess} from 'electron';
    ${setup}
    new BrowserWindow({webPreferences:{preload:${expression}}});
    utilityProcess.fork(${expression});
  `);
    expect(analysis.role_paths).toEqual([]);
    expect(analysis.electron.browser_windows).toMatchObject([
      { preload_path: null, preload_resolution_context: null },
    ]);
    expect(analysis.electron.utility_processes).toMatchObject([
      { module_path: null, module_resolution_context: null },
    ]);
  },
);

const nodeResolvers = [
  ["require", "const helper = require('node:path');", "helper.resolve"],
  [
    "destructured alias",
    "const {resolve: select} = require('path');",
    "select",
  ],
  [
    "POSIX namespace",
    "const helper = require('node:path');",
    "helper.posix.resolve",
  ],
  [
    "POSIX alias",
    "const {posix: helper} = require('node:path');",
    "helper.resolve",
  ],
  [
    "POSIX module",
    "const helper = require('node:path/posix');",
    "helper.resolve",
  ],
  ["default import", "import helper from 'node:path';", "helper.resolve"],
  [
    "namespace import",
    "import * as helper from 'node:path';",
    "helper.posix.resolve",
  ],
  ["named import", "import {resolve as select} from 'node:path';", "select"],
] as const;

it("does not treat a constructed Node resolver as a path call", () => {
  expect(() => Reflect.construct(posix.resolve, ["/app", "decoy.cjs"])).toThrow(
    TypeError,
  );
  const analysis = analyzeCommonJsStaticFixture(`
    const helper = require('node:path');
    const {BrowserWindow} = require('electron');
    new BrowserWindow({webPreferences:{preload:new helper.resolve(runtimePath,__dirname,'decoy.cjs')}});
  `);
  expect(analysis.role_paths).toEqual([]);
  expect(analysis.electron.browser_windows).toMatchObject([
    { preload_path: null },
  ]);
});

it.each(nodeResolvers)(
  "retains proven Node %s right-to-left anchoring",
  (_name, setup, callee) => {
    expect(
      posix.resolve("/actual/runtime.cjs", "/fixture/app", "decoy.cjs"),
    ).toBe("/fixture/app/decoy.cjs");
    const expression = `${callee}(runtimePath, __dirname, "decoy.cjs")`;
    const analysis = analyzeCommonJsStaticFixture(`
    const {BrowserWindow, utilityProcess} = require('electron');
    ${setup}
    new BrowserWindow({webPreferences:{preload:${expression}}});
    utilityProcess.fork(${expression});
  `);
    expect(analysis.electron.browser_windows).toMatchObject([
      {
        preload_path: "decoy.cjs",
        preload_resolution_context: "filesystem-expression",
      },
    ]);
    expect(analysis.electron.utility_processes).toMatchObject([
      {
        module_path: "decoy.cjs",
        module_resolution_context: "filesystem-expression",
      },
    ]);
  },
);
