import { runInNewContext } from "node:vm";

import { transformSync } from "esbuild";
import { expect, it } from "vitest";

import { analyzeJavaScriptStaticSource } from "./javascriptStaticAnalysis.js";

it.each([false, true])(
  "retains generated esbuild exports with module use %s",
  (usesModule) => {
    const { code } = transformSync(
      `exports.parse = () => ${usesModule ? "module.id" : "42"};`,
      {
        format: "iife",
        globalName: "fixture",
      },
    );
    const runtime: { fixture?: Record<string, unknown> } = {};
    runInNewContext(code, runtime);
    const expected = Object.keys(runtime.fixture ?? {});
    expect(expected).toEqual(["parse"]);
    const analysis = analyzeJavaScriptStaticSource(code);
    expect(analysis.bundler_registrations).toMatchObject([
      {
        bundler: "esbuild",
        modules: [{ exports: expected, factory_require_name: null }],
      },
    ]);
  },
);

it.each(["module", "renamed"])(
  "uses the %s factory binding for every export receiver",
  (moduleName) => {
    const analysis =
      analyzeJavaScriptStaticSource(`globalThis.webpackChunkApp.push([[1], {
    17(${moduleName}, api, load) {
      ${moduleName}.exports.direct = 1;
      Object.defineProperty(${moduleName}.exports, "defined", {value: 2});
      load.d(${moduleName}.exports, {declared: () => 3});
      { const module = {exports: {}}; module.exports.ghost = 4; }
      { const load = {d() {}}; load.d(api, {fake: () => 5}); }
    }
  }]);`);
    expect(analysis.bundler_registrations[0]?.modules[0]?.exports).toEqual([
      "declared",
      "defined",
      "direct",
    ]);
  },
);

it.each([
  "const Object = {defineProperty() {}};",
  "globalThis.Object.defineProperty = () => {};",
])("requires the global property-definition intrinsic: %s", (prefix) => {
  const analysis =
    analyzeJavaScriptStaticSource(`globalThis.webpackChunkApp.push([[1], {
    17(mod, api) { ${prefix} Object.defineProperty(api, "ghost", {value: 1}); api.real = 2; }
  }]);`);
  expect(analysis.bundler_registrations[0]?.modules[0]?.exports).toEqual([
    "real",
  ]);
});

const webpackChunk = (factory: string): string =>
  `globalThis.webpackChunkApp.push([[1], {17${factory}}]);`;

/** Run the inert fixture factory under Webpack's calling convention. */
const conventionExports = (factory: string): string[] => {
  let table: Record<string, (...values: unknown[]) => void> = {};
  runInNewContext(webpackChunk(factory), {
    globalThis: {
      webpackChunkApp: {
        push: ([, modules]: [unknown, typeof table]) => {
          table = modules;
        },
      },
    },
  });
  const module = { exports: {} };
  const loader = {
    d: (target: object, getters: Record<string, () => unknown>) => {
      for (const [name, get] of Object.entries(getters))
        Object.defineProperty(target, name, { enumerable: true, get });
    },
  };
  table["17"]?.call(module.exports, module, module.exports, loader);
  return Object.getOwnPropertyNames(module.exports).sort();
};

