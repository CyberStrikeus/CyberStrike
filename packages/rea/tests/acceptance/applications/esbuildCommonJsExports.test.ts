import { expect } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";
import {
  analyzeJavaScriptDirectory,
  runNodeJsonControl,
} from "../../support/cli/javascriptApplication.js";
import { writeFixtureFiles } from "../../support/javascriptApplicationFixture.js";

const esbuildBundle = `(() => {
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __commonJS = (cb, mod) => () => {
    if (!mod) {
      mod = { exports: {} };
      cb[__getOwnPropNames(cb)[0]](mod.exports, mod);
    }
    return mod.exports;
  };
  var require_dep = __commonJS({
    "dep.cjs"(exports, module) {
      exports.parse = function parse() { return module.id; };
    }
  });
  console.log(JSON.stringify(Object.keys(require_dep())));
})();`;

cliTest.for(["CLI", "stdio MCP"] as const)(
  "retains exports from esbuild CommonJS factories that also accept module through %s",
  async (surface, { cli }) => {
    const root = await createTestTempDirectory("rea-esbuild-commonjs-exports-");
    await writeFixtureFiles(root, { "bundle.js": esbuildBundle });

    expect(await runNodeJsonControl(root, "bundle.js")).toEqual(["parse"]);
    const { graph } = await analyzeJavaScriptDirectory(surface, cli, root);
    const module = graph.nodes.find(
      ({ kind, observations }) =>
        kind === "javascript-module" &&
        observations[0]?.properties.module_key === "dep.cjs" &&
        observations[0]?.properties.bundler === "esbuild",
    );
    expect(module?.observations[0]?.properties.exports).toEqual(["parse"]);
    expect(graph.coverage.status).toBe("complete");
  },
);
