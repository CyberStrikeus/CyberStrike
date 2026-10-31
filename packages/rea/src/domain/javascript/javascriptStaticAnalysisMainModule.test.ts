import { Module } from "node:module";
import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";

import { analyzeJavaScriptStaticSource } from "./javascriptStaticAnalysis.js";

const cases = [
  ["native main", "require.main.require('node:path');", true, true],
  [
    "captured main",
    "const main=require.main;main.require('node:path');",
    true,
    true,
  ],
  [
    "captured delegate",
    "const load=require.main.require;load.call(require.main,'node:path');",
    true,
    true,
  ],
  ["wrapper var", "var require;require.main.require('node:path');", true, true],
  [
    "local require",
    "const require={main:{require:()=>({kind:'local'})}};require.main.require('node:path');",
    false,
    false,
  ],
  [
    "local alias",
    "const load={main:{require:()=>({kind:'local'})}};load.main.require('node:path');",
    false,
    false,
  ],
  [
    "wrapper main replacement stays conservative",
    "var require;require.main={require:()=>({kind:'local'})};require.main.require('node:path');",
    false,
    true,
  ],
  [
    "conditional main replacement",
    "var require;if(flag)require.main={require:()=>({kind:'local'})};require.main.require('node:path');",
    false,
    true,
  ],
  [
    "main captured before replacement",
    "const main=require.main;require.main={require:()=>({kind:'local'})};main.require('node:path');",
    true,
    true,
  ],
  [
    "ambient main replacement stays conservative",
    "require.main={require:()=>({kind:'local'})};require.main.require('node:path');",
    false,
    true,
  ],
  [
    "shared deep child local write",
    "const old={child:{inner:{make:()=>module}}};const box={...old};old.child={inner:box.child.inner};old.child.inner.make=()=>({require(){}});box.child.inner.make().require('node:path');",
    false,
    false,
  ],
  [
    "shared deep child host write",
    "const old={child:{inner:{make:()=>({})}}};const box={...old};old.child={inner:box.child.inner};old.child.inner.make=()=>module;box.child.inner.make().require('node:path');",
    true,
    true,
  ],
] as const;

it.each(cases)(
  "retains main-module source for %s",
  (_name, source, host, unknown) => {
    const module = new Module("main-module-source.cjs");
    const require = Object.assign(
      (request: string) => module.require(request),
      { main: module },
    );
    const observed = runInNewContext(source, { module, require, flag: true });
    expect(typeof observed?.join === "function").toBe(host);
    const analysis = analyzeJavaScriptStaticSource(source);
    expect(analysis.parse_error_count).toBe(0);
    expect(analysis.references).toEqual(
      unknown
        ? [expect.objectContaining({ kind: "require", specifier: null })]
        : [],
    );
  },
);
