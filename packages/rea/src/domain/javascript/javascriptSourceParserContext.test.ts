import { expect, it } from "vitest";
import * as t from "@babel/types";

import {
  analyzeParsedJavaScriptSemantics,
  indexJavaScriptBindingsWithReceiversSteps,
} from "./javascriptSemanticAnalysis.js";
import {
  semanticRequireLoaderAt,
  semanticRequireOrigin,
} from "./javascriptSemanticRequireOrigin.js";
import {
  completeSemanticSteps,
  traverseJavaScriptAst,
} from "./javascriptSemanticTraversal.js";
import { referenceSourceRequireCalls } from "../referenceSourceRequireBindings.js";

import {
  javaScriptRuntimeContext,
  parseRecoveredJavaScript,
  parserPluginsForPath,
} from "./javascriptSourceParser.js";

it.each([
  ["entry.cjs", "module", "commonjs"],
  ["entry.cts", "module", "commonjs"],
  ["entry.mjs", "commonjs", "module"],
  ["entry.mts", "commonjs", "module"],
  ["entry.d.cts", "module", "unknown"],
  ["entry.d.ts", "commonjs", "unknown"],
  ["entry.d.mts", "commonjs", "module"],
  ["entry.jsx", "commonjs", "unknown"],
  ["entry.tsx", "commonjs", "unknown"],
  ["entry.js", "module", "module"],
  ["entry.ts", "commonjs", "commonjs"],
  ["entry.js", "unspecified", "commonjs"],
  ["entry.ts", "unspecified", "unknown"],
  ["entry.js", "unknown", "unknown"],
] as const)(
  "preserves parser-owned %s context over an observed %s package type",
  (path, observed, expected) => {
    const parsed = parseRecoveredJavaScript(
      "",
      path,
      {
        plugins: parserPluginsForPath(path),
      },
      observed,
    );
    expect(parsed.file.errors).toEqual([]);
    expect(parsed.moduleOnlyErrors).toEqual([]);
    expect(javaScriptRuntimeContext(parsed.file.program)).toBe(expected);
  },
);

it("does not derive factory authority from an ambient require in a proven module", () => {
  const source = [
    'const { createRequire } = require("node:module");',
    'const load = createRequire(import.meta.url); load("./dep.cjs");',
  ].join("\n");
  const { file } = parseRecoveredJavaScript(source, "entry.js", {}, "module");
  expect(file.errors).toEqual([]);
  expect(analyzeParsedJavaScriptSemantics(file).moduleLinks).toEqual([]);
  expect([...referenceSourceRequireCalls(file, "entry.js")]).toEqual([]);
});

it.each([
  ["without source redeclarations", "", "", true],
  ["with a var redeclaration", "var require;\n", "", true],
  ["after a prior write", "require = custom;\n", "", false],
  ["before a later write", "", "\nrequire = custom;", true],
  ["behind a lexical declaration", "const require = custom;\n", "", false],
  ["behind a nested parameter", "function shadow(require) {\n", "\n}", false],
] as const)(
  "uses the seeded wrapper fact consistently %s",
  (_name, prefix, suffix, expected) => {
    const source =
      prefix +
      [
        'const { createRequire } = require("node:module");',
        'const load = createRequire(import.meta.url); load("./dep.cjs");',
      ].join("\n") +
      suffix;
    const { file } = parseRecoveredJavaScript(source, "entry.js", {});
    expect(file.errors).toEqual([]);
    expect(file.program.sourceType).toBe("module");
    expect(javaScriptRuntimeContext(file.program)).toBe("unknown");
    const index = completeSemanticSteps(
      indexJavaScriptBindingsWithReceiversSteps(
        file.program,
        "commonjs-wrapper",
      ),
    );
    completeSemanticSteps(index.indexMemberMutationFactsSteps());
    let required: t.CallExpression | undefined;
    let loaded: t.CallExpression | undefined;
    traverseJavaScriptAst(file.program, {
      enter: (node) => {
        if (!t.isCallExpression(node)) return;
        if (t.isIdentifier(node.callee, { name: "require" })) required = node;
        if (t.isIdentifier(node.callee, { name: "load" })) loaded = node;
      },
    });
    if (required === undefined || loaded === undefined)
      throw new Error("Expected loader fixture calls");
    expect(
      semanticRequireOrigin(required, index.bindings)?.origin.specifier,
    ).toBe(expected ? "node:module" : undefined);
    expect(semanticRequireLoaderAt(loaded, index.bindings, new Set())).toBe(
      expected ? "create-require" : "local",
    );
  },
);

it("detects JavaScript module syntax within an observed unspecified package", () => {
  const { file } = parseRecoveredJavaScript(
    "void import.meta.url;",
    "entry.js",
    {},
    "unspecified",
  );
  expect(file.errors).toEqual([]);
  expect(javaScriptRuntimeContext(file.program)).toBe("module");
});
