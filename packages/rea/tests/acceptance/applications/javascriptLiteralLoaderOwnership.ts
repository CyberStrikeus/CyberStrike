import { expect } from "vitest";

import { aliasSelectionBudgetSource } from "../../fixtures/javascriptAliasSelectionBudget.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import type { TestCli } from "../../support/cli/cliFixture.js";
import { analyzeJavaScriptDirectory } from "../../support/cli/javascriptApplication.js";
import { writeFixtureFiles } from "../../support/javascriptApplicationFixture.js";

const fixtureImports = (loader: string) => {
  switch (loader) {
    case "pattern alias":
      return { "#window/*": "./proxy/*.cjs" };
    case "recursive alias":
      return { "#entry": "#window", "#window": "./proxy/window.cjs" };
    case "external-package alias":
      return { "#entry": "fixture-window" };
    case "builtin alias":
      return { "#entry": "fs" };
    case "electron alias":
      return { "#entry": "electron" };
    case "electron main alias":
      return { "#entry": "electron/main" };
    default:
      return { "#entry": null };
  }
};

const unprovenLoaderSources: Readonly<Record<string, string>> = {
  "custom iterator assignment module loader":
    'const values = { *[Symbol.iterator]() { yield module; } }; const holder = {}; [holder.loader] = values; holder.loader.require("../shared/window.cjs");',
  "replaced iterator assignment module loader":
    'const values = [{}]; values[Symbol.iterator] = function* () { yield module; }; const holder = {}; [holder.loader] = values; holder.loader.require("../shared/window.cjs");',
  "custom iterator rest declaration module loader":
    'const values = { *[Symbol.iterator]() { yield module; } }; const [...holder] = values; holder[0].require("../shared/window.cjs");',
  "native array assignment local loader":
    'const holder = { loader: module }; [holder.loader] = [{ require() {} }]; holder.loader.require("../shared/window.cjs");',
  "logical rewrite assignment module loader":
    'const holder = {}; holder.loader ??= module; holder.loader.require = replacement; require("../shared/window.cjs");',
  "object rest declaration module loader":
    'const { ...holder } = { loader: module }; holder.loader.require("../shared/window.cjs");',
  "array rest declaration module loader":
    'const [...holder] = [module]; holder[0].require("../shared/window.cjs");',
  "object assignment module loader":
    'const holder = {}; ({ loader: holder.loader } = { loader: module }); holder.loader.require("../shared/window.cjs");',
  "array assignment module loader":
    'const holder = {}; [holder.loader] = [module]; holder.loader.require("../shared/window.cjs");',
  "nested assignment module loader":
    'const holder = {}; ({ inner: { loader: holder.loader } } = { inner: { loader: module } }); holder.loader.require("../shared/window.cjs");',
  "default assignment module loader":
    'const holder = {}; ({ loader: holder.loader = module } = {}); holder.loader.require("../shared/window.cjs");',
  "rest array assignment module loader":
    'const holder = {}; let ignored; [ignored, ...holder.loaders] = [{}, module]; holder.loaders[0].require("../shared/window.cjs");',
  "delegate assignment module loader":
    'const holder = {}; ({ load: holder.load } = { load: module.require }); holder.load.call(module, "../shared/window.cjs");',
  "rewrite assignment module loader":
    'const holder = {}; ({ loader: holder.loader } = { loader: module }); holder.loader.require = replacement; require("../shared/window.cjs");',
  "exports assignment local loader":
    'const holder = {}; ({ exports: holder.loader } = module); holder.loader.require("../shared/window.cjs");',
  "rest assignment local loader":
    'const holder = {}; ({ ...holder.loader } = module); holder.loader.require("../shared/window.cjs");',
  "excluded assignment local loader":
    'const holder = {}; let ignored; ({ loader: ignored, ...holder.copy } = { loader: module }); holder.copy.loader.require("../shared/window.cjs");',
  "inactive default assignment local loader":
    'const holder = {}; ({ loader: holder.loader = module } = { loader: { require() {} } }); holder.loader.require("../shared/window.cjs");',
  "overwritten assignment local loader":
    'const holder = { loader: module }; ({ loader: holder.loader } = { loader: { require() {} } }); holder.loader.require("../shared/window.cjs");',
  "bounded alias selection": aliasSelectionBudgetSource(),
  "captured module delegate":
    'const load = module.require; load.call(module, "../shared/window.cjs");',
  "destructured module delegate":
    'const { require: load } = module; load.apply(module, ["../shared/window.cjs"]);',
  "selected local delegate slots":
    'const table = { x: {}, y: {}, z: module }; const target = flag ? table.x : table.y; target.require = replacement; require("../shared/window.cjs");',
  "local assigned loader":
    'const holder = {}; holder.loader = { require() {} }; holder.loader.require("../shared/window.cjs");',
  "overwritten local loader":
    'const holder = { loader: module }; holder.loader = { require() {} }; holder.loader.require("../shared/window.cjs");',
  "normalized absolute ESM": 'import "/discard%2F/../shared/window.cjs";',
  "normalized absolute dynamic import":
    'import("/discard%5C/../shared/window.cjs");',
  "rewritten CommonJS delegate":
    'module.require = replacement; require("../shared/window.cjs");',
  "nested rewritten CommonJS delegate":
    'const holder = { loader: module }; holder.loader.require = replacement; require("../shared/window.cjs");',
  "assigned rewritten CommonJS delegate":
    'const holder = {}; holder.loader = module; holder.loader.require = replacement; require("../shared/window.cjs");',
  "assigned module loader":
    'const holder = {}; holder.loader = module; holder.loader.require("../shared/window.cjs");',
  "nested module loader":
    'const holder = { loader: module }; holder.loader.require("../shared/window.cjs");',
  "destructured module loader":
    'const holder = { loader: module }; const { loader } = holder; loader.require("../shared/window.cjs");',
  "array module loader":
    'const holder = [module]; holder[0].require("../shared/window.cjs");',
  "bound module loader":
    'const load = module.require.bind(module); load("../shared/window.cjs");',
  "bound module alias loader":
    'const current = module; const load = current.require.bind(current); load("../shared/window.cjs");',
  "computed bound module loader":
    'const load = module["require"].bind(module); load("../shared/window.cjs");',
  "fallback module alias":
    'const { loader = module } = options; loader.require("../shared/window.cjs");',
  "inactive fallback":
    'const { loader = module } = { loader: {} }; loader.require("../shared/window.cjs");',
  "absolute ESM": 'import "/shared/window.cjs";',
  "invalid absolute ESM": 'import "/shared%2Fwindow.cjs";',
  "invalid absolute dynamic import": 'import("/shared%5Cwindow.cjs");',
  "absolute dynamic import": 'import("/shared/window.cjs");',
  "absolute file URL": 'import "file:///shared/window.cjs";',
  "dynamic file URL": 'import("file:///shared/window.cjs");',
  "createRequire base":
    'import { createRequire } from "node:module"; const require = createRequire(new URL("../other/nested/main.cjs", import.meta.url)); require("../shared/window.cjs");',
};

