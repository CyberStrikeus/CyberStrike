import { expect, it, vi } from "vitest";
import * as t from "@babel/types";
import { parseJavaScriptSource } from "./javascriptSourceParser.js";
import { indexJavaScriptBindingsSteps } from "./javascriptSemanticAnalysis.js";
import {
  completeSemanticSteps,
  traverseJavaScriptAst,
} from "./javascriptSemanticTraversal.js";
import { JavaScriptSymbolicBindings } from "./javascriptSymbolicBindings.js";
import {
  symbolicTruth,
  symbolicVariants,
  type SymbolicValue,
} from "./javascriptSymbolicValues.js";

const resolverFor = (source: string) => {
  const parsed = parseJavaScriptSource(source);
  if (parsed === null) throw new Error("symbolic source fixture did not parse");
  const state = completeSemanticSteps(
    indexJavaScriptBindingsSteps(parsed.program),
  );
  return {
    parsed,
    resolver: new JavaScriptSymbolicBindings(state, parsed.program),
  };
};

/** Parse a fixture and collect the first argument of each inspect call. */
const inspectFixture = (
  source: string,
  evaluate: (
    resolver: JavaScriptSymbolicBindings,
    node: t.CallExpression,
  ) => SymbolicValue = (resolver, node) => resolver.evaluate(node.arguments[0]),
) => {
  const { parsed, resolver } = resolverFor(source);
  const values: SymbolicValue[] = [];
  traverseJavaScriptAst(parsed.program, {
    enter: (node) => {
      if (
        t.isCallExpression(node) &&
        t.isIdentifier(node.callee, { name: "inspect" })
      ) {
        values.push(evaluate(resolver, node));
      }
    },
  });
  return { parsed, resolver, values };
};

const inspectedValues = (source: string): SymbolicValue[] =>
  inspectFixture(source).values;

const inspectOne = (source: string): SymbolicValue => {
  const values = inspectedValues(source);
  expect(values).toHaveLength(1);
  const value = values[0];
  if (value === undefined) throw new Error("inspect call result missing");
  return value;
};

it("substitutes numeric modules, named exports and captured wrapper arguments", () => {
  const { resolver, values } = inspectFixture(`(() => {
    const modules = {
      4(module) { module.exports = require("electron"); },
      8(module, exports, load) {
        const electron = load(4);
        exports.sender = function(channel) { return (...args) => electron.ipcRenderer.send(channel,...args); };
      },
      12(module, exports, load) { const helpers = load(8); const api = {copy: helpers.sender("test:copy")}; inspect(api.copy); }
    };
    function load(id) { const m = {exports:{}}; modules[id](m,m.exports,load); return m.exports; }
    load(12);
  })();`);
  expect(values).toHaveLength(1);
  const value = values[0];
  if (value === undefined) throw new Error("inspect call result missing");
  const fn = symbolicVariants(value).find((v) => v.kind === "function");
  expect(fn?.kind).toBe("function");
  if (fn?.kind !== "function" || !t.isCallExpression(fn.node.body))
    throw new Error("closure missing");
  const env = resolver.bind(fn, []);
  expect(resolver.evaluate(fn.node.body.callee, env)).toEqual({
    kind: "external",
    path: ["electron", "ipcRenderer", "send"],
  });
  expect(resolver.arguments(fn.node.body, env)[0]).toEqual({
    kind: "literal",
    value: "test:copy",
  });
});

it("checks block lexical initializers against their containing function call", () => {
  const { parsed, resolver } = resolverFor(`run();
    function run() { { const value = require("electron"); inspect(value); } }`);
  let resolved: SymbolicValue | undefined;
  traverseJavaScriptAst(parsed.program, {
    enter: (node) => {
      if (
        !t.isCallExpression(node) ||
        !t.isIdentifier(node.callee, { name: "inspect" })
      )
        return;
      const fn = parsed.program.body.find(
        (statement): statement is t.FunctionDeclaration =>
          t.isFunctionDeclaration(statement) && statement.id?.name === "run",
      );
      if (!fn) throw new Error("run declaration missing");
      const call = parsed.program.body[0];
      if (
        !t.isExpressionStatement(call) ||
        !t.isCallExpression(call.expression)
      )
        throw new Error("run invocation missing");
      resolved = resolver.evaluate(
        node.arguments[0],
        resolver.bind(
          {
            kind: "function",
            node: fn,
            environment: { values: new Map() },
            origins: [],
          },
          [],
          call.expression,
        ),
      );
    },
  });
  expect(resolved).toEqual({ kind: "external", path: ["electron"] });
});

