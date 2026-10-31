import { expect, it } from "vitest";

import { JavaScriptModuleRangeIndex } from "./javascriptStaticAnalysisFindings.js";
import { analyzeJavaScriptStaticSource } from "./javascriptStaticAnalysis.js";

it.each(["direct", "call"])(
  "recovers standalone module factories dispatched with %s",
  (style) => {
    const dispatch =
      style === "call"
        ? "modules[id].call(module.exports, module, module.exports, load)"
        : "modules[id](module, module.exports, load)";
    const source = `(() => {
    const modules = {
      17(module, exports, req) { exports.read = req(23); },
      23(module) { module.exports = require("electron"); }
    };
    const cache = {};
    function load(id) {
      if (cache[id]) return cache[id].exports;
      const module = cache[id] = { exports: {} };
      ${dispatch};
      return module.exports;
    }
    load(17);
  })();`;
    const analysis = analyzeJavaScriptStaticSource(source);
    expect(analysis.bundler_registrations).toMatchObject([
      {
        bundler: "webpack",
        entry_module_keys: ["17"],
        modules: [{ module_key: "17" }, { module_key: "23" }],
      },
    ]);
    expect(analysis.references).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ specifier: "23", module_key: "17" }),
        expect.objectContaining({ specifier: "electron", module_key: "23" }),
      ]),
    );
  },
);

it("does not infer a bootstrap from a function table without a matching loader", () => {
  const analysis = analyzeJavaScriptStaticSource(`(() => {
    const handlers = { 17(module) { module.exports = require("electron"); } };
    function load(id) { return handlers[id](userInput); }
    load(17);
  })();`);
  expect(analysis.bundler_registrations).toEqual([]);
});

it("does not treat a same-named shadow as the factory exports parameter", () => {
  const analysis =
    analyzeJavaScriptStaticSource(`globalThis.webpackChunkApp.push([[1], {
    first(module, e, require) {
      { const e = {}; require.d(e, { shadowed: () => 1 }); e.other = 2; }
    }
  }]);`);
  expect(analysis.bundler_registrations[0]?.modules).toMatchObject([
    { module_key: "first", exports: [] },
  ]);
});

it("does not resolve a parameter named require as a module dependency", () => {
  const analysis = analyzeJavaScriptStaticSource(
    `function run(require) { return require("./ghost.cjs"); }`,
  );
  expect(analysis.references).not.toContainEqual(
    expect.objectContaining({ specifier: "./ghost.cjs" }),
  );
  expect(analysis.references).toContainEqual(
    expect.objectContaining({
      kind: "require",
      specifier: null,
      expression: 'require("./ghost.cjs")',
    }),
  );
});

it("keeps a top-level wrapper require redeclaration", () => {
  const analysis = analyzeJavaScriptStaticSource(
    `var require; require("./wrapper.cjs");`,
  );
  expect(analysis.references).toContainEqual(
    expect.objectContaining({ specifier: "./wrapper.cjs" }),
  );
});

it("retains the wrapper dependency evaluated inside its replacing assignment", () => {
  const analysis = analyzeJavaScriptStaticSource(
    `var require; require = require("./before-replacement.cjs");`,
  );
  expect(analysis.references).toContainEqual(
    expect.objectContaining({ specifier: "./before-replacement.cjs" }),
  );
});

it.each([
  [
    "a deferred function assignment",
    `var require; function load() { require = require("./maybe.cjs"); } load(); load();`,
  ],
  [
    "an assignment repeated by a loop",
    `var require; while (condition) { require = require("./maybe.cjs"); }`,
  ],
])("keeps %s unknown", (_label, source) => {
  const analysis = analyzeJavaScriptStaticSource(source);
  expect(analysis.references).not.toContainEqual(
    expect.objectContaining({ specifier: "./maybe.cjs" }),
  );
  expect(analysis.references).toContainEqual(
    expect.objectContaining({ kind: "require", specifier: null }),
  );
});

it.each([
  [
    "a skipped wrapper write",
    `var require; if (false) require = localLoader; require("./ghost.cjs");`,
    "./ghost.cjs",
  ],
  [
    "a skipped createRequire write",
    `import { createRequire } from "node:module"; let require = () => "local"; if (false) require = createRequire(import.meta.url); require("./ghost.cjs");`,
    "./ghost.cjs",
  ],
  [
    "a class static field write before its computed key in source order",
    `var require; class C { static value = (require = () => "local"); [require("./computed-key.cjs")]() {} }`,
    "./computed-key.cjs",
  ],
  [
    "a loop condition write before a later call",
    `var require; while ((require = () => "local", false)) {} require("./after-loop.cjs");`,
    "./after-loop.cjs",
  ],
])("preserves uncertainty for %s", (_label, source, specifier) => {
  const analysis = analyzeJavaScriptStaticSource(source);
  expect(analysis.references).not.toContainEqual(
    expect.objectContaining({ specifier }),
  );
  expect(analysis.references).toContainEqual(
    expect.objectContaining({ kind: "require", specifier: null }),
  );
});

