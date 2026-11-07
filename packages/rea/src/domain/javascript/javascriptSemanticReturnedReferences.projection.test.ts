import * as t from "@babel/types";
import { expect, it } from "vitest";

import { indexJavaScriptBindingsSteps } from "./javascriptSemanticAnalysis.js";
import { parseJavaScriptSource } from "./javascriptSourceParser.js";
import { createSemanticReturnedReferences } from "./javascriptSemanticReturnedReferences.js";
import { completeSemanticSteps } from "./javascriptSemanticTraversal.js";

const indexed = (source: string) => {
  const parsed = parseJavaScriptSource(
    source,
    "returned-reference-projection.js",
  );
  if (parsed === null) throw new Error("Expected valid fixture");
  const state = completeSemanticSteps(
    indexJavaScriptBindingsSteps(parsed.program),
  );
  return { parsed, state };
};

const callReads = (program: t.Program, name: string): t.Identifier[] => {
  const reads: t.Identifier[] = [];
  t.traverseFast(program, (node) => {
    if (t.isCallExpression(node) && t.isIdentifier(node.callee, { name }))
      reads.push(node.callee);
  });
  return reads;
};

const callCallees = (program: t.Program, sourceName: string): t.Node[] => {
  const callees: t.Node[] = [];
  t.traverseFast(program, (node) => {
    if (!t.isCallExpression(node)) return;
    let root = node.callee;
    while (t.isMemberExpression(root)) root = root.object;
    if (t.isIdentifier(root, { name: sourceName })) callees.push(node.callee);
  });
  return callees;
};

const returnedExpression = (program: t.Program, name: string): t.Node => {
  let found: t.Node | undefined;
  t.traverseFast(program, (node) => {
    if (
      found === undefined &&
      t.isFunctionDeclaration(node) &&
      node.id?.name === name
    )
      t.traverseFast(node.body, (child) => {
        if (
          found === undefined &&
          t.isReturnStatement(child) &&
          child.argument !== null
        )
          found = child.argument;
      });
  });
  if (found === undefined)
    throw new Error(`Missing return expression in ${name}`);
  return found;
};

const resultIdentifier = (program: t.Program, name: string): t.Identifier => {
  let found: t.Identifier | undefined;
  t.traverseFast(program, (node) => {
    if (
      found === undefined &&
      ((t.isReturnStatement(node) && node.argument !== null) ||
        (t.isYieldExpression(node) && node.argument !== null))
    )
      t.traverseFast(node.argument, (child) => {
        if (found === undefined && t.isIdentifier(child, { name }))
          found = child;
      });
  });
  if (found === undefined) throw new Error(`Missing result expression ${name}`);
  return found;
};

it("keeps returned-reference targets at the source read position", () => {
  const { parsed, state } = indexed(`
    function beforeTarget() { return beforeResult; }
    function afterTarget() { return afterResult; }
    function choose() {
      let callback = beforeTarget;
      callback();
      callback = afterTarget;
      callback();
    }
  `);
  const [beforeRead, afterRead] = callReads(parsed.program, "callback");
  if (beforeRead === undefined || afterRead === undefined)
    throw new Error("Missing callback reads");
  const returnedReferences = createSemanticReturnedReferences(state);

  const before = returnedReferences(beforeRead);
  const after = returnedReferences(afterRead);

  expect(before.precision).toBe("exact");
  expect(before.references.map(({ node }) => node)).toEqual([
    returnedExpression(parsed.program, "beforeTarget"),
  ]);
  expect(after.precision).toBe("exact");
  expect(after.references.map(({ node }) => node)).toEqual([
    returnedExpression(parsed.program, "afterTarget"),
  ]);
});

it("resolves a finite object and array projection exactly", () => {
  const { parsed, state } = indexed(`
    function target() { return targetResult; }
    const box = { nested: [target] };
    const callback = box.nested[0];
    callback();
  `);
  const [read] = callReads(parsed.program, "callback");
  if (read === undefined) throw new Error("Missing callback read");

  const result = createSemanticReturnedReferences(state)(read);

  expect(result.precision).toBe("exact");
  expect(result.references.map(({ node }) => node)).toEqual([
    returnedExpression(parsed.program, "target"),
  ]);
});

it("reports conservative widening for a shrinking projection cycle", () => {
  const { parsed, state } = indexed(`
    function target() { return targetResult; }
    let cursor = { target };
    while (flag) cursor = { next: cursor, target };
    cursor.next.next.target();
  `);
  const [callee] = callCallees(parsed.program, "cursor");
  if (callee === undefined) throw new Error("Missing projected call");

  const result = createSemanticReturnedReferences(state)(callee);

  expect(result.precision).toBe("widened");
  expect(result.references.map(({ node }) => node)).toEqual([
    returnedExpression(parsed.program, "target"),
  ]);
});

it("widens a growing projection while retaining zero-depth and nested targets", () => {
  const { parsed, state } = indexed(`
    function zeroDepthTarget() { return zeroDepthResult; }
    function objectTarget() { return objectResult; }
    function arrayTarget() { return arrayResult; }
    function* generatorTarget() { yield* generatorResult; }
    const shape = {
      zero: zeroDepthTarget,
      nested: {
        object: objectTarget,
        array: [arrayTarget],
        class: class NestedTarget { method() { return classResult; } },
        generator: generatorTarget,
      },
    };
    let cursor = shape;
    function walk(flag) {
      while (flag) cursor = cursor.next;
      return cursor();
    }
    walk(true);
  `);
  const [read] = callReads(parsed.program, "cursor");
  if (read === undefined) throw new Error("Missing cursor read");

  const result = createSemanticReturnedReferences(state)(read);
  const expressions = result.references.map(({ node }) => node);

  expect(result.precision).toBe("widened");
  for (const name of ["zeroDepthTarget", "objectTarget", "arrayTarget"])
    expect(expressions).toContain(returnedExpression(parsed.program, name));
  expect(expressions).toContain(
    resultIdentifier(parsed.program, "classResult"),
  );
  const generatorResult = resultIdentifier(parsed.program, "generatorResult");
  expect(result.references).toContainEqual({
    node: generatorResult,
    projection: [null],
  });
});

it("widens a cycle that rewrites the path head while increasing its depth", () => {
  const { parsed, state } = indexed(`
    function target() { return targetResult; }
    let value = {};
    while (flag)
      value = {
        a: value.x.y,
        x: value.a.z,
        target,
      };
    value.a.b();
  `);
  const [callee] = callCallees(parsed.program, "value");
  if (callee === undefined) throw new Error("Missing projected call");

  const result = createSemanticReturnedReferences(state)(callee);

  expect(result.precision).toBe("widened");
  expect(result.references.map(({ node }) => node)).toContain(
    returnedExpression(parsed.program, "target"),
  );
});