it("keeps same-factory reads before initialization unresolved", () => {
  const { values, resolver } = inspectFixture(
    `(() => {
    const modules = { 9(module) { inspect(value); const value = require("electron"); } };
    function load(id) { const m={exports:{}}; modules[id](m); return m.exports; }
    load(9);
  })();`,
    (bindings, node) =>
      bindings.evaluate(node.arguments[0], bindings.environmentAt(node)),
  );
  expect(values).toHaveLength(1);
  const resolved = values[0];
  if (resolved === undefined) throw new Error("inspect call result missing");
  expect(resolved).toEqual({
    kind: "unknown",
    reason: "initializer not available at this read",
  });
  expect(resolver.unresolved).toBe(true);
});

it("invalidates a bootstrap module slot mutated through an alias", () => {
  const values = inspectedValues(`(() => {
    const modules = {
      1(module) { module.exports = require("electron"); },
      2(module, exports, load) { inspect(load(1)); inspect(load(3)); },
      3(module) { module.exports = require("electron"); }
    };
    const table = modules;
    function load(id) { const m = {exports:{}}; modules[id](m,m.exports,load); return m.exports; }
    table[1] = function(module) { module.exports = require("other"); };
    delete table[3];
    load(2);
  })();`);
  expect(values).toHaveLength(2);
  expect(values).toEqual([
    expect.objectContaining({ kind: "unknown" }),
    expect.objectContaining({ kind: "unknown" }),
  ]);
});

it.each([
  [
    "destructuring assignment",
    `[table[1]] = [function(module) { module.exports = require("other"); }];`,
  ],
  ["for-of head", `for (table[1] of replacements) {}`],
  [
    "wrapped assignment",
    `(table as never)[1] = function(module) { module.exports = require("other"); };`,
  ],
])(
  "invalidates a bootstrap module slot overwritten through %s",
  (_name, write) => {
    const values = inspectedValues(`(() => {
    const modules = {
      1(module) { module.exports = require("electron"); },
      2(module, exports, load) { inspect(load(1)); }
    };
    const table = modules;
    function load(id) { const m = {exports:{}}; modules[id](m,m.exports,load); return m.exports; }
    ${write}
    load(2);
  })();`);
    expect(values).toHaveLength(1);
    expect(values[0]).toEqual(expect.objectContaining({ kind: "unknown" }));
  },
);

it.each([
  `const electron=require("electron"); const ipc=electron.ipcMain; ipc.handle=()=>null; inspect(electron.ipcMain.handle);`,
  `require("electron").ipcMain.handle=()=>null; inspect(require("electron").ipcMain.handle);`,
  `const electron=require("electron"); ({ipcMain:electron.ipcMain}=replacement); inspect(electron.ipcMain);`,
  `const electron=require("electron"); for(electron.ipcMain of replacements){} inspect(electron.ipcMain);`,
])("invalidates visibly overwritten Electron members: %s", (source) => {
  const values = inspectedValues(source);
  expect(values).toHaveLength(1);
  expect(values[0]?.kind).toBe("unknown");
});

it("does not substitute a lexical or var initializer before its source write", () => {
  for (const source of [
    `inspect(value); const value = require("electron");`,
    `function run() { inspect(value); var value = require("electron"); }`,
  ]) {
    const values = inspectedValues(source);
    expect(values).toHaveLength(1);
    const value = values[0];
    if (value === undefined) throw new Error("inspect call result missing");
    expect(value).toMatchObject({ kind: "unknown" });
  }
});

