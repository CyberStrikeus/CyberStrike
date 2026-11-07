import { expect, it } from "vitest";

import { analyzeJavaScriptSemantics } from "./javascriptSemanticAnalysis.js";
import { topLevelBinding } from "./javascriptSemanticAnalysis.fixture.js";
import { analyzeJavaScriptStaticSource } from "./javascriptStaticAnalysis.js";

it.each([
  'var require;require("./before.cjs");',
  'var require;require("./before.cjs");({require}={require:()=>({})});',
  'var require;require("./before.cjs");[require]=[()=>({})];',
  'var require;({require}={require:require("./before.cjs")});',
  'var require;[require]=[require("./before.cjs")];',
])("preserves the host loader at its earlier read: %s", (source) => {
  const analysis = analyzeJavaScriptStaticSource(source);
  expect(analysis.parse_error_count).toBe(0);
  expect(analysis.references).toContainEqual(
    expect.objectContaining({ kind: "require", specifier: "./before.cjs" }),
  );
});

it.each([
  "({require}={require:()=>({BrowserWindow:class{}})});",
  "[require]=[()=>({BrowserWindow:class{}})];",
  "({nested:{require}}={nested:{require:()=>({BrowserWindow:class{}})}});",
  "({require=()=>({BrowserWindow:class{}})}={});",
  "if(flag)({require}={require:()=>({BrowserWindow:class{}})});",
])(
  "keeps projected loader writes out of proven Electron identity: %s",
  (write) => {
    const analysis = analyzeJavaScriptStaticSource(
      `var require;${write}const {BrowserWindow}=require("electron");new BrowserWindow({webPreferences:{preload:"./unused.cjs"}});`,
    );
    expect(analysis.parse_error_count).toBe(0);
    expect(analysis.references).toContainEqual(
      expect.objectContaining({ kind: "require", specifier: null }),
    );
    expect(analysis.references).not.toContainEqual(
      expect.objectContaining({ kind: "require", specifier: "electron" }),
    );
    expect(analysis.electron.browser_windows).toEqual([]);
  },
);

it.each([
  "({require}={require:()=>({BrowserWindow:class{}})});",
  "[require]=[()=>({BrowserWindow:class{}})];",
])("preserves an Electron capture before the projected write: %s", (write) => {
  const analysis = analyzeJavaScriptStaticSource(
    `var require;const {BrowserWindow}=require("electron");${write}new BrowserWindow({webPreferences:{preload:"./before.cjs"}});`,
  );
  expect(analysis.parse_error_count).toBe(0);
  expect(analysis.references).toContainEqual(
    expect.objectContaining({ kind: "require", specifier: "electron" }),
  );
  expect(analysis.electron.browser_windows).toMatchObject([
    { preload_path: "./before.cjs" },
  ]);
});

it.each([
  ["({module}={module:{require(){}}});", false],
  ["[module]=[{require(){}}];", false],
  ["if(flag)({module}={module:{require(){}}});", true],
  ["if(flag)[module]=[{require(){}}];", true],
])(
  "distinguishes definite and conditional wrapper replacement: %s",
  (write, unknown) => {
    const analysis = analyzeJavaScriptStaticSource(
      `var module;${write}module.require("./unused.cjs");`,
    );
    expect(analysis.parse_error_count).toBe(0);
    expect(
      analysis.references.filter(({ kind }) => kind === "require"),
    ).toEqual(unknown ? [expect.objectContaining({ specifier: null })] : []);
  },
);

it.each([
  ["({loader}={loader:()=>({})});loader('./unused.cjs');", null],
  ["[loader]=[()=>({})];loader('./unused.cjs');", null],
  ["if(flag)({loader}={loader:()=>({})});loader('./unused.cjs');", null],
  ["loader('./before.cjs');({loader}={loader:()=>({})});", "./before.cjs"],
  ["loader('./before.cjs');[loader]=[()=>({})];", "./before.cjs"],
])(
  "uses the shared write facts for a factory loader: %s",
  (body, specifier) => {
    const analysis = analyzeJavaScriptStaticSource(
      `globalThis.webpackChunkApp.push([[1],{entry:function(module,exports,loader){${body}}}]);`,
    );
    expect(analysis.parse_error_count).toBe(0);
    expect(
      analysis.references.filter(({ kind }) => kind === "require"),
    ).toEqual([expect.objectContaining({ specifier })]);
  },
);

it.each([
  "({require}={require:()=>({BrowserWindow:class{}})});",
  "if(flag)({require}={require:()=>({BrowserWindow:class{}})});",
])("retains ambient projected writes as unknown: %s", (write) => {
  const analysis = analyzeJavaScriptStaticSource(
    `${write}const {BrowserWindow}=require("electron");new BrowserWindow({});`,
  );
  expect(analysis.parse_error_count).toBe(0);
  expect(analysis.references).toContainEqual(
    expect.objectContaining({ kind: "require", specifier: null }),
  );
  expect(analysis.electron.browser_windows).toEqual([]);
});

it("keeps projected reference provenance unknown until its sources are resolved", () => {
  const analysis = analyzeJavaScriptSemantics(
    'let selected;({selected}={selected:require("electron")});',
  );
  expect(topLevelBinding(analysis, "selected").provenance).toMatchObject({
    status: "unknown",
    origins: [],
  });
});
