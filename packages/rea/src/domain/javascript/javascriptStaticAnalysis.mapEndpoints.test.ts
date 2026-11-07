import { expect, it } from "vitest";
import * as t from "@babel/types";

import { analyzeJavaScriptStaticSource } from "./javascriptStaticAnalysis.js";
import { inspectCall } from "./javascriptStaticAnalysisCalls.js";
import { createJavaScriptAnalysisAccumulator } from "./javascriptStaticAnalysisState.js";
import { indexJavaScriptBindingsWithReceiversSteps } from "./javascriptSemanticAnalysis.js";
import { parseJavaScriptSource } from "./javascriptSourceParser.js";
import { createJavaScriptRpcScan } from "./javascriptRpcEndpoints.js";
import { createSemanticExpressionShapeResolver } from "./javascriptSemanticExpressionShapes.js";
import {
  completeSemanticSteps,
  traverseJavaScriptAst,
} from "./javascriptSemanticTraversal.js";

it("does not classify a local Map lookup as a network endpoint", () => {
  const analysis = analyzeJavaScriptStaticSource(`
    const records = new Map([["/accounts", { name: "Alice" }]]);
    console.log(records.get("/accounts"));
    fetch("/network");
  `);
  expect(analysis.endpoints).toMatchObject([
    { kind: "network", value: "/network", mechanism: "call:fetch" },
  ]);
  expect(analysis.endpoints[0]?.interpretation).toBeUndefined();
});

it.each([
  'const records = new Map(); const alias = records; alias.get("/accounts"); records.delete("/accounts"); alias.get("/accounts")',
  'new Map().get("/accounts")',
  'new Map().delete("https://example.test/accounts")',
  'const records = new Map(); const alias = records; alias.get("/accounts")',
  'const records = new globalThis.Map(); records?.["get"]("/accounts")',
  'function inspect() { const records = new Map(); return records.get("/accounts"); }',
  'const inspect = () => { const records = new Map(); const alias = records; return alias.delete("/accounts"); }',
  'const browser = window; browser.open("about:blank"); new Map().get("/accounts")',
  'const records = new Map(); const browser = window; browser.open("about:blank"); records.get("/accounts")',
  'const box = {}; box.value = { name: "Alice" }; inspect(box); new Map().get("/accounts")',
  'patch(() => ({ name: "Alice" })); new Map().get("/accounts")',
  'const box = {}; box.prototype = Map.prototype; new Map().get("/accounts")',
  'function expose() { const holder = { child: {} }; holder.child.prototype = Map.prototype; } new Map().get("/accounts")',
  'const box = flag ? {} : {}; box.prototype = Map.prototype; new Map().get("/accounts")',
  'const box = {}; const alias = box; alias.prototype = Map.prototype; inspect({}); new Map().get("/accounts")',
  'const box = {}; box.make = () => Map.prototype; new Map().get("/accounts")',
  'let box = {}; const first = box; box = {}; box.p = Map.prototype; patch(first); new Map().get("/accounts")',
  'const box = {}; box.a = {}; box.a.p = Map.prototype; box.safe = {}; patch(box.safe); new Map().get("/accounts")',
  'const records = new Map(); records.get = fetch; new Map().get("/accounts")',
  'const holder = { get prototype() { return Map.prototype; } }; new Map().get("/accounts")',
  'const holder = { get selected() { return {}; }, get other() { return Map.prototype; } }; holder.selected.get = fetch; new Map().get("/accounts")',
  'function Map() {} new Map().constructor.prototype.get = fetch; globalThis.Map.prototype; new globalThis.Map().get("/accounts")',
  'const factory = { make() { return {}; } }; factory.make = () => ({}); patch(factory.make()); new Map().get("/accounts")',
])("omits a proven Map operation: %s", (source) => {
  expect(analyzeJavaScriptStaticSource(source).endpoints).toEqual([]);
});