it("keeps a proven createRequire binding", () => {
  const analysis = analyzeJavaScriptStaticSource(`
    import { createRequire as makeRequire } from "node:module";
    const require = makeRequire(import.meta.url);
    require("./created.cjs");
  `);
  expect(analysis.references).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ specifier: "./created.cjs" }),
    ]),
  );
});

it("recognizes only factory loader calls and supported bind references", () => {
  const analysis = analyzeJavaScriptStaticSource(`
    globalThis.webpackChunkApp.push([[1], {
      "factory": function (module, exports, loader) {
        loader.resolve("./not-a-dependency.cjs");
        loader("./dependency.cjs");
        loader.bind(module, "./bound-dependency.cjs");
      }
    }]);
  `);
  expect(analysis.references.map(({ specifier }) => specifier)).toEqual(
    expect.arrayContaining(["./dependency.cjs", "./bound-dependency.cjs"]),
  );
  expect(analysis.references).not.toContainEqual(
    expect.objectContaining({ specifier: "./not-a-dependency.cjs" }),
  );
});

it("keeps reassigned factory loaders unknown instead of resolving imports", () => {
  const analysis = analyzeJavaScriptStaticSource(`
    globalThis.webpackChunkApp.push([[1], {
      "factory": function (module, exports, loader) {
        loader = userInput;
        loader("./uncertain.cjs");
      }
    }]);
  `);
  expect(analysis.references).not.toContainEqual(
    expect.objectContaining({ specifier: "./uncertain.cjs" }),
  );
  expect(analysis.references).toContainEqual(
    expect.objectContaining({ kind: "require", specifier: null }),
  );
});

it("keeps a reassigned function named require unknown", () => {
  const analysis = analyzeJavaScriptStaticSource(`
    function require() { return userInput; }
    require = replacement;
    require("./uncertain.cjs");
  `);
  expect(analysis.references).not.toContainEqual(
    expect.objectContaining({ specifier: "./uncertain.cjs" }),
  );
  expect(analysis.references).toContainEqual(
    expect.objectContaining({ kind: "require", specifier: null }),
  );
});

it("does not treat a shadowed webpack loader name as bundler ownership", () => {
  const analysis = analyzeJavaScriptStaticSource(`
    function local(__webpack_require__) {
      __webpack_require__("./ghost.cjs");
      __webpack_require__.e("ghost-chunk");
    }
  `);
  expect(analysis.references).not.toContainEqual(
    expect.objectContaining({ specifier: "./ghost.cjs" }),
  );
  expect(analysis.references).not.toContainEqual(
    expect.objectContaining({ specifier: "chunk:ghost-chunk" }),
  );
});

it("uses recovered factory and runtime loader identities for webpack imports and chunks", () => {
  const analysis = analyzeJavaScriptStaticSource(`
    globalThis.webpackChunkApp.push([[1], {
      "factory": function (module, exports, __webpack_require__) {
        __webpack_require__("./factory-dependency.cjs");
        __webpack_require__.e("factory-chunk");
      }
    }, function (__webpack_require__) {
      __webpack_require__("factory");
      __webpack_require__.e("runtime-chunk");
    }]);
  `);
  expect(analysis.references.map(({ specifier }) => specifier)).toEqual(
    expect.arrayContaining([
      "./factory-dependency.cjs",
      "chunk:factory-chunk",
      "chunk:runtime-chunk",
    ]),
  );
  expect(analysis.bundler_registrations[0]?.async_chunk_keys).toEqual(
    expect.arrayContaining(["factory-chunk", "runtime-chunk"]),
  );
});

it("does not attribute a shadowed factory loader parameter to async chunks", () => {
  const analysis = analyzeJavaScriptStaticSource(`
    globalThis.webpackChunkApp.push([[1], {
      "factory": function (module, exports, loader) {
        function local(__webpack_require__) {
          __webpack_require__.e("ghost-chunk");
        }
        loader.e("real-chunk");
      }
    }]);
  `);
  expect(analysis.bundler_registrations[0]?.async_chunk_keys).toEqual([
    "real-chunk",
  ]);
  expect(analysis.references).not.toContainEqual(
    expect.objectContaining({ specifier: "chunk:ghost-chunk" }),
  );
});

it("does not confuse a shadowed dispatch table with the outer module table", () => {
  const analysis = analyzeJavaScriptStaticSource(`(() => {
    const modules = { 17(module) { module.exports = require("electron"); } };
    function load(id) {
      const modules = userInput;
      const module = { exports: {} };
      modules[id](module, module.exports, load);
      return module.exports;
    }
    load(17);
  })();`);
  expect(analysis.bundler_registrations).toEqual([]);
});

