import { expect, it } from "vitest";
import * as t from "@babel/types";

import { analyzeJavaScriptStaticSource } from "./javascriptStaticAnalysis.js";
import { parseJavaScriptSource } from "./javascriptSourceParser.js";
import { indexJavaScriptBindingsWithReceiversSteps } from "./javascriptSemanticAnalysis.js";
import { completeSemanticSteps } from "./javascriptSemanticTraversal.js";
import { createSemanticReturnedReferences } from "./javascriptSemanticReturnedReferences.js";

it.each([
  ["const get=()=>module;get.call(null)", true],
  ["const get=()=>module;get.apply(null,[])", true],
  ["const get=()=>module;get['call'](null)", true],
  ["const get=()=>module;const alias=get;alias.apply(null,[])", true],
  ["const box={get(){return module;}};box.get.call(null)", true],
  ["const get=()=>module;get.call.call(get,null)", true],
  ["const get=()=>module;get.apply.call(get,null,[])", true],
  ["const get=()=>module;const invoke=get.call;invoke.call(get,null)", true],
  [
    "const get=()=>module;const invoke=get.call;const other=()=>({});invoke.call(other,null)",
    false,
  ],
  [
    "const get=()=>({});const invoke=get.call;const other=()=>module;invoke.call(other,null)",
    true,
  ],
  [
    "const get=()=>module;const invoke=get.apply;invoke.call(get,null,[])",
    true,
  ],
  ["const get=()=>module;const invoke=get.call;invoke.apply(get,[null])", true],
  ["const get=()=>({});get.call(null)", false],
  ["const get=()=>({});get.apply(null,[])", false],
  ["const get=()=>module.exports;get.call(null)", false],
  ["const get=()=>module;get.call=()=>({require(){}});get.call(null)", false],
  [
    "const get=()=>module;get.apply=()=>({require(){}});get.apply(null,[])",
    false,
  ],
  ["const get=()=>({});get.call=()=>module;get.call(null)", true],
  ["const get=()=>({});get.apply=()=>module;get.apply(null,[])", true],
  ["const get=()=>module;const invoke=get.call;invoke(get)", false],
  ["const get=()=>module;(0,get.call)(null)", false],
  ["const get=()=>module;(0,get.apply)(null,[])", false],
  [
    "const get=()=>module;const other=()=>({});get.call.call(other,null)",
    false,
  ],
  ["const get=()=>({});const other=()=>module;get.call.call(other,null)", true],
  ["function* get(){yield module;}get.call(null)", false],
  ["async function get(){return module;}get.apply(null,[])", false],
  ["async function get(){return module;}(await get.call(null))", true],
  ["const get=()=>module;get.call=unknown;get.call(null)", true],
  ["const get=()=>module;if(flag)get.call=()=>({});get.call(null)", true],
  [
    "const get=()=>({});Object.setPrototypeOf(get,{call:()=>module});get.call(null)",
    true,
  ],
  [
    "const get=()=>module;Object.setPrototypeOf(get,{call:()=>({})});get.call(null)",
    true,
  ],
  [
    "const get=()=>1;Object.setPrototypeOf(get,{call:()=>module});get.call(null)",
    true,
  ],
  [
    "const get=()=>({});Object.setPrototypeOf(get,{call:()=>module});get.call=()=>({});get.call(null)",
    false,
  ],
  [
    "const get=()=>({});Object.setPrototypeOf(get,{call:()=>({})});get.call=()=>module;get.call(null)",
    true,
  ],
])(
  "retains invocation results after selecting source-local member identity: %s",
  (receiver, expected) => {
    const analysis = analyzeJavaScriptStaticSource(
      `${receiver}.require('./shared.cjs');`,
    );
    expect(analysis.parse_error_count).toBe(0);
    expect(analysis.references).toEqual(
      expected
        ? [expect.objectContaining({ kind: "require", specifier: null })]
        : [],
    );
  },
);

it.each([
  ["Function.prototype.call=unknown;const get=()=>({});get.call(null)", true],
  [
    "Function.prototype.apply=unknown;const get=()=>({});get.apply(null,[])",
    true,
  ],
  [
    "Function.prototype.call=unknown;const get=()=>module;get.call=()=>({});get.call(null)",
    false,
  ],
  ["Function.prototype.extra=unknown;const get=()=>({});get.call(null)", false],
])(
  "retains inherited invocation uncertainty without revoking own slots: %s",
  (receiver, expected) => {
    const analysis = analyzeJavaScriptStaticSource(
      `${receiver}.require('./shared.cjs');`,
    );
    expect(analysis.parse_error_count).toBe(0);
    expect(analysis.references).toEqual(
      expected ? [expect.objectContaining({ specifier: null })] : [],
    );
  },
);

it("keeps source reads before later function-method replacement", () => {
  const analysis = analyzeJavaScriptStaticSource(`
    const get=()=>module;
    get.call(null).require('./shared.cjs');
    get.call=()=>({});
    get.call(null).require('./unused.cjs');
  `);
  expect(analysis.references).toEqual([
    expect.objectContaining({ specifier: null }),
  ]);
});

it("keeps an earlier native invocation before a later prototype write", () => {
  const analysis = analyzeJavaScriptStaticSource(`
    const get=()=>({});
    get.call(null).require('./unused.cjs');
    Function.prototype.call=unknown;
  `);
  expect(analysis.references).toEqual([]);
});

it("does not treat a shadowed Function namespace as native prototype mutation", () => {
  const analysis = analyzeJavaScriptStaticSource(`
    function local(Function){
      Function.prototype.call=unknown;
      const get=()=>({});
      get.call(null).require('./unused.cjs');
    }
  `);
  expect(analysis.references).toEqual([]);
});

it("retains a finite shared callable alias graph", () => {
  const aliases = Array.from(
    { length: 64 },
    (_, index) => `const get${index + 1}=flag?get${index}:get${index};`,
  ).join("");
  const parsed = parseJavaScriptSource(
    `const get0=()=>module;${aliases}get64.apply(null,[]);`,
  );
  if (parsed === null) throw new Error("Expected valid shared alias fixture");
  const index = completeSemanticSteps(
    indexJavaScriptBindingsWithReceiversSteps(parsed.program),
  );
  completeSemanticSteps(index.indexAmbientWritesSteps());
  completeSemanticSteps(index.indexMemberMutationFactsSteps());
  const statement = parsed.program.body.at(-1);
  if (
    !t.isExpressionStatement(statement) ||
    !t.isCallExpression(statement.expression)
  )
    throw new Error("Expected final invocation");
  const call = statement.expression;
  const result = createSemanticReturnedReferences(
    index.bindings,
    "direct-call",
  )(call.callee, call);
  const declaration = parsed.program.body[0];
  if (!t.isVariableDeclaration(declaration))
    throw new Error("Expected root callable declaration");
  const callable = declaration.declarations[0]?.init;
  if (!t.isArrowFunctionExpression(callable))
    throw new Error("Expected root arrow callable");
  expect(result).toEqual({
    callables: new Set([callable]),
    references: [
      {
        node: expect.objectContaining({ type: "Identifier", name: "module" }),
        projection: [],
      },
    ],
    precision: "exact",
  });
});