it("keeps function declarations hoisted and checks closures at invocation", () => {
  const inspected = inspectedValues(`
    inspect(read);
    function read() { return value; }
    function localRead() {
      const local = require("electron");
      return local;
    }
    const closure = () => value;
    const value = require("electron");
    inspect(closure());
    inspect(localRead());
  `);
  expect(inspected[0]).toMatchObject({ kind: "function" });
  expect(inspected[1]).toEqual({ kind: "external", path: ["electron"] });
  expect(inspected[2]).toEqual({ kind: "external", path: ["electron"] });
});

it("keeps a synchronous cross-function callback before initialization unresolved", () => {
  const { parsed, resolver } = resolverFor(`function outer() {
      const value = require("electron");
      return use(() => value);
    }
    function use(callback) { return callback(); }
    inspect(outer());`);
  const outer = parsed.program.body.find(
    (statement): statement is t.FunctionDeclaration =>
      t.isFunctionDeclaration(statement) && statement.id?.name === "outer",
  );
  const outerCall = parsed.program.body.find(
    (statement): statement is t.ExpressionStatement =>
      t.isExpressionStatement(statement) &&
      t.isCallExpression(statement.expression) &&
      t.isIdentifier(statement.expression.callee, { name: "inspect" }),
  );
  if (!outer || !outerCall || !t.isCallExpression(outerCall.expression))
    throw new Error("outer fixture missing");
  const invocation = outer.body.body.find(
    (statement): statement is t.ReturnStatement =>
      t.isReturnStatement(statement),
  );
  if (!invocation || !t.isCallExpression(invocation.argument))
    throw new Error("synchronous callback call missing");
  const result = resolver.evaluate(
    invocation.argument,
    resolver.bind(
      {
        kind: "function",
        node: outer,
        environment: { values: new Map() },
        origins: [],
      },
      [],
      outerCall.expression,
    ),
  );
  expect(result).toMatchObject({ kind: "unknown" });
});

it("uses completed activation provenance for a returned closure", () => {
  const result = inspectOne(`inspect(use(outer()));
    function use(callback) { return callback(); }
    function outer() {
      const value = require("electron");
      return () => value;
    }`);
  expect(result).toEqual({ kind: "external", path: ["electron"] });
});

it("does not treat statements after a returned closure as initialized", () => {
  const result = inspectOne(`inspect(outer()());
    function outer() {
      return () => value;
      const value = require("electron");
    }`);
  expect(result).toMatchObject({ kind: "unknown" });
});

it("does not treat statements after a returned module factory as initialized", () => {
  const result = inspectOne(`(() => {
    const modules = {
      5(module, exports) {
        exports.read = () => electron;
        return;
        const electron = require("electron");
      },
      9(module, exports, load) { const helper = load(5); inspect(helper.read()); }
    };
    function load(id) { const m={exports:{}}; modules[id](m,m.exports,load); return m.exports; }
    load(9);
  })();`);
  expect(result).toMatchObject({ kind: "unknown" });
});

it("retains the guard on a factory's completed fallthrough activation", () => {
  const value = inspectOne(`(() => {
    const modules = {
      5(module, exports) {
        { if (flag) return; }
        const electron = require("electron");
        exports.read = () => electron;
      },
      9(module, exports, load) { inspect(load(5).read()); }
    };
    function load(id) { const m={exports:{}}; modules[id](m,m.exports,load); return m.exports; }
    load(9);
  })();`);
  const electron = symbolicVariants(value).filter(
    (variant) => variant.kind === "external",
  );
  expect(electron).toHaveLength(1);
  expect(electron[0]).toMatchObject({
    path: ["electron"],
    conditions: expect.arrayContaining([
      {
        node: expect.objectContaining({ type: "Identifier", name: "flag" }),
        positive: false,
      },
    ]),
  });
  expect(
    symbolicVariants(value).some((variant) => variant.kind === "unknown"),
  ).toBe(true);
});