it("retains a stable var module table without treating declaration mutability as a write", () => {
  const analysis = analyzeJavaScriptStaticSource(`(() => {
    var modules = { 17(module) { module.exports = require("electron"); } };
    function load(id) {
      const module = { exports: {} };
      modules[id](module, module.exports, load);
      return module.exports;
    }
    load(17);
  })();`);
  expect(analysis.bundler_registrations).toMatchObject([
    { entry_module_keys: ["17"], modules: [{ module_key: "17" }] },
  ]);
});

it("only attributes bootstrap entries to the recovered loader binding", () => {
  const analysis = analyzeJavaScriptStaticSource(`(() => {
    const modules = { 17(module) { module.exports = require("electron"); } };
    function load(id) {
      const module = { exports: {} };
      modules[id](module, module.exports, load);
      return module.exports;
    }
    { const load = userInput; load(99); }
    load(17);
  })();`);
  expect(analysis.bundler_registrations).toMatchObject([
    { entry_module_keys: ["17"] },
  ]);
});

it("preserves first insertion precedence and inclusive interval bounds", () => {
  const nested = new JavaScriptModuleRangeIndex(100);
  expect(nested.find(0)).toBeUndefined();
  nested.add({
    start: 10,
    end: 90,
    key: "outer-first",
    runtime: "webpackChunkApp",
    requireName: null,
  });
  nested.add({
    start: 20,
    end: 30,
    key: "inner-second",
    runtime: "webpackChunkApp",
    requireName: null,
  });
  nested.add({
    start: 30,
    end: 40,
    key: "later-overlap",
    runtime: "webpackChunkApp",
    requireName: null,
  });
  expect(nested.find(9)).toBeUndefined();
  expect(nested.find(10)?.key).toBe("outer-first");
  expect(nested.find(20)?.key).toBe("outer-first");
  expect(nested.find(30)?.key).toBe("outer-first");
  expect(nested.find(90)?.key).toBe("outer-first");
  expect(nested.find(91)).toBeUndefined();
  expect(nested.find(100)).toBeUndefined();
});

it("rejects missing and out-of-range lookup offsets", () => {
  const index = new JavaScriptModuleRangeIndex(20);
  index.add({
    start: 5,
    end: 10,
    key: "bounded",
    runtime: "webpackChunkApp",
    requireName: null,
  });
  expect(index.find(undefined)).toBeUndefined();
  expect(index.find(null)).toBeUndefined();
  expect(index.find(-1)).toBeUndefined();
  expect(index.find(0)).toBeUndefined();
  expect(index.find(11)).toBeUndefined();
  expect(index.find(20)).toBeUndefined();
  expect(index.find(Number.NaN)).toBeUndefined();
  expect(index.find(5)?.key).toBe("bounded");
  expect(index.find(10)?.key).toBe("bounded");
});

it("keeps module references attributed across many real factory ranges", () => {
  const count = 200;
  const factories = Array.from({ length: count }, (_, index) =>
    index === 0
      ? '"module-0": function(module, exports, req) { globalThis.webpackChunkInner.push([[2], { "inner": function(innerModule, innerExports, req) { req("nested-dependency"); } }]); req("dependency-0"); }'
      : `"module-${index}": function(module, exports, req) { req("dependency-${index}"); }`,
  ).join(",\n");
  const analysis = analyzeJavaScriptStaticSource(
    `require("outside");\nglobalThis.webpackChunkApp.push([[1], {\n${factories}\n}]);`,
  );
  expect(analysis.references).toHaveLength(count + 2);
  expect(
    analysis.bundler_registrations.some(
      ({ runtime, modules }) =>
        runtime === "webpackChunkInner" &&
        modules.some(({ module_key }) => module_key === "inner"),
    ),
  ).toBe(true);
  expect(
    analysis.references.find(({ specifier }) => specifier === "outside")
      ?.module_key,
  ).toBeNull();
  for (let index = 0; index < count; index += 1) {
    expect(
      analysis.references.find(
        ({ specifier }) => specifier === `dependency-${index}`,
      ),
    ).toMatchObject({
      module_key: `module-${index}`,
      module_runtime: "webpackChunkApp",
    });
  }
  expect(
    analysis.references.find(
      ({ specifier }) => specifier === "nested-dependency",
    )?.module_key,
  ).toBe("module-0");
});

it("retains the chunk runtime through a TypeScript-only expression wrapper", () => {
  const analysis = analyzeJavaScriptStaticSource(
    '(globalThis.webpackChunkApp satisfies unknown).push([[1], { "entry": function () {} }]);',
  );
  expect(analysis.bundler_registrations).toEqual([
    expect.objectContaining({
      runtime: "webpackChunkApp",
      modules: [expect.objectContaining({ module_key: "entry" })],
    }),
  ]);
});
