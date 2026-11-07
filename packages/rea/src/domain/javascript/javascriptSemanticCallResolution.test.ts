import * as t from "@babel/types";
import { expect, it, vi } from "vitest";

import {
  analyzeJavaScriptSemantics,
  indexJavaScriptBindingsSteps,
} from "./javascriptSemanticAnalysis.js";
import {
  resolveLocalCallables,
  type LocalCallableResolution,
} from "./javascriptSemanticCallResolution.js";
import { parseJavaScriptSource } from "./javascriptSourceParser.js";
import { createSemanticReturnedReferences } from "./javascriptSemanticReturnedReferences.js";
import { semanticBindingAtRead } from "./javascriptSemanticMutationInitializers.js";
import { traverseJavaScriptAst } from "./javascriptSemanticTraversal.js";

const indexed = (source: string) => {
  const parsed = parseJavaScriptSource(source, "callback.js");
  if (parsed === null) throw new Error("Expected valid callback fixture");
  const steps = indexJavaScriptBindingsSteps(parsed.program);
  let step = steps.next();
  while (step.done !== true) step = steps.next();
  const state = step.value;
  const callableById = new Map(
    state.callables.map((callable) => [callable.callableId, callable]),
  );
  const bindingCache = new WeakMap<t.Identifier, LocalCallableResolution>();
  return {
    state,
    callableById,
    bindingCache,
    resolve: (node: t.Node) =>
      resolveLocalCallables({
        node,
        state,
        callableById,
        bindingCache,
        seenInitializers: new Set(),
      }),
  };
};

it("orders exported callable initializers within their enclosing declaration", () => {
  const ir = analyzeJavaScriptSemantics(`
    function original() {}
    export const first = original, second = first;
    second();
    export const before = later, later = original;
    before();
  `);
  const original = ir.callables.find(({ name }) => name === "original");
  if (original === undefined) throw new Error("Missing original callable");
  expect(ir.callSites[0]).toMatchObject({
    resolution: "exact",
    calleeCallableIds: [original.callableId],
  });
  expect(ir.callSites[1]).toBeDefined();
  expect(ir.callSites[1]?.resolution).not.toBe("exact");
});

it.each([
  "if(flag)({make}={make:replacement});",
  "if(flag)[make]=[replacement];",
  "({make}={make:replacement});",
  "[make]=[replacement];",
])("does not prove the old callable after a projected write: %s", (write) => {
  const analysis = analyzeJavaScriptSemantics(
    `function original(){}function replacement(){}let make=original;make();${write}make();`,
  );
  const original = analysis.callables.find(({ name }) => name === "original");
  expect(original).toBeDefined();
  const [before, after] = analysis.callSites;
  expect(before).toMatchObject({
    resolution: "exact",
    calleeCallableIds: [original?.callableId],
  });
  expect(after).toBeDefined();
  expect(after?.resolution).not.toBe("exact");
  expect(analysis.frontiers).toContainEqual(
    expect.objectContaining({
      kind: "dynamic-call",
      location: after?.calleeLocation,
    }),
  );
});

it.each([
  "if(flag)({make}={make:replacement});",
  "if(flag)[make]=[replacement];",
])(
  "retains known callable candidates without claiming completeness: %s",
  (write) => {
    const context = indexed(
      `function original(){}function replacement(){}let make=original;${write}make();`,
    );
    const last = context.state.program.body.at(-1);
    if (!t.isExpressionStatement(last) || !t.isCallExpression(last.expression))
      throw new Error("Missing projected call");
    const original = context.state.callables.find(
      ({ name }) => name === "original",
    );
    expect(original).toBeDefined();
    expect(context.resolve(last.expression.callee)).toMatchObject({
      complete: false,
      callableIds: [original?.callableId],
    });
  },
);

it("retains selected callable keys without admitting an unrelated return", () => {
  const context = indexed(`
    const table = { x() { return {}; }, y() { return {}; }, z() { return module; } };
    const make = flag ? table.x : table.y;
    make();
  `);
  const last = context.state.program.body.at(-1);
  if (!t.isExpressionStatement(last) || !t.isCallExpression(last.expression))
    throw new Error("Missing selected call");
  const returns = createSemanticReturnedReferences(context.state)(
    last.expression.callee,
  ).references;
  expect(returns).toHaveLength(2);
  expect(returns.every(({ node }) => t.isObjectExpression(node))).toBe(true);
});