it("shares completed factory control flow across repeated loads within one analysis", () => {
  const { parsed, resolver } = resolverFor(`(() => {
    const modules = {
      5(module, exports) { if (flag) return; exports.value = 42; },
      9(module, exports, load) { ${"inspect(load(5));".repeat(64)} }
    };
    function load(id) { const m={exports:{}}; modules[id](m,m.exports,load); return m.exports; }
    load(9);
  })();`);
  const evaluated = vi.spyOn(resolver, "evaluate");
  const results: SymbolicValue[] = [];
  traverseJavaScriptAst(parsed.program, {
    enter: (node) => {
      if (
        t.isCallExpression(node) &&
        t.isIdentifier(node.callee, { name: "inspect" })
      )
        results.push(resolver.evaluate(node.arguments[0]));
    },
  });
  expect(results).toHaveLength(64);
  const variants = symbolicVariants(results[0]!);
  expect(variants).toHaveLength(2);
  expect(variants).toEqual(
    expect.arrayContaining(
      [true, false].map((positive) =>
        expect.objectContaining({
          kind: "namespace",
          conditions: expect.arrayContaining([
            {
              node: expect.objectContaining({
                type: "Identifier",
                name: "flag",
              }),
              positive,
            },
          ]),
        }),
      ),
    ),
  );
  for (const result of results) {
    const actual = symbolicVariants(result);
    expect(actual).toHaveLength(variants.length);
    actual.forEach((variant, index) => expect(variant).toBe(variants[index]));
  }
  expect(
    evaluated.mock.calls.filter(([node]) =>
      t.isIdentifier(node, { name: "flag" }),
    ),
  ).toHaveLength(1);
  expect(resolver.truncated).toBe(false);
});

it("bounds predicate expansion across many conditional factory exits", () => {
  const { resolver, values } = inspectFixture(`(() => {
    const modules = {
      5(module, exports) { ${"if (flag) return;".repeat(1_600)} exports.value = 42; },
      9(module, exports, load) { inspect(load(5)); }
    };
    function load(id) { const m={exports:{}}; modules[id](m,m.exports,load); return m.exports; }
    load(9);
  })();`);
  expect(resolver.truncated).toBe(true);
  expect(values.flatMap(symbolicVariants)).toContainEqual(
    expect.objectContaining({
      kind: "unknown",
      reason: expect.stringContaining("resource limit"),
    }),
  );
});

it("does not borrow an unrelated activation's namespace read boundary", () => {
  const { parsed, resolver, values } = inspectFixture(`(() => {
    const modules = {5(module,exports){exports.stop=true;inspect(exports);if(exports.stop)return;}};
    function load(id){const m={exports:{}};modules[id](m,m.exports,load);return m.exports;}
    load(5);
  })();`);
  const namespace = values[0];
  if (namespace?.kind !== "namespace")
    throw new Error("namespace fixture missing");
  let read: t.MemberExpression | undefined;
  traverseJavaScriptAst(parsed.program, {
    enter: (node) => {
      if (t.isIfStatement(node) && t.isMemberExpression(node.test))
        read = node.test;
    },
  });
  if (read === undefined) throw new Error("namespace read fixture missing");
  expect(
    resolver.property(namespace, "stop", {
      node: read,
      environment: namespace.environment,
    }),
  ).toMatchObject({ kind: "literal", value: true });
  expect(
    resolver.property(namespace, "stop", {
      node: read,
      environment: { ...namespace.environment, activation: {} },
    }),
  ).toMatchObject({
    kind: "unknown",
    reason: "module export read boundary is unavailable",
  });
  expect(resolver.truncated).toBe(false);
});

it("treats known symbolic records and loaders as truthy", () => {
  expect(symbolicTruth({ kind: "record", values: new Map() })).toBe(true);
  expect(symbolicTruth({ kind: "loader", modules: new Map() })).toBe(true);
  expect(
    symbolicTruth({
      kind: "union",
      values: [
        { kind: "record", values: new Map() },
        { kind: "loader", modules: new Map() },
      ],
    }),
  ).toBe(true);
});

it("retains branch predicates on conditionally selected wrapper functions", () => {
  const value = inspectOne(`
    const selected = enabled
      ? () => navigator.clipboard.writeText("yes")
      : () => navigator.clipboard.writeText("no");
    inspect(selected);
  `);
  const functions = symbolicVariants(value).filter(
    (candidate) => candidate.kind === "function",
  );
  expect(functions).toHaveLength(2);
  expect(functions.map((fn) => fn.conditions?.[0]?.positive)).toEqual([
    true,
    false,
  ]);
});

