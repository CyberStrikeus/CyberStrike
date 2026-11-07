import { Module } from "node:module";
import * as path from "node:path";
import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";

import { analyzeJavaScriptStaticSource } from "./javascriptStaticAnalysis.js";

const cases = [
  {
    name: "assigned host receiver",
    source: "let holder;(holder=module).require('node:path');",
    outcomes: ["host"],
    possible: true,
  },
  {
    name: "assigned local receiver",
    source:
      "let holder;(holder={require:()=>({kind:'local'})}).require('node:path');",
    outcomes: ["local"],
    possible: false,
  },
  {
    name: "assigned delegate",
    source: "let load;(load=module.require).call(module,'node:path');",
    outcomes: ["host"],
    possible: true,
  },
  {
    name: "conditional assignment value",
    source:
      "let holder;(holder=flag?module:{require:()=>({kind:'local'})}).require('node:path');",
    outcomes: ["local", "host"],
    possible: true,
  },
  {
    name: "logical or assignment",
    source:
      "let holder=flag?{require:()=>({kind:'local'})}:null;(holder||=module).require('node:path');",
    outcomes: ["host", "local"],
    possible: true,
  },
  {
    name: "logical and assignment",
    source: "let holder=flag?{}:null;(holder&&=module).require('node:path');",
    outcomes: ["throw", "host"],
    possible: true,
  },
  {
    name: "nullish assignment",
    source:
      "let holder=flag?{require:()=>({kind:'local'})}:null;(holder??=module).require('node:path');",
    outcomes: ["host", "local"],
    possible: true,
  },
  {
    name: "logical assignment of local receivers",
    source:
      "let holder=flag?{require:()=>({kind:'local'})}:null;(holder||={require:()=>({kind:'local'})}).require('node:path');",
    outcomes: ["local", "local"],
    possible: false,
  },
];

it.each(cases)(
  "retains the expression result for $name",
  ({ source, outcomes, possible }) => {
    for (const [index, expected] of outcomes.entries()) {
      const execute = () =>
        runInNewContext(source, {
          module: new Module("assignment-loader.cjs"),
          flag: index === 1,
        });
      if (expected === "throw") expect(execute).toThrow();
      else {
        const result = execute();
        expect(result.join === path.join).toBe(expected === "host");
        if (expected === "local") expect(result.kind).toBe("local");
      }
    }
    const analysis = analyzeJavaScriptStaticSource(source);
    expect(analysis.parse_error_count).toBe(0);
    expect(analysis.references).toEqual(
      possible
        ? [expect.objectContaining({ kind: "require", specifier: null })]
        : [],
    );
  },
);
