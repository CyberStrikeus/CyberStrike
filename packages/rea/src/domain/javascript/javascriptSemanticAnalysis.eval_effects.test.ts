import { expect, it } from "vitest";
import { analyzeJavaScriptSemantics } from "./javascriptSemanticAnalysis.js";
import {
  onlyBinding,
  onlyCallable,
} from "./javascriptSemanticAnalysis.fixture.js";
const returned = (body: string) =>
  onlyCallable(analyzeJavaScriptSemantics(body), "run").returnSites[0]?.value;

it.each([
  'export function run() { const value={n:1}; const alias=value; {const value=0;eval("alias.n=2");} return value.n; }',
  'const value=1; function run(){eval("var value=2");return value;}',
  'export function run(){let alias;let result;{const value={n:1};alias=value;eval("alias.n=2");result=value.n;}return result;}',
  'function run(){function value(){} eval("value=2");return value;}',
  'function run(){class value {} eval("value=2");return value;}',

  'export function run() { let value=1; eval("value=2"); return value; }',
  'export function run() { const value={n:1}; eval("value.n=2"); return value.n; }',
  'export function run() { const value={n:1}; const alias=value; eval("value.n=2"); return alias.n; }',
  'export function run() { let value=1; function change(){ eval("value=2"); } change(); return value; }',
  'export function run() { let value=1; change(); return value; function change(){ eval("value=2"); } }',
])("does not retain stale exact values after direct eval: %s", (source) => {
  expect(returned(source)).toMatchObject({ status: "unknown" });
});

it("retains uncertainty for outer function declarations across eval-bearing calls", () => {
  const ir = analyzeJavaScriptSemantics(
    'function value(){} function run(){const saved=value;eval("value=2");return saved;} run();run();',
  );
  expect(onlyBinding(ir, "saved").provenance.status).toBe("ambiguous");
});

it.each(["||=", "??="])(
  "does not treat %s as a fresh reset before eval",
  (operator) => {
    const ir = analyzeJavaScriptSemantics(
      `let value; function run(){value ${operator} 1;const saved=(0,value);eval('value=require("node:fs")');return saved;}run();run();`,
    );
    expect(onlyBinding(ir, "saved").provenance.status).toBe("ambiguous");
  },
);

it.each([
  'eval("var value=2"); function run(){const value=1;return value;}',
  'export function run(){const value={n:1};const saved=value.n;eval("value.n=2");return saved;}',
  'const value=1; function run(){"use strict";eval("var value=2");return value;}',
  'function run(){const value=1;eval("var other=2");return value;}',
  'function other(){const value={n:2};eval("value.n=3");} export function run(){const value={n:1};return value.n;}',
  'export function run() { let value=1; (0,eval)("value=2"); return value; }',
  'export function run() { let value=1; eval?.("value=2"); return value; }',
  'function run() { let value=1; function eval(x) {} eval("value=2"); return value; }',
  'function other() { let value=3; eval("value=4"); } export function run() { let value=1; return value; }',
  'export function run() { let value=1; function other() { let value=3; eval("value=4"); } other(); return value; }',
  'export function run() { let value=1; const saved=value; eval("value=2"); return saved; }',
])(
  "preserves unaffected lexical facts and primitive captures: %s",
  (source) => {
    expect(returned(source)).toEqual({ status: "literal", value: 1 });
  },
);

it("invalidates object facts captured in a block when an alias reaches eval outside it", () => {
  const ir = analyzeJavaScriptSemantics(`export function run(){
    let alias;
    {const value={n:1};alias=value; function read(){return value.n;}}
    eval("alias.n=2");
  }`);
  expect(onlyCallable(ir, "read").returnSites[0]?.value).toMatchObject({
    status: "unknown",
  });
});