const uncheckedModuleLoaders = new Set([
  "custom iterator assignment module loader",
  "replaced iterator assignment module loader",
  "custom iterator rest declaration module loader",
  "logical rewrite assignment module loader",
  "object rest declaration module loader",
  "array rest declaration module loader",
  "object assignment module loader",
  "array assignment module loader",
  "nested assignment module loader",
  "default assignment module loader",
  "rest array assignment module loader",
  "delegate assignment module loader",
  "rewrite assignment module loader",
  "bounded alias selection",
  "captured module delegate",
  "destructured module delegate",
  "rewritten CommonJS delegate",
  "nested rewritten CommonJS delegate",
  "assigned rewritten CommonJS delegate",
  "assigned module loader",
  "module.require",
  "computed module.require",
  "module alias",
  "later reassigned module alias",
  "conditional module alias",
  "fallback module alias",
  "bound module loader",
  "bound module alias loader",
  "computed bound module loader",
  "nested module loader",
  "destructured module loader",
  "array module loader",
]);

const fixtureMainPath = (loader: string): string => {
  switch (loader) {
    case "absolute ESM":
    case "normalized absolute ESM":
    case "normalized absolute dynamic import":
    case "invalid absolute ESM":
    case "invalid absolute dynamic import":
    case "absolute dynamic import":
    case "absolute file URL":
    case "dynamic file URL":
    case "createRequire base":
      return "main.mjs";
    case "absolute main":
      return "/opt/app/main.cjs";
    case "Windows relative main":
      return "sub\\main.cjs";
    case "Windows drive-relative main":
      return "C:main.cjs";
    case "percent main":
    case "single percent main":
      return "main%2Fentry.cjs";
    default:
      return "main.cjs";
  }
};