it("retains correlations between selected callable path segments", () => {
  const context = indexed(`
    const table = { a: { b() { return {}; }, d() { return module; } },
      c: { d() { return {}; }, b() { return module; } } };
    const make = flag ? table.a.b : table.c.d;
    make();
  `);
  const last = context.state.program.body.at(-1);
  if (!t.isExpressionStatement(last) || !t.isCallExpression(last.expression))
    throw new Error("Missing selected call");
  const returns = createSemanticReturnedReferences(context.state)(
    last.expression.callee,
  ).references;
  expect(returns).toHaveLength(2);
  expect(returns.every(({ node }) => t.isObjectExpression(node))).toBe(true);
});

it("bounds shared partial callback alias expansion by AST size", () => {
  const measure = (depth: number) => {
    const context =
      indexed(`function fallback(){return {member:1};} function choose(cb,flag){
      if(flag)cb=fallback;
      const a0=cb;
      ${Array.from({ length: depth }, (_, i) => `const a${i + 1}=flag?a${i}:a${i};`).join("")}
      return a${depth}();
    }`);
    const choose = context.state.program.body[1];
    if (!t.isFunctionDeclaration(choose)) throw new Error("Missing choose");
    const last = choose.body.body.at(-1);
    if (!t.isReturnStatement(last) || !t.isCallExpression(last.argument))
      throw new Error("Missing call");
    const reads = vi.spyOn(context.bindingCache, "get");
    const result = context.resolve(last.argument.callee);
    expect(result).toMatchObject({ complete: false });
    expect(result.callableIds).toHaveLength(1);
    const callReads = reads.mock.calls.length;
    const lookups = context.state.scopes.map((scope) =>
      vi.spyOn(scope.bindings, "get"),
    );
    try {
      expect(
        createSemanticReturnedReferences(context.state)(last.argument.callee)
          .references,
      ).toHaveLength(1);
      return {
        callReads,
        referenceReads: lookups.reduce(
          (total, lookup) => total + lookup.mock.calls.length,
          0,
        ),
      };
    } finally {
      for (const lookup of lookups) lookup.mockRestore();
    }
  };
  const small = measure(8);
  const large = measure(12);
  expect(small.callReads).toBeGreaterThan(0);
  expect(large.callReads).toBeLessThan(3 * small.callReads);
  expect(small.referenceReads).toBeGreaterThan(0);
  expect(large.referenceReads).toBeLessThan(3 * small.referenceReads);
});

it.each([
  ["if(flag){cb=fallback;cb();}", true],
  ["if(flag)cb=fallback;cb();", false],
  ["cb ||= fallback;cb();", false],
] as const)(
  "reports initializer coverage at the read: %s",
  (body, expected) => {
    const { state } = indexed(`function choose(cb,flag){${body}}`);
    const binding = [...state.bindingsById.values()].find(
      (binding) => binding.name === "cb",
    );
    if (binding === undefined) throw new Error("Missing cb binding");
    let reads = 0;
    traverseJavaScriptAst(state.program, {
      enter(node) {
        if (
          t.isCallExpression(node) &&
          t.isIdentifier(node.callee, { name: "cb" })
        ) {
          reads++;
          expect(
            semanticBindingAtRead(binding, node.callee, state.parentsByNode)
              .hasDefiniteInitializer,
          ).toBe(expected);
        }
      },
    });
    expect(reads).toBe(1);
  },
);

it("does not reuse a later resolved callback at an earlier read", () => {
  const context = indexed(
    `function fallback(){} function choose(cb){cb();cb=fallback;cb();}`,
  );
  const choose = context.state.program.body[1];
  if (!t.isFunctionDeclaration(choose)) throw new Error("Missing choose");
  const calls = choose.body.body.flatMap((statement) =>
    t.isExpressionStatement(statement) &&
    t.isCallExpression(statement.expression)
      ? [statement.expression.callee]
      : [],
  );
  const [before, after] = calls;
  if (before === undefined || after === undefined)
    throw new Error("Missing callback reads");
  expect(context.resolve(after)).toMatchObject({ complete: true });
  expect(context.resolve(before)).toMatchObject({
    complete: false,
    callableIds: [],
  });
  expect(context.resolve(after)).toMatchObject({ complete: true });
});

it("keeps a nested callback read uncertain across a later var initializer", () => {
  const context = indexed(
    `function target(){} function read(){cb();} read(); var cb=target;`,
  );
  const target = context.state.callables.find(
    (callable) => callable.name === "target",
  );
  let read: t.Identifier | undefined;
  traverseJavaScriptAst(context.state.program, {
    enter(node) {
      if (
        t.isCallExpression(node) &&
        t.isIdentifier(node.callee, { name: "cb" })
      )
        read = node.callee;
    },
  });
  if (target === undefined || read === undefined)
    throw new Error("Missing target or callback read");
  expect(context.resolve(read)).toMatchObject({
    callableIds: [target.callableId],
    complete: false,
  });
});

