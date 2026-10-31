import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect } from "vitest";
import { z } from "zod";

import { javascriptApplicationAnalysisResultSchema } from "../../../src/domain/javascript/javascriptApplicationAnalysis.js";
import { ROLLDOWN_MODULE_INTEROP } from "../../../src/domain/javascript/javascriptModuleInterop.fixture.js";
import { connectLocalToolsMcp } from "../../fixtures/localToolsMcp.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

const INTRINSIC_MUTATIONS = [
  ["poisoned.cjs", "({Object} = replacements);"],
  [
    "projected.cjs",
    'const {defineProperty:change} = Object; change(Object,"create",{value:customCreate});',
  ],
  [
    "decorated.cjs",
    '@(() => Object) class metadata {}; Object.defineProperty(metadata,"create",{value:customCreate});',
  ],
  [
    "uncurried.cjs",
    'const change = Function.prototype.call.bind(Object.defineProperty,null); change(Object,"create",{value:customCreate});',
  ],
  [
    "generic-bind.cjs",
    'const change = Function.prototype.bind.call(Object.defineProperty,null); change(Object,"create",{value:customCreate});',
  ],
  [
    "replaced-apply.cjs",
    'Reflect.apply = Object.defineProperty; Reflect.apply(Object,"create",{value:customCreate});',
  ],
  [
    "bound.cjs",
    'const change = Object.defineProperty.bind(null,Object,"create"); change({value:customCreate});',
  ],
  ["receiver.cjs", 'Reflect.set({},"create",customCreate,Object);'],
  [
    "deep-call.cjs",
    'Function.prototype.call.call.call(Object.defineProperty,null,Object,"create",{value:customCreate});',
  ],
  [
    "deep-apply.cjs",
    'Function.prototype.apply.apply(Object.defineProperty,[null,[Object,"create",{value:customCreate}]]);',
  ],
] as const;

const writePoisonedModules = async (root: string): Promise<void> => {
  for (const [name, mutation] of INTRINSIC_MUTATIONS)
    await writeFile(
      join(root, name),
      `${mutation}
       ${ROLLDOWN_MODULE_INTEROP}
       let poisoned = require("electron");
       poisoned = __toESM(poisoned, 1);
       new poisoned.BrowserWindow({});
       throw new Error("must not execute poisoned source");`,
    );
};

cliTest.for(["CLI", "stdio MCP"] as const)(
  "retains converted Electron windows and preload evidence through %s",
  async (surface, { cli }) => {
    const root = await createTestTempDirectory("rea-electron-interop-");
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({ main: "main.cjs" }),
    );
    await writeFile(
      join(root, "preload.js"),
      'throw new Error("must stay inert");',
    );
    await writePoisonedModules(root);
    const source = `const metadata = {};
      Object.defineProperty(metadata,"x",{value:1});
      const decorateMetadata = Object.defineProperty.bind(null,metadata,"bound");
      decorateMetadata({value:1});
      const decorateViaCall = Function.prototype.call.bind(Object.defineProperty);
      decorateViaCall(null,metadata,"uncurried",{value:1});
      const localFunction = () => {};
      Object.defineProperty(localFunction,"x",{value:1});
      const localClass = class {};
      Object.defineProperty(localClass,"x",{value:1});
      const localRegExp = /local/;
      Object.defineProperty(localRegExp,"x",{value:1});
      Object.defineProperty(hoistedFunction,"x",{value:1});
      function hoistedFunction() {}
      const captured = Object.defineProperty;
      Object.defineProperty = custom;
      ${ROLLDOWN_MODULE_INTEROP.replace("__defProp = Object.defineProperty", "__defProp = captured")}
      let electron = require("electron");
      electron = __toESM(electron, 1);
      new electron.BrowserWindow({webPreferences:{preload:"./preload.js"}});
      new electron.BrowserWindow({webPreferences:{preload:runtimePath}});
      var direct;
      var direct = require("electron");
      var direct;
      new direct.BrowserWindow({});
      const fresh = __toESM(require("electron"), 1);
      new fresh.BrowserWindow({});
      const {BrowserWindow: ProjectedWindow} = __toESM(require("electron"));
      new ProjectedWindow({});
      const nonNode = __toESM(require("electron"), 0);
      new nonNode.BrowserWindow({});
      function identity(mod) {return mod;}
      const passthrough = identity(require("electron"));
      new passthrough.BrowserWindow({});
      const __importStar = () => ({BrowserWindow:FakeWindow});
      const fake = __importStar(require("electron"));
      new fake.BrowserWindow({});
      function decoy(electron) {new electron.BrowserWindow({});}
      require("./poisoned.cjs");
      require("./projected.cjs");
      require("./decorated.cjs");
      require("./bound.cjs");
      require("./uncurried.cjs");
      require("./generic-bind.cjs");
      require("./replaced-apply.cjs");
      require("./receiver.cjs");
      require("./deep-call.cjs");
      require("./deep-apply.cjs");
      throw new Error("must not execute main");
    `;
    await writeFile(join(root, "main.cjs"), source);
    let document: unknown;
    if (surface === "CLI") {
      const response = await cli.run({
        arguments: ["analyze-javascript-application", root, "--json"],
      });
      expect(response.exitCode, response.stderr).toBe(0);
      document = response.json;
    } else {
      const { call } = await connectLocalToolsMcp();
      const response = await call("analyze_javascript_application", {
        input_path: root,
      });
      expect(response.isError, JSON.stringify(response)).not.toBe(true);
      document = response.structuredContent;
    }
    const result = z
      .object({ normalized_result: javascriptApplicationAnalysisResultSchema })
      .parse(document).normalized_result;
    expect(result.summary).toMatchObject({
      browser_windows: 7,
      preload_entrypoints: 1,
    });
    expect(result.statistics.parse_failures).toBe(0);
    expect(result.statistics.parsed_javascript_files).toBe(12);
    const windows = result.graph.nodes.filter(
      ({ kind }) => kind === "browser-window",
    );
    expect(windows).toHaveLength(7);
    const expectedLines = source
      .split("\n")
      .flatMap((line, index) =>
        /^\s*new (?:(?:electron|direct|fresh|passthrough|nonNode)\.BrowserWindow|ProjectedWindow)\(/u.test(
          line,
        )
          ? [index + 1]
          : [],
      );
    const observedLines = windows.flatMap((window) => {
      const location = window.observations[0]?.evidence.location;
      return location?.available && location.value.kind === "source-range"
        ? [location.value.start.line]
        : [];
    });
    expect(observedLines.toSorted()).toEqual(expectedLines.toSorted());
    for (const window of windows) {
      expect(window.observations[0]?.evidence.location).toMatchObject({
        available: true,
        value: { kind: "source-range", source: "main.cjs" },
      });
    }
    expect(
      windows.flatMap((window) =>
        window.observations.map(({ properties }) => properties.web_preferences),
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.arrayContaining([
          expect.objectContaining({
            name: "preload",
            value: {
              status: "dynamic",
              value: null,
              expression: "runtimePath",
            },
          }),
        ]),
      ]),
    );
  },
);
