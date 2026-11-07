import { expect } from "vitest";

import { parseEvidence } from "../../../src/domain/evidence.js";
import { javascriptApplicationAnalysisResultSchema } from "../../../src/domain/javascript/javascriptApplicationAnalysis.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";
import { writeFixtureFiles } from "../../support/javascriptApplicationFixture.js";

const CACHE_HIT = `
    var cached = cache[key];
    if (cached !== undefined) return cached.exports;`;

const loaderSource = (cacheHit: string, missReturn: string) => `(function () {
  var modules = {
    45840: function (module) { module.exports = require("electron"); },
    1: function (module, exports, n) { new (n(45840).BrowserWindow)({}); }
  }, cache = {};
  function n(key) {${cacheHit}
    var module = (cache[key] = { exports: {} });
    modules[key](module, module.exports, n);${missReturn}
  }
  n(1);
})();`;

cliTest.for([
  [
    "the canonical loader",
    loaderSource(CACHE_HIT, "\n    return module.exports;"),
    1,
  ],
  ["a loader that returns only cached exports", loaderSource(CACHE_HIT, ""), 0],
  ["a loader without returns", loaderSource("", ""), 0],
] as const)(
  "attributes the BrowserWindow to Electron only through %s",
  async ([, source, windows], { cli }) => {
    const root = await createTestTempDirectory("rea-webpack-loader-returns-");
    await writeFixtureFiles(root, {
      "main.js": source,
      "package.json": JSON.stringify({ name: "fixture", main: "main.js" }),
    });
    const response = await cli.run({
      arguments: ["analyze-javascript-application", root, "--format", "json"],
      environment: { REA_LOG_LEVEL: "silent" },
    });
    expect(response.exitCode).toBe(0);
    const result = javascriptApplicationAnalysisResultSchema.parse(
      parseEvidence(response.json).normalized_result,
    );
    expect(result.summary.browser_windows).toBe(windows);
    // The literal external stays observed even when the loader is unproven.
    expect(
      result.graph.nodes.flatMap(({ observations }) =>
        observations.map(({ properties }) => properties),
      ),
    ).toContainEqual(
      expect.objectContaining({
        reference_kind: "require",
        specifier: "electron",
      }),
    );
  },
);
