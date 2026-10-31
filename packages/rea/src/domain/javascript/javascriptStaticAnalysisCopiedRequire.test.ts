import { Module } from "node:module";
import { expect, it } from "vitest";

import { analyzeJavaScriptStaticSource } from "./javascriptStaticAnalysis.js";

it("checks inherited and own enumerable require against a real Node Module", () => {
  const host = new Module("copied-require-oracle.cjs");
  expect(Object.hasOwn(host, "require")).toBe(false);
  expect(typeof host.require).toBe("function");
  const { ...rest } = host;
  expect(Object.hasOwn(rest, "require")).toBe(false);
  expect(Object.hasOwn({ ...host }, "require")).toBe(false);

  host.require = host.require;
  expect(Object.getOwnPropertyDescriptor(host, "require")?.enumerable).toBe(
    true,
  );
  const { ...ownRest } = host;
  expect(ownRest.require).toBe(host.require);
  expect({ ...host }.require).toBe(host.require);
});

it("keeps copied child module identity without copying its prototype", () => {
  const host = new Module("copied-child-oracle.cjs");
  const { ...copy } = { loader: host };
  expect(Object.hasOwn(copy, "loader")).toBe(true);
  expect(copy.loader).toBe(host);
  expect(Object.hasOwn(copy.loader, "require")).toBe(false);
  expect(copy.loader.require).toBe(host.require);
});

it.each(["const {...h}=module;", "const h={...module};"])(
  "keeps a copied inherited delegate absent inside a function: %s",
  (declaration) => {
    const result = analyzeJavaScriptStaticSource(
      `function copy(){${declaration}h.require('./shared.cjs');}`,
    );
    expect(result.references).toEqual([]);
  },
);

it.each([
  ["const {...h}=module;h", false],
  ["const holder={};({...holder.h}=module);holder.h", false],
  ["const h={...module};h", false],
  ["const source=module;const h={...source};h", false],
  ["const source=module;const {...h}=source;h", false],
  ["const h={...{loader:module}};h.loader", true],
  ["const {...h}={loader:module};h.loader", true],
  ["const h={...[module]};h[0]", true],
  ["const source={require:module.require};const h={...source};h", true],
  ["const source={require:module.require};const {...h}=source;h", true],
  ["module.require=module.require;const h={...module};h", true],
  ["module.require=module.require;const {...h}=module;h", true],
  ["const h={...module};module.require=module.require;h", false],
  ["const {...h}=module;module.require=module.require;h", false],
  ["if(flag)module.require=module.require;const h={...module};h", true],
  ["globalThis.module.require=unknown;const h={...module};h", false],
  ["expose(module);const h={...module};h", true],
  ["const h={...module};expose(module);h", false],
  ["const module={require(){}};const h={...module};h", false],
])(
  "selects only possibly own enumerable copied delegates: %s",
  (receiver, expected) => {
    const result = analyzeJavaScriptStaticSource(
      `${receiver}.require('./shared.cjs');`,
    );
    expect(result.parse_error_count).toBe(0);
    expect(result.references).toEqual(
      expected
        ? [expect.objectContaining({ kind: "require", specifier: null })]
        : [],
    );
  },
);