const fixtureMainInventoryPath = (loader: string, main: string): string => {
  if (loader === "absolute main") return "opt/app/main.cjs";
  if (loader === "Windows relative main") return "b/sub/main.cjs";
  if (loader === "Windows drive-relative main") return "b/main.cjs";
  return `b/${main}`;
};

const fixtureLoaderSource = (loader: string): string =>
  unprovenLoaderSources[loader] ??
  (loader === "resolve-only"
    ? 'require.resolve("../shared/window.cjs");'
    : loader === "missing wildcard alias"
      ? 'require("#missing/*");'
      : loader === "absolute require"
        ? 'require("/shared/window.cjs");'
        : loader === "projected module"
          ? 'const { exports: api } = module; api.require = () => {}; api.require("../shared/window.cjs");'
          : loader === "absolute main"
            ? 'require("../../shared/window.cjs");'
            : loader === "later reassigned module alias"
              ? 'let current = module; current.require("../shared/window.cjs"); current = other;'
              : loader === "earlier reassigned module alias"
                ? 'let current = module; current = { require() {} }; current.require("../shared/window.cjs");'
                : loader === "conditional module alias"
                  ? 'let current = module; if (flag) current = other; current.require("../shared/window.cjs");'
                  : loader === "module.require"
                    ? 'module.require("../shared/window.cjs");'
                    : loader === "computed module.require"
                      ? 'module["require"]("../shared/window.cjs");'
                      : loader === "module alias"
                        ? 'const current = module; current.require("../shared/window.cjs");'
                        : loader === "local module"
                          ? 'function local(module) { module.require("../shared/window.cjs"); }'
                          : loader === "pattern alias"
                            ? 'require("#window/window");'
                            : loader.endsWith("alias")
                              ? 'require("#entry");'
                              : 'require("../shared/window.cjs");');

const explicitCompetingLoaders = [
  "module.require",
  "computed module.require",
  "module alias",
  "later reassigned module alias",
  "earlier reassigned module alias",
  "conditional module alias",
  "absolute main",
  "Windows relative main",
  "Windows drive-relative main",
  "percent main",
  "pattern alias",
  "recursive alias",
  "external-package alias",
  "builtin alias",
  "electron alias",
  "electron main alias",
  "blocked alias",
  "local module",
  "projected module",
  "resolve-only",
  "missing wildcard alias",
  "absolute require",
] as const;

/** Every competing-loader case, in the order the original matrix ran. */
export const competingLoaderNames = [
  ...explicitCompetingLoaders,
  ...Object.keys(unprovenLoaderSources),
  "single percent main",
];

/**
 * Compiled CLI parity for this stateless matrix. These three loaders are the
 * distinct renderer outcomes: unresolved, the first application page, and the
 * percent-encoded second page. Both surfaces call
 * analyzeJavaScriptApplication; parity compares those normalized results.
 * Every loader, including these, still runs through the shared stdio session.
 */
export const cliParityLoaders = [
  "module.require",
  "earlier reassigned module alias",
  "single percent main",
] as const;

type CompetingLoaderGraph = Awaited<
  ReturnType<typeof analyzeJavaScriptDirectory>
>["graph"];

/** Write one competing-loader application and return its directory. */
const writeCompetingLoaderFixture = async (loader: string): Promise<string> => {
  const root = await createTestTempDirectory("rea-loader-owner-");
  const single = loader === "single percent main";
  const absolute = loader === "absolute main";
  const main = fixtureMainPath(loader);
  const imports = fixtureImports(loader);
  const load = fixtureLoaderSource(loader);
  await writeFixtureFiles(root, {
    "a/package.json": JSON.stringify({ main: "main.cjs" }),
    "a/main.cjs":
      single || absolute
        ? "module.exports = 1;"
        : 'require("../shared/window.cjs");',
    "b/package.json": JSON.stringify({ main, imports }),
    [fixtureMainInventoryPath(loader, main)]: load,
    "b/proxy/window.cjs": 'require("../../shared/window.cjs");',
    "b/node_modules/fixture-window/package.json": JSON.stringify({
      main: "index.cjs",
    }),
    "b/node_modules/fixture-window/index.cjs":
      'require("../../../shared/window.cjs");',
    "shared/window.cjs":
      'const { BrowserWindow } = require("electron"); new BrowserWindow().loadFile("index.html");',
    "a/index.html": "first application page",
    "b/index.html": "second application page",
    "shared/index.html": "source-relative decoy",
    "index.html": "artifact-root decoy",
  });
  return root;
};

