import { expect, it } from "vitest";

import { analyzeJavaScriptSemantics } from "./javascriptSemanticAnalysis.js";

it.each(["execute", "{execute}", "...execute", "execute = () => 'DEFAULT'"])(
  "lets %s parameters shadow a named function expression",
  (parameter) => {
    const ir = analyzeJavaScriptSemantics(
      `const task = function execute(${parameter}) { return execute(); };`,
    );
    const call = ir.callSites[0];
    expect(call?.calleeCallableIds).toEqual([]);
    expect(call?.resolution).toBe("unresolved");
    const bindings = ir.bindings.filter(({ name }) => name === "execute");
    expect(bindings).toHaveLength(2);
    expect(bindings.map(({ kind }) => kind).sort()).toEqual([
      "function",
      "parameter",
    ]);
  },
);

it.each(["var", "let", "const"])(
  "lets body %s declarations shadow a named function expression",
  (kind) => {
    const ir = analyzeJavaScriptSemantics(`const task = function execute() {
    ${kind} execute = () => 'LOCAL';
    return execute();
  };`);
    const local = ir.callables.find(
      ({ location }) => location.start.line === 2,
    );
    expect(ir.callSites[0]?.calleeCallableIds).toEqual([local?.callableId]);
    expect(ir.callSites[0]?.resolution).toBe("exact");
  },
);

it("preserves recursive function-name resolution without leaking the name", () => {
  const ir = analyzeJavaScriptSemantics(`const task = function execute(depth) {
    return depth === 0 ? 'DONE' : execute(depth - 1);
  };
  execute();`);
  const own = ir.callables.find(({ name }) => name === "execute");
  expect(ir.callSites[0]?.calleeCallableIds).toEqual([own?.callableId]);
  expect(ir.callSites[1]?.calleeCallableIds).toEqual([]);
});

it("retains an unshadowed function name in parameter defaults", () => {
  const ir = analyzeJavaScriptSemantics(
    `const task = function execute(value = execute()) { return value; };`,
  );
  const own = ir.callables.find(({ name }) => name === "execute");
  expect(ir.callSites[0]?.calleeCallableIds).toEqual([own?.callableId]);
});
