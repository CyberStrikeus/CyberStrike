import { expect, it } from "vitest";

import { analyzeJavaScriptStaticSource } from "./javascriptStaticAnalysis.js";
import { analyzeJavaScriptSemantics } from "./javascriptSemanticAnalysis.js";
import { onlyCallable } from "./javascriptSemanticAnalysis.fixture.js";

it.each([
  'eval("Map.prototype.get = fetch"); new Map().get("/accounts");',
  'eval("Map.prototype.delete = fetch"); new Map().delete("/accounts");',
  '"use strict"; eval("Map.prototype.get = fetch"); new Map().get("/accounts");',
  'function run() { eval("Map.prototype.get = fetch"); return new Map().get("/accounts"); }',
  'function patch() { eval("Map.prototype.get = fetch"); } patch(); new Map().get("/accounts");',
  'for (const item of [1, 2]) { new Map().get("/accounts"); eval("Map.prototype.get = fetch"); }',
  'const run = eval; run("Map.prototype.get = fetch"); new Map().get("/accounts");',
  'let run; (run = eval)("Map.prototype.get = fetch"); new Map().get("/accounts");',
  'let run; (run = globalThis.eval)("Map.prototype.get = fetch"); new Map().get("/accounts");',
  '(0, eval)("Map.prototype.get = fetch"); new Map().get("/accounts");',
  'globalThis.eval("Map.prototype.get = fetch"); new Map().get("/accounts");',
  'eval?.("Map.prototype.get = fetch"); new Map().get("/accounts");',
  'let run = eval; run("Map.prototype.get = fetch"); run = () => {}; new Map().get("/accounts");',
  'let run = () => {}; run = eval; run("Map.prototype.get = fetch"); new Map().get("/accounts");',
  'const { eval: run } = globalThis; run("Map.prototype.get = fetch"); new Map().get("/accounts");',
  'eval.call(null, "Map.prototype.get = fetch"); new Map().get("/accounts");',
  'const run = eval.bind(null); run("Map.prototype.get = fetch"); new Map().get("/accounts");',
  'globalThis["ev" + "al"]("Map.prototype.get = fetch"); new Map().get("/accounts");',
  'const { ["eval"]: run } = globalThis; run("Map.prototype.get = fetch"); new Map().get("/accounts");',
  'const root = globalThis; const run = root["eval"]; run("Map.prototype.get = fetch"); new Map().get("/accounts");',
  'function invoke() { run("Map.prototype.get = fetch"); } const run = eval; invoke(); new Map().get("/accounts");',
  'function getRun() { return eval; } getRun()("Map.prototype.get = fetch"); new Map().get("/accounts");',
  'Reflect.apply(eval, null, ["Map.prototype.get = fetch"]); new Map().get("/accounts");',
])(
  "keeps a Map lookup after possible opaque mutation as a candidate: %s",
  (source) => {
    expect(analyzeJavaScriptStaticSource(source).endpoints).toMatchObject([
      { kind: "network", value: "/accounts", interpretation: "candidate" },
    ]);
  },
);

it.each([
  'new Map().get("/accounts"); eval("Map.prototype.get = fetch");',
  '(new Map().get("/accounts"), eval("Map.prototype.get = fetch"));',
  'function run(eval) { eval("Map.prototype.get = fetch"); return new Map().get("/accounts"); }',
  'const eval = () => {}; eval("Map.prototype.get = fetch"); new Map().get("/accounts");',
  'for (const item of []) { eval("Map.prototype.get = fetch"); } new Map().get("/accounts");',
  'const run = eval; new Map().get("/accounts"); run("Map.prototype.get = fetch");',
  'function inspect(eval) { const run = eval; run("Map.prototype.get = fetch"); return new Map().get("/accounts"); }',
  'let run = eval; run = () => {}; run("Map.prototype.get = fetch"); new Map().get("/accounts");',
  'eval.bind(null); new Map().get("/accounts");',
])(
  "preserves a Map proof when eval cannot precede the lookup: %s",
  (source) => {
    expect(analyzeJavaScriptStaticSource(source).endpoints).toEqual([]);
  },
);

it("does not grant indirect eval access to the caller's lexical bindings", () => {
  const analysis = analyzeJavaScriptSemantics(`
    export function inspect() {
      let value = 1;
      const run = eval;
      run("value = 2");
      return value;
    }
  `);
  expect(onlyCallable(analysis, "inspect").returnSites[0]?.value).toEqual({
    status: "literal",
    value: 1,
  });
});
