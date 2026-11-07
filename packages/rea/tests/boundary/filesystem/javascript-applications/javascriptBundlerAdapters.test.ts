import { describe, expect, it } from "vitest";

import { createTestTempDirectory } from "../../../fixtures/temporaryDirectory.js";

import {
  findChunkNode,
  findGraphEdge,
  findModuleNodeByKey,
  reconstructJavaScriptFixture,
  writeFixtureFiles,
} from "../../../support/javascriptApplicationFixture.js";

describe("Webpack and Rspack runtime adapters", () => {
  it("recovers runtime entry modules, async chunks, and factory require aliases", async () => {
    const root = await bundlerFixture();
    const result = await reconstructJavaScriptFixture(root);
    const graph = result.graph;

    const webpackEntry = findChunkNode(
      graph,
      "webpackChunkcustomPortal",
      "main",
    );
    const webpackLazy = findChunkNode(
      graph,
      "webpackChunkcustomPortal",
      "lazy",
    );
    const webpackModule = findModuleNodeByKey(graph, "10");
    const rspackEntry = findChunkNode(
      graph,
      "rspackChunkcustomPortal",
      "editor",
    );
    const rspackModel = findChunkNode(
      graph,
      "rspackChunkcustomPortal",
      "model",
    );
    const rspackModule = findModuleNodeByKey(graph, "src/entry.ts");

    expect(webpackEntry?.observations[0]?.properties).toMatchObject({
      bundler: "webpack",
      runtime_require_name: "__webpack_require__",
      runtime_module_cache_status: "not-observed",
      entry_module_keys: ["10"],
      async_chunk_keys: ["lazy", "missing"],
      unknown_async_chunk_keys: 1,
    });
    expect(webpackModule?.observations[0]?.properties).toMatchObject({
      factory_require_name: "__webpack_require__",
      runtime_entry: true,
      chunk_keys: ["main"],
    });
    expect(rspackEntry?.observations[0]?.properties).toMatchObject({
      bundler: "rspack",
      runtime_require_name: "r",
      runtime_module_cache_status: "not-observed",
      entry_module_keys: ["src/entry.ts"],
      async_chunk_keys: ["model"],
    });
    expect(rspackModule?.observations[0]?.properties).toMatchObject({
      factory_require_name: "r",
      runtime_entry: true,
    });

    expect(
      findGraphEdge(graph, webpackEntry, webpackModule, "loads"),
    ).toMatchObject({
      properties: expect.objectContaining({
        kind: "bundler-entry-module",
        resolution_status: "resolved",
      }),
    });
    expect(
      findGraphEdge(graph, webpackEntry, webpackLazy, "imports"),
    ).toMatchObject({
      properties: expect.objectContaining({
        kind: "bundler-async-chunk",
        resolution_status: "resolved",
      }),
    });
    expect(
      findGraphEdge(graph, webpackModule, webpackLazy, "imports"),
    ).toMatchObject({
      properties: expect.objectContaining({
        kind: "dynamic-import",
        specifier: "chunk:lazy",
        resolved_path: "renderer/chunks/runtime.js#chunk:lazy",
      }),
    });
    expect(
      findGraphEdge(graph, rspackEntry, rspackModel, "imports"),
    ).toMatchObject({
      properties: expect.objectContaining({
        kind: "bundler-async-chunk",
        resolution_status: "resolved",
      }),
    });
    expect(
      findGraphEdge(graph, rspackModule, rspackModel, "imports"),
    ).toMatchObject({
      properties: expect.objectContaining({
        kind: "dynamic-import",
        specifier: "chunk:model",
      }),
    });

    expect(
      graph.nodes.find((node) =>
        node.observations.some(
          ({ properties }) =>
            properties.semantic_role === "bundler-chunk-reference" &&
            properties.chunk_key === "missing" &&
            properties.resolution_status === "not-found",
        ),
      ),
    ).toBeDefined();
    expect(
      graph.edges.some(
        ({ relation, properties }) =>
          relation === "imports" &&
          properties.kind === "require" &&
          properties.specifier === "lazy",
      ),
    ).toBe(false);
  });

  it("recovers esbuild wrapper modules and Vite preload dependencies", async () => {
    const root = await esmRuntimeFixture();
    const { graph } = await reconstructJavaScriptFixture(root);
    const commonJsModule = findModuleNodeByKey(graph, "src/dep.js");
    const esmModule = findModuleNodeByKey(graph, "src/core.js");

    expect(commonJsModule?.observations[0]?.properties).toMatchObject({
      bundler: "esbuild",
      runtime: "esbuild-commonjs",
      module_key: "src/dep.js",
    });
    expect(esmModule?.observations[0]?.properties).toMatchObject({
      bundler: "esbuild",
      runtime: "esbuild-esm",
      module_key: "src/core.js",
    });
    expect(
      graph.edges.filter(
        ({ relation, properties }) =>
          relation === "imports" &&
          properties.kind === "dynamic-import" &&
          ["./feature.js", "./main.css"].includes(String(properties.specifier)),
      ),
    ).toHaveLength(2);
  });
});

