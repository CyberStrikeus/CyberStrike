import { Module } from "node:module";
import { runInNewContext } from "node:vm";

import { expect, it } from "vitest";

import { analyzeJavaScriptStaticSource } from "./javascriptStaticAnalysis.js";

const cases = [
  ["native process", "process.mainModule.require('node:path');", true],
  [
    "captured main",
    "const main=process.mainModule;main.require('node:path');",
    true,
  ],
  [
    "captured delegate",
    "const main=process.mainModule;const load=main.require;load.call(main,'node:path');",
    true,
  ],
  [
    "local process",
    "const process={mainModule:{require:()=>({})}};process.mainModule.require('node:path');",
    false,
  ],
  [
    "replaced process",
    "process={mainModule:{require:()=>({})}};process.mainModule.require('node:path');",
    false,
  ],
  ["unrelated process member", "process.other.require('node:path');", false],
] as const;

it.each(cases)(
  "retains the native Module loader for %s",
  (_name, source, possible) => {
    const main = new Module("process-main-source.cjs");
    const observed = runInNewContext(source, {
      process: { mainModule: main, other: { require: () => ({}) } },
    });
    expect(typeof observed?.join === "function").toBe(possible);
    const analysis = analyzeJavaScriptStaticSource(source);
    expect(analysis.parse_error_count).toBe(0);
    expect(analysis.references).toEqual(
      possible
        ? [expect.objectContaining({ kind: "require", specifier: null })]
        : [],
    );
  },
);