it("retains fallthrough return guards after a one-sided early return", () => {
  const value = inspectOne(`
    function choose() {
      if (enabled) return () => navigator.clipboard.writeText("early");
      return () => navigator.clipboard.writeText("late");
    }
    inspect(choose());
  `);
  const functions = symbolicVariants(value).filter(
    (candidate) => candidate.kind === "function",
  );
  expect(functions).toHaveLength(2);
  expect(functions[0]).toMatchObject({ conditions: [{ positive: true }] });
  expect(functions[1]).toMatchObject({ conditions: [{ positive: false }] });
});

it("composes fallthrough guards across successive conditional returns", () => {
  const value = inspectOne(`
    function choose() {
      if (first) return () => navigator.clipboard.writeText("first");
      if (second) return () => navigator.clipboard.writeText("second");
      return () => navigator.clipboard.writeText("last");
    }
    inspect(choose());
  `);
  const functions = symbolicVariants(value).filter(
    (candidate) => candidate.kind === "function",
  );
  expect(functions).toHaveLength(3);
  expect(functions[0]?.conditions?.map(({ positive }) => positive)).toEqual([
    true,
  ]);
  expect(functions[1]?.conditions?.map(({ positive }) => positive)).toEqual([
    false,
    true,
  ]);
  expect(functions[2]?.conditions?.map(({ positive }) => positive)).toEqual([
    false,
    false,
  ]);
});

it.each([
  ["while", 'inspect((() => { while (flag) { return "loop"; } })());'],
  ["for", 'inspect((() => { for (;;) { return "forever"; } })());'],
  ["try", 'inspect((() => { try { return "try"; } finally {} })());'],
  [
    "switch",
    'inspect((() => { switch (x) { default: return "switch"; } })());',
  ],
])(
  "keeps unsupported %s return control flow explicitly unknown",
  (_name, source) => {
    const value = inspectOne(source);
    expect(
      symbolicVariants(value).some((variant) => variant.kind === "unknown"),
    ).toBe(true);
    expect(value).not.toEqual({ kind: "literal", value: undefined });
  },
);

it("preserves later returns with unresolved conditions after unsupported return flow", () => {
  const variants = symbolicVariants(
    inspectOne(`inspect((() => {
      while (flag) { return "inside"; }
      return "after";
    })());`),
  );

  expect(variants.some((variant) => variant.kind === "unknown")).toBe(true);
  expect(variants).toContainEqual(
    expect.objectContaining({
      kind: "literal",
      value: "after",
      conditionUnresolved: true,
    }),
  );
});

it("does not treat loops without owned returns as unknown return flow", () => {
  expect(
    inspectOne(`inspect((() => {
      while (flag) { work(); }
      return "after";
    })());`),
  ).toEqual({ kind: "literal", value: "after" });
});

it("does not treat nested-function returns as wrapper return flow", () => {
  expect(
    inspectOne(`inspect((() => {
      try { function nested() { return "inner"; } }
      catch {}
      return "outer";
    })());`),
  ).toEqual({ kind: "literal", value: "outer" });
});

it("marks return guards unresolved when a nested join cannot be represented", () => {
  const value = inspectOne(`
    function choose() {
      if (enabled) {
        if (other) return () => navigator.clipboard.writeText("early");
      }
      return () => navigator.clipboard.writeText("late");
    }
    inspect(choose());
  `);
  const functions = symbolicVariants(value).filter(
    (candidate) => candidate.kind === "function",
  );
  expect(functions).toHaveLength(2);
  expect(functions[1]).toMatchObject({ conditionUnresolved: true });
});