/** Ownership facts for one competing loader, independent of transport. */
const expectCompetingLoaderGraph = (
  loader: string,
  graph: CompetingLoaderGraph,
): void => {
  const single = loader === "single percent main";
  const main = fixtureMainPath(loader);
  const inert = [
    "native array assignment local loader",
    "exports assignment local loader",
    "rest assignment local loader",
    "excluded assignment local loader",
    "inactive default assignment local loader",
    "overwritten assignment local loader",
    "local assigned loader",
    "overwritten local loader",
    "invalid absolute ESM",
    "invalid absolute dynamic import",
    "builtin alias",
    "electron alias",
    "electron main alias",
    "inactive fallback",
    "blocked alias",
    "local module",
    "projected module",
    "resolve-only",
    "createRequire base",
    "missing wildcard alias",
    "earlier reassigned module alias",
  ].includes(loader);
  if (loader.startsWith("Windows "))
    expect(graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          relation: "loads",
          properties: expect.objectContaining({
            declared_path: main,
            resolution_status: "unavailable",
            resolved_path: null,
          }),
        }),
      ]),
    );
  if (
    ["absolute require", "absolute ESM", "absolute dynamic import"].includes(
      loader,
    )
  )
    expect(graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          relation: "imports",
          properties: expect.objectContaining({
            specifier: "/shared/window.cjs",
            resolution_status: "unavailable",
            resolved_path: null,
          }),
        }),
      ]),
    );
  if (loader === "createRequire base")
    expect(graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          relation: "imports",
          properties: expect.objectContaining({
            kind: "require",
            operation: "load",
            specifier: "../shared/window.cjs",
            resolution_base_path: "../other/nested/main.cjs",
            resolution_status: "not-found",
            resolved_path: null,
          }),
          evidence: expect.objectContaining({
            location: expect.objectContaining({
              available: true,
              value: expect.objectContaining({
                kind: "source-range",
                source: "b/main.mjs",
              }),
            }),
          }),
        }),
      ]),
    );
  if (loader.endsWith("alias") && !inert && !loader.includes("module alias"))
    expect(graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          relation: "imports",
          properties: expect.objectContaining({
            specifier: loader === "pattern alias" ? "#window/window" : "#entry",
            resolution_status: "unavailable",
          }),
        }),
      ]),
    );
  if (uncheckedModuleLoaders.has(loader))
    expect(graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          relation: "imports",
          properties: expect.objectContaining({
            kind: "require",
            specifier: null,
            resolved_path: null,
          }),
        }),
      ]),
    );
  const roles = graph.nodes.filter(({ kind }) => kind === "electron-renderer");
  expect(roles).toHaveLength(1);
  const role = roles[0];
  const target = single ? "b/index.html" : inert ? "a/index.html" : null;
  expect(role?.observations).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        properties: expect.objectContaining({
          resolved_path: target,
          resolution_status: target === null ? "unavailable" : "resolved",
        }),
      }),
    ]),
  );
  expect(
    graph.edges
      .filter(
        ({ source_node_id, relation }) =>
          source_node_id === role?.node_id && relation === "maps_to",
      )
      .map(({ properties }) => properties.resolved_path),
  ).toEqual(target === null ? [] : [target]);
};

/** Observe one competing loader through the shared stdio MCP session. */
export const assertCompetingLoaderOwnership = async (
  loader: string,
  cli: TestCli,
): Promise<void> => {
  const root = await writeCompetingLoaderFixture(loader);
  const { graph } = await analyzeJavaScriptDirectory("stdio MCP", cli, root);
  expectCompetingLoaderGraph(loader, graph);
};

/**
 * Compare one compiled CLI analysis with the shared stdio MCP analysis of the
 * same fixture. Ownership assertions stay on the MCP matrix.
 */
export const assertCompetingLoaderCliParity = async (
  loader: string,
  cli: TestCli,
): Promise<void> => {
  const root = await writeCompetingLoaderFixture(loader);
  const mcp = await analyzeJavaScriptDirectory("stdio MCP", cli, root);
  const compiled = await analyzeJavaScriptDirectory("CLI", cli, root);
  expect(compiled).toEqual(mcp);
};