it.each([
  'client.get("/accounts")',
  'const records = new Map(); const browser = window; browser.open(window); records.get("/accounts")',
  'const records = new Map(); function invoke() { window.open(); } window.open = patch; invoke(); records.get("/accounts")',
  'Object.getPrototypeOf = () => Map.prototype; Object.getPrototypeOf({}).get = fetch; new Map().get("/accounts")',
  'Reflect.getPrototypeOf = () => Map.prototype; Reflect.getPrototypeOf({}).get = fetch; new Map().get("/accounts")',
  'const records = new Map(); records.get = request; records.get("/accounts")',
  'let records = new Map(); records = client; records.get("/accounts")',
  'function inspect(Map) { new Map().get("/accounts"); }',
  'Map.prototype.get = request; const records = new Map(); records.get("/accounts")',
  'const records = new Map(); records.__proto__ = { get: fetch }; records.get("/accounts")',
  'const records = new Map(); const alias = records; alias.__proto__ = { get: fetch }; records.get("/accounts")',
  'const records = new Map(); records["__proto__"] = { delete: fetch }; records.delete("/accounts")',
  'function inspect() { records.get("/accounts"); const records = new Map(); }',
  'const alias = records; const records = new Map(); alias.get("/accounts")',
  'function inspect() { const alias = records; const records = new Map(); alias.get("/accounts"); }',
  'function inspect() { const records = new Map(); records.get = fetch; records.get("/accounts"); }',
  'patch(Map.prototype); const records = new Map(); records.get("/accounts")',
  'const prototype = Map.prototype; patch(prototype); new Map().get("/accounts")',
  'patch(Map); new Map().get("/accounts")',
  'new Patch(Map.prototype); new Map().get("/accounts")',
  'Map.prototype.patch = function () { this.get = fetch; }; Map.prototype.patch(); new Map().get("/accounts")',
  'Map.patch(); new Map().get("/accounts")',
  'globalThis.patch = function () { this.Map.prototype.get = fetch; }; globalThis.patch(); new Map().get("/accounts")',
  'window.open = function () { this.Map.prototype.get = fetch; }; window.open(); new Map().get("/accounts")',
  'function invoke() { window.open(); } window.open = patch; invoke(); new Map().get("/accounts")',
  'patch`prototype ${Map.prototype}`; new Map().get("/accounts")',
  'const box = { prototype: Map.prototype }; patch(box); new Map().get("/accounts")',
  'patch((() => Map.prototype)()); new Map().get("/accounts")',
  'const prototype = (() => Map.prototype)(); prototype.get = fetch; new Map().get("/accounts")',
  'const box = {}; box.prototype = Map.prototype; box.prototype.get = fetch; new Map().get("/accounts")',
  'const box = {}; box.p = (anything(), Map.prototype); patch(box); new Map().get("/accounts")',
  'window.prototype = Map.prototype; new Map().get("/accounts")',
  'const box = { set prototype(value) { patch(value); } }; box.prototype = Map.prototype; new Map().get("/accounts")',
  'const box = new ExternalBox(); box.prototype = Map.prototype; new Map().get("/accounts")',
  'function expose(box) { box.prototype = Map.prototype; } new Map().get("/accounts")',
  'function expose(box = {}) { box.prototype = Map.prototype; } new Map().get("/accounts")',
  'function expose(external, flag) { const box = flag ? {} : external; box.prototype = Map.prototype; } new Map().get("/accounts")',
  'function expose(external) { const holder = { child: external }; holder.child.prototype = Map.prototype; } new Map().get("/accounts")',
  'function expose(key) { const holder = { child: {} }; holder[key].prototype = Map.prototype; } new Map().get("/accounts")',
  'function expose(key) { const holder = [{}]; holder[key].prototype = Map.prototype; } new Map().get("/accounts")',
  'const box = flag ? {} : external(); box.prototype = Map.prototype; new Map().get("/accounts")',
  'function expose(external, flag) { const make = flag ? () => ({}) : external; const box = make(); box.prototype = Map.prototype; } new Map().get("/accounts")',
  'import external from "./external.mjs"; const box = flag ? {} : external; box.prototype = Map.prototype; new Map().get("/accounts")',
  'let box; if (flag) box = {}; box.prototype = Map.prototype; new Map().get("/accounts")',
  'const factory = { make() { return Map.prototype; } }; factory.make().get = fetch; new Map().get("/accounts")',
  'new Map().__proto__.get = fetch; new Map().get("/accounts")',
  'new Map().constructor.prototype.get = fetch; new Map().get("/accounts")',
  'Object.getPrototypeOf(new Map()).constructor.prototype.get = fetch; new Map().get("/accounts")',
  'const holder = { get prototype() { return Map.prototype; } }; holder.prototype.get = fetch; new Map().get("/accounts")',
  'const holder = { get ["prototype"]() { return { nested: Map.prototype }; } }; holder.prototype.nested.get = fetch; new Map().get("/accounts")',
  'const holder = { get prototype() { return Map.prototype; } }; patch(holder); new Map().get("/accounts")',
  'function store() { box.child.prototype = Map.prototype; } const box = {}; const inner = {}; box.child = inner; store(); patch(inner); new Map().get("/accounts")',
  'function store() { box.child.next.prototype = Map.prototype; } const box = {}; const middle = {}; const inner = {}; middle.next = inner; box.child = middle; store(); patch(inner); new Map().get("/accounts")',
  'const records = new Map(); Object.getPrototypeOf(records).get = fetch; new Map().get("/accounts")',
  'const getPrototype = Reflect.getPrototypeOf; getPrototype(new Map()).get = fetch; new Map().get("/accounts")',
  'patch(() => Map.prototype); new Map().get("/accounts")',
  'const factory = { make() { return {}; } }; factory.make = () => Map.prototype; patch(factory.make()); new Map().get("/accounts")',
  'function make() { return { prototype: Map.prototype }; } patch(make()); new Map().get("/accounts")',
  'const factory = { prototype() { return Map.prototype; } }; patch(factory.prototype()); new Map().get("/accounts")',
  'patch([Map.prototype]); new Map().get("/accounts")',
  'Object.setPrototypeOf(Map.prototype, custom); new Map().get("/accounts")',
])("keeps unresolved lookup semantics as a candidate: %s", (source) => {
  expect(analyzeJavaScriptStaticSource(source).endpoints).toMatchObject([
    { kind: "network", value: "/accounts", interpretation: "candidate" },
  ]);
});