it.each([
  "(e, t) { e.exports = {parse: value => value}; }",
  "(e, t) { e.exports.member = 1; }",
  "(e, t) { e['exports']['computed'] = 1; }",
  "(e, t, n) { Object.defineProperty(e.exports, 'defined', {value: 1}); }",
  "(e, t, n) { n.d(e.exports, {declared: () => 1}); }",
  ": (e, t) => { e.exports = {arrow: 1}; }",
  ": function (e, t) { e.exports = {expression: 1}; }",
  "(e, t) { function inner(e) { e.exports = {ghost: 1}; } e.exports.outer = 1; }",
  "(e, t) { { let e = {}; e.exports = {ghost: 1}; } }",
  "(e, t) { e = {exports: {}}; e.exports.ghost = 1; }",
  "(m, module) { module.exports = {ghost: 1}; }",
  "() {}",
  "(e = {}, t) { e.exports = {defaulted: 1}; }",
  "(e = {exports: {}}, t) { e.exports.defaultedMember = 1; }",
  "(e = {}, t) { e = {exports: {}}; e.exports.ghost = 1; }",
  "(e, t = {}) { t.defaultedExports = 1; }",
  "({exports: x}, t) { x.destructured = 1; }",
  "({exports}, t) { exports.shorthand = 1; }",
  "({exports: x = {}}, t) { x.destructuredDefault = 1; }",
  "({'exports': x}, t) { x.stringKey = 1; }",
  "({id, exports: x}, t) { x.withOther = 1; }",
  "({id}, t) { t.otherKeyOnly = 1; }",
  "({exports: x}, t) { x = {}; x.ghost = 1; }",
  "({exports: x}, t) { function inner(x) { x.ghost = 1; } x.real = 1; }",
  "({exports: x}, t, n) { n.d(x, {declared: () => 1}); Object.defineProperty(x, 'defined', {value: 2}); }",
])("binds factory roles by position for 17%s", (factory) => {
  const analysis = analyzeJavaScriptStaticSource(webpackChunk(factory));
  expect({
    exports: analysis.bundler_registrations[0]?.modules[0]?.exports,
    status: analysis.parse_status,
  }).toEqual({ exports: conventionExports(factory), status: "complete" });
});

it("ignores unordered replacements of a non-export member write", () => {
  const analysis = analyzeJavaScriptStaticSource(
    webpackChunk("(e, t) { e.id = 1; for (const k of [1]) { e = {}; } }"),
  );
  expect(analysis.bundler_registrations[0]?.modules[0]?.exports).toEqual([]);
  expect(analysis.parse_status).toBe("complete");
});

it("binds a repeated sloppy parameter name to its last argument", () => {
  const factory =
    ": function (e, t, e) { e.exports = {ghost: 1}; t.second = 1; }";
  const analysis = analyzeJavaScriptStaticSource(webpackChunk(factory));
  // Module source is strict, so the parser recovers from the name clash.
  expect(analysis.analysis_coverage?.syntax.status).toBe("recovered");
  expect(analysis.bundler_registrations[0]?.modules[0]).toMatchObject({
    exports: conventionExports(factory),
    factory_require_name: "e",
  });
});

const receiverParameters = [
  ["(e, t)", "e.exports"],
  ["(e = {}, t)", "e.exports"],
  ["(e, t = {})", "t"],
  ["({exports: x}, t)", "x"],
] as const;
const controlFlowWrites = [
  "for (const key of ['x']) { R.forOf = 1; }",
  "for (let i = 0; i < 1; i++) { R.forLoop = 1; }",
  "for (const key in {a: 1}) { R.forIn = 1; }",
  "let i = 0; while (i++ < 1) { R.whileLoop = 1; }",
  "do { R.doWhile = 1; } while (false);",
  "try { R.tryBlock = 1; } finally {}",
  "{ { R.nestedBlock = 1; } }",
  "const later = () => { R.arrowClosure = 1; }; later();",
  "function later() { R.declaredClosure = 1; } later();",
  "if ([1].length > 0) R.conditional = 1;",
];

it.each(
  receiverParameters.flatMap(([parameters, receiver]) =>
    controlFlowWrites.map((body) => [
      parameters,
      body.replaceAll("R.", `${receiver}.`),
    ]),
  ),
)("keeps the entry receiver of 17%s through %s", (parameters, body) => {
  const factory = `${parameters} { ${body} }`;
  const analysis = analyzeJavaScriptStaticSource(webpackChunk(factory));
  expect({
    exports: analysis.bundler_registrations[0]?.modules[0]?.exports,
    status: analysis.parse_status,
  }).toEqual({ exports: conventionExports(factory), status: "complete" });
});