const bundlerFixture = async (): Promise<string> => {
  const root = await createTestTempDirectory("rea-bundler-adapters-");
  await writeFixtureFiles(root, {
    "renderer/chunks/runtime.js": `
      // A cache-like name here is not evidence about either registration.
      const documentation = "__webpack_module_cache__";
      (globalThis["webpackChunkcustomPortal"] = globalThis["webpackChunkcustomPortal"] || []).push([
        ["main"],
        {
          10: (module, exports, __webpack_require__) => {
            const direct = __webpack_require__(11);
            const lazy = __webpack_require__.e("lazy").then(
              __webpack_require__.bind(__webpack_require__, 20)
            );
            const missing = __webpack_require__.e("missing");
            const dynamicChunk = window.name;
            __webpack_require__.e(dynamicChunk);
            exports.start = () => [direct, lazy, missing];
          },
          11: (module) => { module.exports = "direct"; }
        },
        (__webpack_require__) => {
          __webpack_require__.O(0, ["main"], () => __webpack_require__(10));
        }
      ]);
      (globalThis["webpackChunkcustomPortal"] = globalThis["webpackChunkcustomPortal"] || []).push([
        ["lazy"],
        {
          20: (module) => {
            // A marker in a different registration must not be inherited.
            const documentation = "installedModules";
            module.exports = "lazy";
          }
        }
      ]);
      (self.rspackChunkcustomPortal = self.rspackChunkcustomPortal || []).push([
        ["editor"],
        {
          "src/entry.ts": (module, exports, r) => {
            r.e("model").then(r.bind(r, "src/model.ts"));
            exports.render = () => r("src/model.ts");
          }
        },
        (r) => { r("src/entry.ts"); }
      ]);
      (self.rspackChunkcustomPortal = self.rspackChunkcustomPortal || []).push([
        ["model"],
        {
          "src/model.ts": (module) => { module.exports = "model"; }
        }
      ]);
    `,
  });
  return root;
};

const esmRuntimeFixture = async (): Promise<string> => {
  const root = await createTestTempDirectory("rea-esm-runtime-adapters-");
  await writeFixtureFiles(root, {
    "main.js": `
      const __vite__mapDeps = (indexes, map = __vite__mapDeps, dependencies =
        (map.f || (map.f = ["./feature.js", "./main.css"]))) =>
        indexes.map((index) => dependencies[index]);
      const require_dep = __commonJS({
        "src/dep.js"(exports, module) {
          module.exports = { value: 1 };
        }
      });
      const init_core = __esm({
        "src/core.js"() {
          require_dep();
        }
      });
      __vite__mapDeps([0, 1]);
      init_core();
    `,
    "feature.js": "export const feature = true;",
    "main.css": ".app { color: green; }",
  });
  return root;
};