it("keeps same-activation calls after a var initializer resolved", () => {
  const context = indexed(`function target(){} var cb=target; cb();`);
  let read: t.Identifier | undefined;
  traverseJavaScriptAst(context.state.program, {
    enter(node) {
      if (
        t.isCallExpression(node) &&
        t.isIdentifier(node.callee, { name: "cb" })
      )
        read = node.callee;
    },
  });
  if (read === undefined) throw new Error("Missing callback read");
  expect(context.resolve(read)).toMatchObject({
    callableIds: [context.state.callables[0]?.callableId],
    complete: true,
  });
});

it("keeps a hoisted function declaration resolved from a nested read", () => {
  const context = indexed(
    `function read(){target();} read(); function target(){}`,
  );
  const target = context.state.callables.find(
    (callable) => callable.name === "target",
  );
  let read: t.Identifier | undefined;
  traverseJavaScriptAst(context.state.program, {
    enter(node) {
      if (
        t.isCallExpression(node) &&
        t.isIdentifier(node.callee, { name: "target" })
      )
        read = node.callee;
    },
  });
  if (target === undefined || read === undefined)
    throw new Error("Missing target or nested call");
  expect(context.resolve(read)).toMatchObject({
    callableIds: [target.callableId],
    complete: true,
  });
});

it("does not infer hoisting for a conditional function declaration", () => {
  const context = indexed(
    `if (flag) { function target(){} } function read(){target();} read();`,
  );
  let read: t.Identifier | undefined;
  traverseJavaScriptAst(context.state.program, {
    enter(node) {
      if (
        t.isCallExpression(node) &&
        t.isIdentifier(node.callee, { name: "target" })
      )
        read = node.callee;
    },
  });
  if (read === undefined) throw new Error("Missing conditional function read");
  expect(context.resolve(read)).toMatchObject({ complete: false });
});

it("uses class declaration order instead of a stable initializer shortcut", () => {
  const before = indexed("class Target {} new Target();");
  const after = indexed("new Target(); class Target {}");
  const exported = indexed("export class Target {} new Target();");
  const callTarget = (context: ReturnType<typeof indexed>) => {
    let read: t.Identifier | undefined;
    traverseJavaScriptAst(context.state.program, {
      enter(node) {
        if (
          t.isNewExpression(node) &&
          t.isIdentifier(node.callee, { name: "Target" })
        )
          read = node.callee;
      },
    });
    if (read === undefined) throw new Error("Missing class constructor read");
    return context.resolve(read);
  };
  const beforeTarget = before.state.callables.find(
    (callable) => callable.name === "Target",
  );
  if (beforeTarget === undefined) throw new Error("Missing class target");
  expect(callTarget(before)).toMatchObject({
    callableIds: [beforeTarget.callableId],
    complete: true,
  });
  expect(callTarget(after)).toMatchObject({ complete: false });
  expect(callTarget(exported)).toMatchObject({ complete: true });
});

it.each([false, true])(
  "bounds separate branch assignments with intrinsic cycle=%s",
  (cyclic) => {
    const measure = (depth: number) => {
      const context = indexed(`function fallback(){return {};}
function choose(flag){let a0=${cyclic ? "flag?a0:{make:fallback}" : "{make:fallback}"};
${Array.from({ length: depth }, (_, i) => `let a${i + 1};if(flag)a${i + 1}=a${i};else a${i + 1}=a${i};`).join("")}
return a${depth}.make();}`);
      const choose = context.state.program.body[1];
      if (!t.isFunctionDeclaration(choose)) throw new Error("Missing choose");
      const last = choose.body.body.at(-1);
      if (!t.isReturnStatement(last) || !t.isCallExpression(last.argument))
        throw new Error("Missing call");
      const lookups = context.state.scopes.map((scope) =>
        vi.spyOn(scope.bindings, "get"),
      );
      try {
        expect(
          createSemanticReturnedReferences(context.state)(last.argument.callee)
            .references,
        ).toHaveLength(1);
        return lookups.reduce(
          (total, lookup) => total + lookup.mock.calls.length,
          0,
        );
      } finally {
        for (const lookup of lookups) lookup.mockRestore();
      }
    };
    const small = measure(8),
      large = measure(12);
    expect(small).toBeGreaterThan(0);
    expect(large).toBeLessThan(3 * small);
  },
);