it.each([
  "(...a) { a[0].exports.rest = 1; }",
  "(e, ...r) { r[0].restExports = 1; }",
  "({...rest}, t) { rest.exports.objectRest = 1; }",
  "({exports: {inner}}, t) { t.nested = 1; }",
  "({[k]: x}, t) { t.computedKey = 1; }",
  "([m], t) { t.arrayPattern = 1; }",
  "(e, {a}) { e.exports.exportsPattern = 1; }",
  "(e, t, n = {}) { n.d(t, {defaultedLoader: () => 1}); }",
  "(e, t, {d}) { d(t, {destructuredLoader: () => 1}); }",
  "(e, t) { for (const k of [1]) { e.exports.beforeReplace = 1; e = {exports: {}}; } }",
  "(e = {}, t) { for (const k of [1]) { e.exports.beforeReplace = 1; e = {exports: {}}; } }",
  "(e, t) { for (const k of [1]) { t.beforeReplace = 1; t = {}; } }",
  "(e, t, n) { for (const k of [1]) { n.d(t, {beforeReplace: () => 1}); n = {d() {}}; } }",
  "(e, t) { if ([1].length > 0) e = {exports: {}}; e.exports.afterConditional = 1; }",
  "(e, t) { const later = () => { e.exports.closure = 1; }; e = {exports: {}}; later(); }",
])("reports unresolved factory role or receiver 17%s as unknown", (factory) => {
  const analysis = analyzeJavaScriptStaticSource(webpackChunk(factory));
  expect(analysis.bundler_registrations[0]?.modules).toHaveLength(1);
  expect(analysis.parse_status).toBe("partial");
  expect(analysis.analysis_coverage?.semantics.unknown_findings).toBe(1);
});

/** Exports plus every loader call made under Webpack's calling convention. */
const conventionRun = (factory: string) => {
  let table: Record<string, (...values: unknown[]) => void> = {};
  runInNewContext(webpackChunk(factory), {
    globalThis: {
      webpackChunkApp: {
        push: ([, modules]: [unknown, typeof table]) => {
          table = modules;
        },
      },
    },
  });
  const loads: string[] = [];
  const chunks: string[] = [];
  const loader = Object.assign(
    (id: unknown) => {
      loads.push(String(id));
      return {};
    },
    {
      d: (target: object, getters: Record<string, () => unknown>) => {
        for (const [name, get] of Object.entries(getters))
          Object.defineProperty(target, name, { enumerable: true, get });
      },
      e: (id: unknown) => {
        chunks.push(String(id));
      },
    },
  );
  const module = { exports: {} };
  table["17"]?.call(module.exports, module, module.exports, loader);
  return {
    exports: Object.getOwnPropertyNames(module.exports).sort(),
    references: [...loads, ...chunks.map((id) => `chunk:${id}`)].sort(),
    async_chunk_keys: chunks.sort(),
  };
};

it.each([
  [
    "(e = {}, t = (() => { for (const k of ['x']) { e.exports.ghost = 1; } })()) {}",
    "complete",
  ],
  ["(e = (t.ghost = 1), t) {}", "complete"],
  [
    "(e, t = Object.defineProperty(e.exports, 'ghost', {value: 1})) {}",
    "complete",
  ],
  ["(e = n.d(t, {ghost: () => 1}), t, n) {}", "complete"],
  ["(e = n(5), t, n) { t.real = 1; }", "complete"],
  ["(e = n.e(7), t, n) { t.real = 1; }", "complete"],
  ["(e, t = (n(8), {}), n) { t.real = 1; }", "complete"],
  [
    "({exports: x} = (n.d(t, {ghost: () => 1}), {exports: {}}), t, n) { x.real = 1; }",
    "complete",
  ],
  ["({exports: x = (n(6), {ghost: 1})}, t, n) { x.real = 1; }", "complete"],
  ["(e, t, n, r = n(5)) { t.real = n.e(6); }", "complete"],
  ["(e, t, n, r = (t.later = 1)) {}", "complete"],
  ["(e, t, n = (t.ghost = 1, n(9), () => {})) { t.real = 1; }", "partial"],
  ["(e, {a} = (e.exports.ghost = 1, {})) { e.exports.real = 1; }", "partial"],
])("yields no facts from never-run defaults in 17%s", (factory, status) => {
  const analysis = analyzeJavaScriptStaticSource(webpackChunk(factory));
  const registration = analysis.bundler_registrations[0];
  expect({
    exports: registration?.modules[0]?.exports,
    references: analysis.references
      .map(({ specifier, expression }) => specifier ?? expression)
      .sort(),
    async_chunk_keys: registration?.async_chunk_keys,
    status: analysis.parse_status,
  }).toEqual({ ...conventionRun(factory), status });
});