it.each([
  [
    "duplicate literal keys use the last value",
    `const object = { value: "first", value: "last" }; inspect(object.value);`,
    { kind: "literal", value: "last" },
  ],
  [
    "a final accessor is unknown",
    `const object = { value: "first", get value() { return "accessor"; } }; inspect(object.value);`,
    { kind: "unknown", reason: "accessor property" },
  ],
  [
    "a later literal overwrites an accessor",
    `const object = { get value() { return "accessor"; }, value: "last" }; inspect(object.value);`,
    { kind: "literal", value: "last" },
  ],
  [
    "a later unknown computed key can overwrite an earlier value",
    `const object = { value: "known", [dynamic]: "other" }; inspect(object.value);`,
    { kind: "unknown", reason: "dynamic property overwrite" },
  ],
  [
    "a later static key overrides an earlier unknown computed key",
    `const object = { [dynamic]: "other", value: "last" }; inspect(object.value);`,
    { kind: "literal", value: "last" },
  ],
  [
    "a known spread can override an earlier static value",
    `const replacement = { value: "spread" }; const object = { value: "first", ...replacement }; inspect(object.value);`,
    { kind: "literal", value: "spread" },
  ],
] as const)("resolves object properties when %s", (_case, source, expected) => {
  expect(inspectOne(source)).toEqual(expected);
});

it("propagates branch guards through object properties and function calls", () => {
  const inspected = inspectedValues(`
    const direct = flag
      ? { action: () => navigator.clipboard.writeText("direct-yes") }
      : { action: () => navigator.clipboard.writeText("direct-no") };
    function choose() {
      return flag
        ? () => navigator.clipboard.writeText("call-yes")
        : () => navigator.clipboard.writeText("call-no");
    }
    const called = { action: choose() };
    inspect(direct.action);
    inspect(called.action);
  `);
  expect(inspected).toHaveLength(2);
  for (const value of inspected) {
    const functions = symbolicVariants(value).filter(
      (candidate) => candidate.kind === "function",
    );
    expect(functions).toHaveLength(2);
    expect(functions.map((fn) => fn.conditions?.[0]?.positive)).toEqual([
      true,
      false,
    ]);
  }
});

it("completes a loaded module past a very large array without stack overflow", () => {
  const parsed = parseJavaScriptSource(`(() => {
    const modules = {
      4(module) {
        module.exports = { table: [0] };
        if (module) { return; }
        return;
      },
      8(module, exports, load) { const dep = load(4); inspect(dep); }
    };
    function load(id) { const m = {exports:{}}; modules[id](m,m.exports,load); return m.exports; }
    load(8);
  })();`);
  if (parsed === null) throw new Error("symbolic source fixture did not parse");
  const arrays: t.ArrayExpression[] = [];
  const bareReturns: t.ReturnStatement[] = [];
  let inspectCall: t.CallExpression | undefined;
  traverseJavaScriptAst(parsed.program, {
    enter: (node) => {
      if (t.isArrayExpression(node)) arrays.push(node);
      if (t.isReturnStatement(node) && node.argument == null)
        bareReturns.push(node);
      if (
        t.isCallExpression(node) &&
        t.isIdentifier(node.callee, { name: "inspect" })
      )
        inspectCall = node;
    },
  });
  for (const array of arrays)
    array.elements = Array.from({ length: 1_000_000 }, () =>
      t.numericLiteral(0),
    );
  const earliestReturn = bareReturns.toSorted(
    (left, right) => (left.start ?? 0) - (right.start ?? 0),
  )[0];
  const inspected = inspectCall?.arguments[0];
  if (earliestReturn === undefined || inspected === undefined)
    throw new Error("symbolic source fixture is missing its probes");

  const state = completeSemanticSteps(
    indexJavaScriptBindingsSteps(parsed.program),
  );
  const resolver = new JavaScriptSymbolicBindings(state, parsed.program);
  const namespace = symbolicVariants(resolver.evaluate(inspected)).find(
    (variant) => variant.kind === "namespace",
  );
  if (namespace?.kind !== "namespace")
    throw new Error("loaded module namespace missing");
  expect(namespace.environment.completedAt).toBe(earliestReturn);
});

