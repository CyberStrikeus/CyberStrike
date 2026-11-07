import { expect, it } from "vitest";

import { parseReferenceSourceImports } from "../referenceSourceImportParsing.js";

import { analyzeParsedJavaScriptStaticSource } from "./javascriptStaticAnalysis.js";
import { parseRecoveredJavaScript } from "./javascriptSourceParser.js";

const analyze = (source: string, path = "main.cjs") => {
  const { file } = parseRecoveredJavaScript(source, path, {});
  return analyzeParsedJavaScriptStaticSource(source, file);
};

it("retains the CommonJS loader returned by an immediate arrow", () => {
  const result = analyze(`const load = (() => require)(); load('./dep.cjs');`);
  expect(result.parse_error_count).toBe(0);
  expect(result.references).toEqual([
    expect.objectContaining({ kind: "require", specifier: "./dep.cjs" }),
  ]);
});

it("retains a candidate for the canonical esbuild require shim", () => {
  const result = analyze(`
    const load = (fallback => typeof require !== 'undefined' ? require :
      typeof Proxy !== 'undefined' ? new Proxy(fallback, {
        get: (target, key) => (typeof require !== 'undefined' ? require : target)[key]
      }) : fallback)(function (name) {
        if (typeof require !== 'undefined') return require.apply(this, arguments);
        throw Error('Dynamic require of "' + name + '" is not supported');
      });
    load('./dep.cjs');
  `);
  expect(result.parse_error_count).toBe(0);
  expect(result.references).toContainEqual(
    expect.objectContaining({
      kind: "require",
      specifier: null,
      expression: "load('./dep.cjs')",
    }),
  );
  expect(result.references).not.toContainEqual(
    expect.objectContaining({ specifier: "./dep.cjs" }),
  );
});

it.each([
  "(() => flag ? require : replacement)()",
  "(() => flag ? require : () => ({}))()",
  "(function () { if (flag) return require; })()",
])(
  "does not promote mixed or incomplete returned loader facts: %s",
  (value) => {
    const result = analyze(`const load = ${value}; load('./dep.cjs');`);
    expect(result.parse_error_count).toBe(0);
    expect(result.references).toEqual([
      expect.objectContaining({ kind: "require", specifier: null }),
    ]);
  },
);

it("keeps an unbound module require returned by an arrow uncertain", () => {
  const result = analyze(
    `const load = (() => require)(); load('./dep.cjs');`,
    "main.mjs",
  );
  expect(result.parse_error_count).toBe(0);
  expect(result.references).toEqual([
    expect.objectContaining({ kind: "require", specifier: null }),
  ]);
});

it.each([
  "(() => () => ({}))()",
  "(() => replacement)()",
  "(async () => require)()",
  "(function* () { return require; })()",
  "(() => { const require = () => ({}); return require; })()",
])(
  "does not invent a native loader for local or eventual values: %s",
  (value) => {
    const result = analyze(`const load = ${value}; load('./dep.cjs');`);
    expect(result.parse_error_count).toBe(0);
    expect(result.references).toEqual([]);
  },
);

it("preserves direct CommonJS loads beside immediate local calls", () => {
  const result = analyze(
    `const local = (() => () => ({}))(); local('./unused.cjs'); require('./dep.cjs');`,
  );
  expect(result.parse_error_count).toBe(0);
  expect(result.references).toEqual([
    expect.objectContaining({ kind: "require", specifier: "./dep.cjs" }),
  ]);
});

it("shares a proven immediate loader result with historical source imports", () => {
  const result = parseReferenceSourceImports(
    "main.cjs",
    new TextEncoder().encode(
      `const load = (() => require)(); load('./dep.cjs');`,
    ),
    "JavaScript",
  );
  expect(result.parse_failures).toEqual([]);
  expect(result.relationships).toEqual([
    {
      from_path: "main.cjs",
      to: "./dep.cjs",
      kind: "requires",
      resolution: "internal",
      parse_state: "parsed",
      resolutionStrategy: "runtime-require",
    },
  ]);
});

it("does not prove a loader before an invocation argument replaces require", () => {
  const result = analyze(
    `const load = (() => require)(require = () => ({})); load('./dep.cjs');`,
  );
  expect(result.parse_error_count).toBe(0);
  expect(result.references).not.toContainEqual(
    expect.objectContaining({ specifier: "./dep.cjs" }),
  );
});
