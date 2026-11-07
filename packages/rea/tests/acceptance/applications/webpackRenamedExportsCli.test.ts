import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";
import { analyzeJavaScriptDirectory } from "../../support/cli/javascriptApplication.js";

cliTest.for(["CLI", "stdio MCP"] as const)(
  "reports Webpack exports attached to original renamed factory parameter values through %s",
  async (surface, { cli }) => {
    const root = await createTestTempDirectory("rea-webpack-renamed-exports-");
    await mkdir(join(root, "src"));
    await writeFile(
      join(root, "src", "chunk.js"),
      `globalThis.webpackChunkApp.push([[1], {
      17(module, __webpack_exports__, __webpack_require__) {
        __webpack_require__.d(__webpack_exports__, { alpha: () => 1, "beta.gamma": () => 2 });
        Object.defineProperty(__webpack_exports__, "delta", { enumerable: true, get() { return 3; } });
        __webpack_require__.d(__webpack_exports__.nested, { nested_target: () => 0 });
        __webpack_exports__ = { rebound: () => 0 };
        __webpack_exports__.ghost = 4;
        Object.defineProperty(__webpack_exports__, "definedGhost", {value: 5});
        __webpack_require__.d(__webpack_exports__, { declaredGhost: () => 6 });
        module.exports.moduleBefore = 7;
        module = {exports: {}};
        module.exports.moduleGhost = 8;
        __webpack_require__.d({}, { unrelated: () => 0 });
        { const exports = {}; __webpack_require__.d(exports, { shadowed_exports: () => 5 }); }
      },
      23(m, e, r) {
        r.d(e, { alpha: () => 1 });
        r = {d() {}};
        r.d(e, { loaderGhost: () => 2 });
        e.afterLoaderReplacement = 3;
      },
      31(mod, api, load) {
        load.d(api, { beforeMethodReplacement: () => 1 });
        load.other = () => {};
        load.d(api, { afterUnrelatedWrite: () => 2 });
        load.d = () => {};
        load.d(api, { methodGhost: () => 3 });
        api.afterMethodReplacement = 4;
      },
      37(mod, api, load) {
        load.d(api, { beforeAliasedReplacement: () => 1 });
        const alias = load;
        alias.d = () => {};
        load.d(api, { aliasedMethodGhost: () => 2 });
        api.afterAliasedReplacement = 3;
      }
      }]);`,
    );
    const result = await analyzeJavaScriptDirectory(surface, cli, root);
    const modules = result.graph.nodes
      .filter(({ kind }) => kind === "javascript-module")
      .map(({ observations }) => observations[0]?.properties);
    expect(modules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          module_key: "17",
          exports: ["alpha", "beta.gamma", "delta", "moduleBefore"],
        }),
        expect.objectContaining({
          module_key: "23",
          exports: ["afterLoaderReplacement", "alpha"],
        }),
        expect.objectContaining({
          module_key: "31",
          exports: [
            "afterMethodReplacement",
            "afterUnrelatedWrite",
            "beforeMethodReplacement",
          ],
        }),
        expect.objectContaining({
          module_key: "37",
          exports: ["afterAliasedReplacement", "beforeAliasedReplacement"],
        }),
      ]),
    );
    expect(result.graph.coverage.status).toBe("complete");
  },
);

cliTest.for(["CLI", "stdio MCP"] as const)(
  "reports Webpack exports through defaulted and destructured factory parameters through %s",
  async (surface, { cli }) => {
    const root = await createTestTempDirectory("rea-webpack-pattern-exports-");
    await mkdir(join(root, "src"));
    await writeFile(
      join(root, "src", "exact.js"),
      `globalThis.webpackChunkApp.push([[1], {
      111(e = {}, t) { e.exports = {defaulted: 1}; },
      112({exports: x}, t) { x.destructured = 1; },
      114(e = {}, t) { for (const key of ["x"]) { e.exports.loop = 1; } }
      }]);`,
    );
    await writeFile(
      join(root, "src", "rest.js"),
      `globalThis.webpackChunkApp.push([[2], {
      113(...a) { a[0].exports.rest = 1; }
      }]);`,
    );
    const result = await analyzeJavaScriptDirectory(surface, cli, root);
    const modules = Object.fromEntries(
      result.graph.nodes
        .filter(({ kind }) => kind === "javascript-module")
        .flatMap(({ observations: [observation] }) =>
          typeof observation?.properties.module_key === "string"
            ? [
                [
                  observation.properties.module_key,
                  {
                    exports: observation.properties.exports,
                    coverage: observation.evidence.coverage.status,
                  },
                ],
              ]
            : [],
        ),
    );
    expect(modules).toEqual({
      "111": { exports: ["defaulted"], coverage: "complete" },
      "112": { exports: ["destructured"], coverage: "complete" },
      "113": { exports: [], coverage: "partial" },
      "114": { exports: ["loop"], coverage: "complete" },
    });
    expect(result.graph.coverage.status).toBe("partial");
  },
);