it.each([
  "records.delete = fetch;",
  "patch(records);",
  "Map.prototype.delete = fetch;",
  "const alias = records; alias.__proto__ = { delete: fetch };",
])("retains genuine changes between Map operations: %s", (mutation) => {
  const analysis = analyzeJavaScriptStaticSource(
    `const records = new Map(); records.get('/before'); ${mutation} records.delete('/after');`,
  );
  expect(analysis.endpoints).toContainEqual(
    expect.objectContaining({ value: "/after", interpretation: "candidate" }),
  );
});

it.each(["get", "delete"])(
  "does not assume an unchanged constructor adder for Map.%s",
  (method) => {
    const analysis = analyzeJavaScriptStaticSource(`
    Map.prototype.set = function() { this.${method} = fetch; return this; };
    new Map([['x', 1]]).${method}('/accounts');
  `);
    expect(analysis.endpoints).toContainEqual(
      expect.objectContaining({
        value: "/accounts",
        interpretation: "candidate",
      }),
    );
  },
);

it.each([
  "box.prototype = Map.prototype;",
  'const alias = box; const prototype = Map.prototype; alias["prototype"] = prototype;',
  "({ value: box.prototype } = { value: Map.prototype });",
  "({ value: box.prototype = Map.prototype } = {});",
  "for (box.prototype of [Map.prototype]) {}",
])(
  "retains prototype identities stored after container initialization: %s",
  (store) => {
    const source = `const box = {}; ${store}
    function patch(b) { b.prototype.get = fetch; }
    patch(box); new Map().get("/accounts");`;
    expect(analyzeJavaScriptStaticSource(source).endpoints).toMatchObject([
      { kind: "network", value: "/accounts", interpretation: "candidate" },
    ]);
  },
);

it.each([
  ['new Headers().get("content-type")', 0],
  ['new URLSearchParams().delete("q")', 0],
  ['new Map().get("/accounts")', 0],
  ['new Map().delete("/accounts")', 0],
  ['client.get("/accounts")', 0],
  ['const client = createClient(); client.get("/accounts")', 0],
  ['const records = new Map(); records.get("/accounts")', 1],
] as const)(
  "requests mutation facts only for unresolved local receivers: %s",
  (source, pending) => {
    const file = parseJavaScriptSource(source);
    if (file === null) throw new Error("Expected parsed source");
    const index = completeSemanticSteps(
      indexJavaScriptBindingsWithReceiversSteps(file.program),
    );
    completeSemanticSteps(index.indexAmbientWritesSteps());
    const accumulator = createJavaScriptAnalysisAccumulator(source.length);
    const context = {
      source,
      accumulator,
      vitePreloadDependencyTable: null,
      openReceiverFacts: index.receivers.openReceivers,
      rpcScan: createJavaScriptRpcScan(
        source,
        index.receivers.rpcClientRoots,
        index,
      ),
      expressionShapes: createSemanticExpressionShapeResolver(index.bindings),
    };
    traverseJavaScriptAst(file.program, {
      enter(node) {
        if (
          t.isCallExpression(node) ||
          t.isOptionalCallExpression(node) ||
          t.isNewExpression(node)
        )
          inspectCall(source, node, context, index.bindings);
      },
    });
    expect(accumulator.pendingNetworkCalls).toHaveLength(pending);
  },
);