it.each(["||=", "??="])(
  "retains definite assignment to an empty local: %s",
  (operator) => {
    const { state } = indexed(
      `function choose(){let cb;cb ${operator} fallback;cb();}`,
    );
    const binding = [...state.bindingsById.values()].find(
      (binding) => binding.name === "cb",
    );
    if (binding === undefined) throw new Error("Missing cb binding");
    let reads = 0;
    traverseJavaScriptAst(state.program, {
      enter(node) {
        if (
          t.isCallExpression(node) &&
          t.isIdentifier(node.callee, { name: "cb" })
        ) {
          reads++;
          expect(
            semanticBindingAtRead(binding, node.callee, state.parentsByNode)
              .hasDefiniteInitializer,
          ).toBe(true);
        }
      },
    });
    expect(reads).toBe(1);
  },
);

it("does not memoize alias cycle cuts across entry paths", () => {
  const context = indexed(
    `function fallback(){} let a,b; function setA(){a=flag?b:fallback;} function setB(){b=a;} a(); b();`,
  );
  const callees = context.state.program.body.flatMap((statement) =>
    t.isExpressionStatement(statement) &&
    t.isCallExpression(statement.expression)
      ? [statement.expression.callee]
      : [],
  );
  const fallback = context.state.callables.find(
    (callable) => callable.name === "fallback",
  );
  if (fallback === undefined) throw new Error("Missing fallback");
  for (const node of [...callees, ...callees].reverse()) {
    const warm = context.resolve(node);
    const cold = resolveLocalCallables({
      node,
      state: context.state,
      callableById: context.callableById,
      bindingCache: new WeakMap(),
      seenInitializers: new Set(),
    });
    expect(warm).toEqual(cold);
    expect(warm).toMatchObject({
      complete: false,
      cycleDependent: true,
      callableIds: [fallback.callableId],
    });
  }
});

const meshLookups = (writes: number): number => {
  const source = `function f(){} function g(){} let a=f,b=g;
function run(){${Array.from({ length: writes }, (_, index) =>
    index % 2 === 0 ? "a=b;" : "b=a;",
  ).join("")} a();}`;
  const context = indexed(source);
  const run = context.state.program.body[3];
  if (!t.isFunctionDeclaration(run)) throw new Error("Missing run");
  const statement = run.body.body.at(-1);
  if (
    !t.isExpressionStatement(statement) ||
    !t.isCallExpression(statement.expression)
  )
    throw new Error("Missing mesh call");
  const lookups = vi.spyOn(context.bindingCache, "get");
  const result = context.resolve(statement.expression.callee);
  expect(result).toMatchObject({ complete: false, cycleDependent: true });
  expect(
    result.callableIds.map((id) => context.callableById.get(id)?.name).sort(),
  ).toEqual(["f", "g"]);
  return lookups.mock.calls.length;
};

it("closes cycles at full-binding reads with bounded lookup growth", () => {
  const six = meshLookups(6);
  const eight = meshLookups(8);
  const ten = meshLookups(10);
  const twelve = meshLookups(12);
  expect(six).toBeGreaterThan(0);
  expect(eight).toBeLessThan(3 * six);
  expect(ten).toBeLessThan(3 * eight);
  expect(twelve).toBeLessThan(3 * ten);
});

it("resolves calls to preceding exported variable initializers and computed method keys", () => {
  const context = indexed(`
    export const pick = () => "target";
    const obj = { [pick()]() { return 1; } };
    pick();
  `);
  const objStatement = context.state.program.body[1];
  if (
    !t.isVariableDeclaration(objStatement) ||
    !t.isVariableDeclarator(objStatement.declarations[0]) ||
    !t.isObjectExpression(objStatement.declarations[0].init)
  )
    throw new Error("Missing obj declaration");
  const method = objStatement.declarations[0].init.properties[0];
  if (!t.isObjectMethod(method) || !t.isCallExpression(method.key))
    throw new Error("Missing computed key call");
  const target = context.state.callables.find(
    (callable) => callable.name === "pick",
  );
  if (target === undefined) throw new Error("Missing target");
  expect(context.resolve(method.key.callee)).toMatchObject({
    complete: true,
    callableIds: [target.callableId],
  });

  const callStatement = context.state.program.body[2];
  if (
    !t.isExpressionStatement(callStatement) ||
    !t.isCallExpression(callStatement.expression)
  )
    throw new Error("Missing pick call");
  expect(context.resolve(callStatement.expression.callee)).toMatchObject({
    complete: true,
    callableIds: [target.callableId],
  });
});

it("resolves calls in computed method keys before subsequent pattern writes", () => {
  const analysis = analyzeJavaScriptSemantics(`
    function original() {}
    function replacement() {}
    let make = original;
    const obj = { [make()]() { return 1; } };
    if (flag) [make] = [replacement];
  `);
  const original = analysis.callables.find(({ name }) => name === "original");
  expect(original).toBeDefined();
  expect(analysis.callSites[0]).toMatchObject({
    resolution: "exact",
    calleeCallableIds: [original?.callableId],
  });
});
