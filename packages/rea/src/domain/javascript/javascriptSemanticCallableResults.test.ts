import * as t from "@babel/types";
import { expect, it } from "vitest";
import { semanticCallableResultExpressions } from "./javascriptSemanticCallableResults.js";
import { parseJavaScriptSource } from "./javascriptSourceParser.js";

it("reuses direct result syntax while excluding nested callable results", () => {
  const parsed = parseJavaScriptSource(`function* outer(){
    function inner(){return hidden;}
    class Hidden{method(){return hidden;}}
    if(flag)return first;
    yield* second;
  }`);
  const callable = parsed?.program.body[0];
  if (!t.isFunctionDeclaration(callable))
    throw new Error("Expected callable fixture");
  const statements = callable.body.body;
  let reads = 0;
  Object.defineProperty(callable.body, "body", {
    get: () => {
      reads += 1;
      return statements;
    },
  });
  const result = semanticCallableResultExpressions(callable);
  expect(
    result.map(({ node, kind, delegated }) => [
      t.isIdentifier(node) ? node.name : null,
      kind,
      delegated,
    ]),
  ).toEqual([
    ["first", "return", false],
    ["second", "yield", true],
  ]);
  expect(reads).toBeGreaterThan(0);
  reads = 0;
  for (let i = 0; i < 32; i++)
    expect(semanticCallableResultExpressions(callable)).toBe(result);
  expect(reads).toBe(0);
});

it("keeps identical source text in separate syntax trees distinct", () => {
  const first = t.arrowFunctionExpression([], t.identifier("value"));
  const second = t.arrowFunctionExpression([], t.identifier("value"));
  expect(semanticCallableResultExpressions(first)[0]?.node).toBe(first.body);
  expect(semanticCallableResultExpressions(second)[0]?.node).toBe(second.body);
});

it("retains recovered yield syntax in a non-generator return", () => {
  const parsed = parseJavaScriptSource("function f(){ return (yield 1); }");
  expect(parsed?.errors.length).toBeGreaterThan(0);
  const callable = parsed?.program.body[0];
  if (!t.isFunctionDeclaration(callable))
    throw new Error("Expected recovered callable fixture");
  const results = semanticCallableResultExpressions(callable);
  expect(results.map(({ kind }) => kind)).toEqual(["return", "yield"]);
  expect(t.isYieldExpression(results[0]?.node)).toBe(true);
  expect(t.isNumericLiteral(results[1]?.node, { value: 1 })).toBe(true);
});

it("retains empty results and bare return/yield source sites", () => {
  const empty = t.functionExpression(null, [], t.blockStatement([]));
  const emptyResult = semanticCallableResultExpressions(empty);
  expect(emptyResult).toEqual([]);
  expect(semanticCallableResultExpressions(empty)).toBe(emptyResult);

  const bareReturn = t.returnStatement();
  const bareYield = t.yieldExpression();
  const generator = t.functionExpression(
    null,
    [],
    t.blockStatement([t.expressionStatement(bareYield), bareReturn]),
    true,
  );
  const result = semanticCallableResultExpressions(generator);
  expect(result).toEqual([
    { node: null, site: bareYield, kind: "yield", delegated: false },
    { node: null, site: bareReturn, kind: "return", delegated: false },
  ]);
  expect(semanticCallableResultExpressions(generator)).toBe(result);
});
