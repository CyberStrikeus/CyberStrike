import { expect, it } from "vitest";
import * as t from "@babel/types";

import { createSemanticModuleInterop } from "./javascriptModuleInterop.js";
import {
  javaScriptSourceInvocationContext,
  javaScriptGenericInvocationMethod,
  resolveJavaScriptGenericInvocation,
} from "./javascriptIntrinsicInvocation.js";
import { parseJavaScriptSource } from "./javascriptSourceParser.js";
import { indexJavaScriptBindingsSteps } from "./javascriptSemanticAnalysis.js";
import {
  completeSemanticSteps,
  traverseJavaScriptAst,
} from "./javascriptSemanticTraversal.js";

const invocationKinds = (source: string) => {
  const parsed = parseJavaScriptSource(source);
  if (parsed === null) throw new Error("invocation fixture did not parse");
  const state = completeSemanticSteps(
    indexJavaScriptBindingsSteps(parsed.program),
  );
  const interop = createSemanticModuleInterop(state);
  const invocations: (ReturnType<typeof interop.intrinsicInvocation> | null)[] =
    [];
  traverseJavaScriptAst(parsed.program, {
    enter: (node) => {
      if (t.isCallExpression(node) || t.isOptionalCallExpression(node))
        invocations.push(interop.intrinsicInvocation(node) ?? null);
    },
  });
  return invocations;
};

it.each([
  'const change = Object.defineProperty.call; change(null,Object,"create",{value:customCreate});',
  'const {apply:change} = Object.defineProperty; change(null,[Object,"create",{value:customCreate}]);',
  'const change = Reflect.apply.call; change(null,Object.defineProperty,null,[Object,"create",{value:customCreate}]);',
])(
  "keeps a bare invocation member alias unknown, not effect-free: %s",
  (source) => {
    expect(invocationKinds(source)).toEqual([
      expect.objectContaining({ kind: "opaque" }),
    ]);
  },
);

it("keeps a comma-expression intrinsic call unknown when its receiver is erased", () => {
  expect(
    invocationKinds(
      '(0, Object.defineProperty.call)(null, Object, "create", {value: customCreate});',
    ),
  ).toEqual([
    expect.objectContaining({
      kind: "opaque",
      path: ["intrinsic", "Object", "defineProperty", "call"],
    }),
  ]);
});

it.each([
  ["get.call(null)", "get"],
  ["get.apply(null,[])", "get"],
  ["get.call.call(other,null)", "get.call"],
  ["get.apply.call(other,null,[])", "get.apply"],
  ["(0,get.call)(null)", undefined],
])(
  "retains one generic callable receiver transition through %s",
  (source, name) => {
    const parsed = parseJavaScriptSource(source);
    const statement = parsed?.program.body[0];
    if (
      !t.isExpressionStatement(statement) ||
      !t.isCallExpression(statement.expression)
    )
      throw new Error("Expected source invocation fixture");
    const call = statement.expression;
    const method = javaScriptGenericInvocationMethod(call.callee);
    const context = javaScriptSourceInvocationContext(call);
    const result =
      method === undefined
        ? undefined
        : resolveJavaScriptGenericInvocation(method, context);
    expect(result?.callable).toEqual(
      name === undefined
        ? undefined
        : name.includes(".")
          ? expect.objectContaining({
              type: "MemberExpression",
              object: expect.objectContaining({ name: "get" }),
              property: expect.objectContaining({ name: name.split(".")[1] }),
            })
          : expect.objectContaining({ type: "Identifier", name }),
    );
    if (name?.includes("."))
      expect(result?.context.receiver).toEqual(
        expect.objectContaining({ type: "Identifier", name: "other" }),
      );
  },
);