it("keeps async call objects truthy and unwraps only awaited results", () => {
  const values = inspectedValues(`async function flag(){return false;}
    inspect(flag()); inspect(!flag()); inspect(flag() ?? true);
    inspect(await flag()); inspect(flag() || false);`);
  expect(values[0]).toMatchObject({
    kind: "promise",
    value: { kind: "literal", value: false },
  });
  expect(values[1]).toMatchObject({ kind: "literal", value: false });
  expect(values[2]?.kind).toBe("promise");
  expect(values[3]).toMatchObject({ kind: "literal", value: false });
  expect(values[4]?.kind).toBe("promise");
});

it("does not execute generator bodies to resolve initial calls", () => {
  const { resolver, values } = inspectFixture(`function* flag(){return false;}
    async function* asyncFlag(){return false;}
    inspect(flag()); inspect(!flag()); inspect(asyncFlag()); inspect(flag() ?? false);`);
  expect(values.map((value) => value.kind)).toEqual([
    "iterator",
    "literal",
    "iterator",
    "iterator",
  ]);
  expect(values[1]).toMatchObject({ kind: "literal", value: false });
  expect(resolver.unresolved).toBe(false);
});

it("preserves captured initialization through async and forwarding returns", () => {
  const { resolver, values } = inspectFixture(`function outer(){
    const electron=require("electron");
    async function capture(){return ()=>electron.ipcMain;}
    return capture();
  }
  async function forward(){return outer();}
  inspect(await forward());`);
  const fn = values[0];
  expect(fn?.kind).toBe("function");
  if (fn?.kind !== "function") throw new Error("awaited closure missing");
  expect(resolver.evaluate(fn.node.body, resolver.bind(fn, []))).toMatchObject({
    kind: "external",
    path: ["electron", "ipcMain"],
  });
  expect(fn.origins.length).toBeGreaterThan(0);
});

it.each([
  "function* value(){return false;}",
  "async function value(){return false;}",
])(
  "keeps opaque call-result member access explicitly unresolved: %s",
  (declaration) => {
    const { resolver, values } = inspectFixture(
      `${declaration}inspect(value().next);`,
    );
    expect(values[0]).toMatchObject({
      kind: "unknown",
      reason: expect.stringContaining("members are not modeled"),
    });
    expect(resolver.unresolved).toBe(true);
  },
);

it.each([
  ["unknown spread", `{value:require("electron"),...input}`, "unknown"],
  ["unknown descriptor", `input`, "unknown"],
  ["negative number spread", `{value:require("electron"),...-1}`, "external"],
  ["negative bigint spread", `{value:require("electron"),...-1n}`, "external"],
  [
    "ordinary method value",
    `{value(){return require("electron")}}`,
    "function",
  ],
  ["null prototype", `{__proto__:null,value:require("electron")}`, "external"],
  [
    "ignored primitive prototype",
    `{__proto__:0,value:require("electron")}`,
    "external",
  ],
  [
    "function spread",
    `{value:require("electron"),...function(){}}`,
    "external",
  ],
  ["regexp spread", `{value:require("electron"),.../x/}`, "external"],
  [
    "interpolated string spread",
    '{value:require("electron"),...`x${input}`}',
    "external",
  ],
  ["empty array spread", `{value:require("electron"),...[]}`, "external"],
  ["array spread", `{value:require("electron"),...[1]}`, "external"],
  ["sparse array spread", `{value:require("electron"),...[,1]}`, "external"],
  [
    "unknown iterable array spread",
    `{value:require("electron"),...[...input]}`,
    "external",
  ],
  [
    "patched defineProperty",
    `{get:()=>replacement}`,
    "external",
    "Object.defineProperty=()=>{};",
  ],
  [
    "literal-return no-op replacement",
    `{enumerable:true}`,
    "external",
    "Object.defineProperty=(_target,_key)=>0;",
  ],
  [
    "successive no-op replacements",
    `{enumerable:true}`,
    "external",
    "Object.defineProperty=()=>{};Object.defineProperty=()=>{};",
  ],
  [
    "literal stub with effectful parameter binding",
    `{enumerable:true}`,
    "unknown",
    "Object.defineProperty=(target=mutate())=>0;",
  ],
  [
    "mixed getter and spread value",
    `{get:()=>0,...{value:require("electron")}}`,
    "unknown",
  ],
  [
    "mixed setter and value",
    `{value:require("electron"),set:()=>{}}`,
    "unknown",
  ],
  [
    "erased descriptor assertion",
    `({value:require("electron")} as const)`,
    "external",
  ],
  ["string spread", `{value:require("electron"),..."x"}`, "external"],
  ["accessor getter", `{get(){return replacement}}`, "unknown"],
  ["accessor setter", `{set(value){replacement=value}}`, "unknown"],
  ["absent accessor", `{get:undefined}`, "unknown"],
  ["unknown key", `{value:require("electron"),[key]:replacement}`, "unknown"],
  [
    "getter",
    `{value:require("electron"),get value(){return replacement}}`,
    "unknown",
  ],
  [
    "unknown spread may supply accessors",
    `{...input,value:require("electron")}`,
    "unknown",
  ],
  [
    "known spread before value",
    `{...{enumerable:true},value:require("electron")}`,
    "external",
  ],
  ["null spread", `{value:require("electron"),...null}`, "external"],
  ["undefined spread", `{value:require("electron"),...undefined}`, "external"],
  ["void spread", `{value:require("electron"),...void 0}`, "external"],
  [
    "shadowed undefined",
    `{value:require("electron"),...undefined}`,
    "unknown",
    "const undefined=input;",
  ],
  ["unchanged value", `{enumerable:true}`, "external"],
])(
  "preserves effective descriptor value uncertainty for %s",
  (_name, descriptor, kind, setup = "") => {
    const value = inspectOne(`(() => {
      const modules = {
        1(module,exports) {
          ${setup}
          exports.api = require("electron");
          Object.defineProperty(exports,"api",${descriptor});
        },
        2(module,exports,load) { inspect(load(1).api); }
      };
      function load(id) {const m={exports:{}};modules[id](m,m.exports,load);return m.exports;}
      load(2);
    })();`);
    expect(value.kind).toBe(kind);
    if (kind === "external")
      expect(value).toEqual({ kind: "external", path: ["electron"] });
  },
);

