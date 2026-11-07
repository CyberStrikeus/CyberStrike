import * as t from "@babel/types";
import { describe, expect, it } from "vitest";

import {
  semanticBindingAtRead,
  semanticMutationInitializers,
  semanticTopLevelEffectFollowsCapture,
} from "./javascriptSemanticMutationInitializers.js";
import type { JavaScriptSemanticBindingState } from "./javascriptSemanticState.js";
import { traverseJavaScriptAst } from "./javascriptSemanticTraversal.js";
import { parseJavaScriptSource } from "./javascriptSourceParser.js";

it.each([
  ["public value", false, false],
  ["private value", false, false],
  ["accessor value", false, false],
  ["public value", true, true],
  ["private value", true, true],
  ["accessor value", true, true],
  ["public key", false, true],
  ["accessor key", false, true],
  ["method key", false, true],
] as const)(
  "orders %s reads with static=%s only when evaluated at class definition",
  (kind, isStatic, ordered) => {
    const initializer = t.numericLiteral(1);
    const read = t.identifier("child");
    const inKey = kind.endsWith("key");
    const key = inKey ? read : t.identifier("field");
    const value = inKey ? t.numericLiteral(0) : read;
    const field = kind.startsWith("private")
      ? t.classPrivateProperty(t.privateName(t.identifier("field")), value)
      : kind.startsWith("accessor")
        ? t.classAccessorProperty(key, value, null, null, inKey)
        : kind.startsWith("method")
          ? t.classMethod("method", key, [], t.blockStatement([]), inKey)
          : t.classProperty(key, value, null, null, inKey);
    field.static = isStatic;
    const program = t.program([
      t.variableDeclaration("let", [
        t.variableDeclarator(t.identifier("child"), initializer),
      ]),
      t.classDeclaration(t.identifier("Stop"), null, t.classBody([field])),
    ]);
    const parents = new WeakMap<t.Node, t.Node>();
    traverseJavaScriptAst(program, {
      enter: (node, parent) => {
        if (parent !== null) parents.set(node, parent);
      },
    });
    const binding: JavaScriptSemanticBindingState = {
      bindingId: "program:child",
      scopeId: "program",
      name: "child",
      kind: "variable",
      declarationKinds: new Set(["let"]),
      mutable: true,
      memberWrites: [],
      escapedPaths: [],
      definitions: [],
      initializers: [{ node: initializer, projection: [] }],
      referenceInitializers: [],
      directOrigins: [],
      runtimeImport: false,
    };
    expect(semanticBindingAtRead(binding, read, parents).status).toBe(
      ordered ? "ordered" : "unresolved",
    );
    expect(
      semanticTopLevelEffectFollowsCapture(initializer, read, parents),
    ).toBe(ordered);
  },
);

it("orders computed method key reads evaluated during object literal definition", () => {
  const initializer = t.numericLiteral(1);
  const read = t.identifier("child");
  const method = t.objectMethod("method", read, [], t.blockStatement([]), true);
  const program = t.program([
    t.variableDeclaration("let", [
      t.variableDeclarator(t.identifier("child"), initializer),
    ]),
    t.variableDeclaration("const", [
      t.variableDeclarator(t.identifier("obj"), t.objectExpression([method])),
    ]),
  ]);
  const parents = new WeakMap<t.Node, t.Node>();
  traverseJavaScriptAst(program, {
    enter: (node, parent) => {
      if (parent !== null) parents.set(node, parent);
    },
  });
  expect(semanticTopLevelEffectFollowsCapture(initializer, read, parents)).toBe(
    true,
  );
});

describe("parameter references copied into function body bindings", () => {
  it.each([
    ["var arg = []; mutate(arg);", false],
    ["mutate(arg); var arg = [];", true],
    ["if (flag) { var arg = []; } mutate(arg);", true],
  ])(
    "retains the entry reference only when still reachable: %s",
    (body, retained) => {
      const program = parseJavaScriptSource(
        `function result(arg = source) { ${body} }`,
      )?.program;
      const callable = program?.body[0];
      if (program === undefined || !t.isFunctionDeclaration(callable))
        throw new Error("Expected a parsed function declaration");
      const parameter = callable.params[0];
      if (!t.isAssignmentPattern(parameter) || !t.isIdentifier(parameter.left))
        throw new Error("Expected the source parameter binding");
      const parents = new WeakMap<t.Node, t.Node>();
      let replacement: t.Node | undefined;
      let mutation: t.Node | undefined;
      traverseJavaScriptAst(program, {
        enter: (node, parent) => {
          if (parent !== null) parents.set(node, parent);
          if (t.isVariableDeclarator(node) && node.init !== null)
            replacement = node.init;
          if (t.isCallExpression(node)) mutation = node;
        },
      });
      if (replacement === undefined || mutation === undefined)
        throw new Error("Expected a body initializer and subsequent effect");
      const entry = {
        node: parameter.left,
        projection: [],
        entryBody: callable.body,
      };
      const assigned = { node: replacement, projection: [] };
      const binding: JavaScriptSemanticBindingState = {
        bindingId: "body:arg",
        scopeId: "body",
        name: "arg",
        kind: "variable",
        declarationKinds: new Set(),
        mutable: true,
        memberWrites: [],
        escapedPaths: [],
        definitions: [],
        initializers: [entry, assigned],
        referenceInitializers: [],
        directOrigins: [],
        runtimeImport: false,
      };
      const origins = semanticMutationInitializers(binding, mutation, parents);
      expect(origins.initializers.includes(entry)).toBe(retained);
      expect(origins.initializers).toContain(assigned);
    },
  );
});
