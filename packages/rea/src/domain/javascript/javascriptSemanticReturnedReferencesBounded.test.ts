import * as t from "@babel/types";
import { expect, it, vi } from "vitest";

import { indexJavaScriptBindingsSteps } from "./javascriptSemanticAnalysis.js";
import { parseJavaScriptSource } from "./javascriptSourceParser.js";
import { createSemanticReturnedReferences } from "./javascriptSemanticReturnedReferences.js";

const indexed = (source: string) => {
  const parsed = parseJavaScriptSource(source, "returned-references.js");
  if (parsed === null) throw new Error("Expected valid fixture");
  const steps = indexJavaScriptBindingsSteps(parsed.program);
  let step = steps.next();
  while (step.done !== true) step = steps.next();
  return step.value;
};

const measuredSwap = (writes: number) => {
  const source = `
    function first(){return {x:{deep:{leaf:1}}}}
    function second(){return {x:{deep:{leaf:2}}}}
    let a=first,b=second;
    function run(){
      ${Array.from({ length: writes }, () => "a=b;b=a;").join("")}
      a().x=1;
    }
  `;
  const state = indexed(source);
  let callee: t.Identifier | undefined;
  t.traverseFast(state.program, (node) => {
    if (
      callee === undefined &&
      t.isCallExpression(node) &&
      t.isIdentifier(node.callee, { name: "a" })
    )
      callee = node.callee;
  });
  if (callee === undefined) throw new Error("Missing selected call read");
  const lookups = state.scopes.map((scope) => vi.spyOn(scope.bindings, "get"));
  try {
    const result = createSemanticReturnedReferences(state)(callee);
    return {
      result,
      reads: lookups.reduce(
        (count, lookup) => count + lookup.mock.calls.length,
        0,
      ),
    };
  } finally {
    for (const lookup of lookups) lookup.mockRestore();
  }
};

const measuredSwitchWeb = (arms: number) => {
  const bindings = ["t", "e", "a", "n", "r"];
  const keys = [
    "child",
    "sibling",
    "return",
    "memoizedState",
    "pendingProps",
    "stateNode",
  ];
  const cases = Array.from({ length: arms }, (_, index) => {
    const target = bindings[index % bindings.length];
    const source = bindings[(index + 1) % bindings.length];
    const key = keys[index % keys.length];
    return `case ${index}: ${target} = ${source}.${key}; break;`;
  }).join("\n");
  const state = indexed(`
    function beginWork(t,e,a,n,r) {
      switch(t.tag) { ${cases} }
      const d=t.deletions;
      d.push(n);
      return t;
    }
    beginWork(fiber,e0,a0,n0,r0);
  `);
  let callee: t.MemberExpression | undefined;
  t.traverseFast(state.program, (node) => {
    if (
      callee === undefined &&
      t.isCallExpression(node) &&
      t.isMemberExpression(node.callee) &&
      t.isIdentifier(node.callee.object, { name: "d" }) &&
      t.isIdentifier(node.callee.property, { name: "push" })
    )
      callee = node.callee;
  });
  if (callee === undefined) throw new Error("Missing switch-web sink");
  const lookups = state.scopes.map((scope) => vi.spyOn(scope.bindings, "get"));
  try {
    const result = createSemanticReturnedReferences(state)(callee);
    return {
      result,
      reads: lookups.reduce(
        (count, lookup) => count + lookup.mock.calls.length,
        0,
      ),
    };
  } finally {
    for (const lookup of lookups) lookup.mockRestore();
  }
};

it("bounds shared reassignment initializer expansion by visited AST projections", () => {
  const small = measuredSwap(8);
  const large = measuredSwap(18);
  expect(small.result.precision).toBe("exact");
  expect(large.result.precision).toBe("exact");
  expect(small.result.references.length).toBeGreaterThan(0);
  expect(large.result.references.length).toBeGreaterThanOrEqual(
    small.result.references.length,
  );
  expect(small.reads).toBeGreaterThan(0);
  expect(large.reads).toBeLessThan(3 * small.reads);
});

it("bounds returned-reference expansion across a React-shaped switch mesh", () => {
  const small = measuredSwitchWeb(12);
  const large = measuredSwitchWeb(24);
  expect(small.result.references).toEqual([]);
  expect(large.result.references).toEqual([]);
  expect(small.reads).toBeGreaterThan(0);
  expect(large.reads).toBeLessThan(4 * small.reads);
});

it.each([
  ["{make:()=>module}", "{...box}", "box.make"],
  ["[()=>module]", "[...box]", "box[0]"],
])(
  "converges repeated copy boundaries without dropping callable results: %s",
  (initial, replacement, target) => {
    const state = indexed(
      `let box=${initial};while(flag)box=${replacement};${target}();`,
    );
    let callee: t.Node | undefined;
    t.traverseFast(state.program, (node) => {
      if (t.isCallExpression(node)) callee = node.callee;
    });
    if (callee === undefined) throw new Error("Missing copied call");
    const lookups = state.scopes.map((scope) =>
      vi.spyOn(scope.bindings, "get"),
    );
    try {
      const result = createSemanticReturnedReferences(state)(callee);
      expect(result.references).toContainEqual({
        node: expect.objectContaining({ type: "Identifier", name: "module" }),
        projection: [],
      });
      expect(
        lookups.reduce((count, lookup) => count + lookup.mock.calls.length, 0),
      ).toBeLessThan(100);
    } finally {
      for (const lookup of lookups) lookup.mockRestore();
    }
  },
);