it("reads a literal prototype only from its actual prototype setter", () => {
  expect(
    inspectOne('inspect(({ordinary:require("electron")}).__proto__);').kind,
  ).toBe("unknown");
  expect(
    inspectOne(
      'inspect(({__proto__:require("electron"),ordinary:1}).__proto__);',
    ),
  ).toEqual({ kind: "external", path: ["electron"] });
});

it.each(["local", "outer"])(
  "does not resurrect an export when the intrinsic changes %s after replacement",
  (position) => {
    const value = inspectOne(`(() => {
    const modules = {
      1(module,exports) {
        exports.api = require("electron");
        Object.defineProperty(exports,"api",{value:null});
        ${position === "local" ? "Object.defineProperty=()=>{};" : ""}
      },
      2(module,exports,load) {inspect(load(1).api);}
    };
    function load(id){const m={exports:{}};modules[id](m,m.exports,load);return m.exports;}
    load(2);
    ${position === "outer" ? "Object.defineProperty=()=>{};" : ""}
  })();`);
    expect(value.kind).not.toBe("external");
  },
);

it("does not preserve a sender through a possibly mutating intrinsic replacement", () => {
  const value = inspectOne(`(() => {
    const modules={
      1(module,exports){exports.api=require("electron");Object.defineProperty=(target,key)=>{target[key]=null;};Object.defineProperty(exports,"api",{value:require("electron")});},
      2(module,exports,load){inspect(load(1).api);}
    };
    function load(id){const m={exports:{}};modules[id](m,m.exports,load);return m.exports;}load(2);
  })();`);
  expect(value.kind).toBe("unknown");
});

it("keeps a possibly repeated factory's native descriptor value unknown", () => {
  const value = inspectOne(`(() => {
    const modules={
      1(module,exports){exports.api=null;Object.defineProperty(exports,"api",{value:require("electron")});Object.defineProperty=()=>{};},
      2(module,exports,load){inspect(load(1).api);}
    };
    function load(id){const m={exports:{}};modules[id](m,m.exports,load);return m.exports;}load(2);
  })();`);
  expect(value.kind).toBe("unknown");
});
