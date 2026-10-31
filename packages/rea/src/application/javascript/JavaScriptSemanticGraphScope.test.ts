import { expect, it } from "vitest";

import { graphForJavaScript as graphFor } from "../../../tests/fixtures/javascriptSemanticGraph.js";
import { analyzeJavaScriptSemantics } from "../../domain/javascript/javascriptSemanticAnalysis.js";
import { topLevelBinding } from "../../domain/javascript/javascriptSemanticAnalysis.fixture.js";

const dynamicScopeUnknowns = (source: string) =>
  graphFor(source).unknowns.filter(({ reason }) => reason === "dynamic-scope");

it("exposes direct eval and with as dynamic-scope unknowns in the public graph", () => {
  const unknowns = dynamicScopeUnknowns(`
    function inspect(host, source) {
      with (host) { consume(target); }
      eval(source);
    }
  `);
  expect(unknowns).toHaveLength(2);
  expect(unknowns.map(({ detail }) => detail).join("\n")).toEqual(
    expect.stringContaining("with"),
  );
  expect(unknowns.map(({ detail }) => detail).join("\n")).toEqual(
    expect.stringContaining("eval"),
  );
});

it("does not mark shadowed, optional, or indirect eval as dynamic scope", () => {
  const unknowns = dynamicScopeUnknowns(`
    function shadowed(eval, source) { eval(source); }
    function optional(source) { eval?.(source); }
    function indirect(source) { (0, eval)(source); }
  `);
  expect(unknowns).toEqual([]);
});

it("keeps switch discriminants outside the shared case lexical scope", () => {
  const ir = analyzeJavaScriptSemantics(`
    const selected = choose();
    switch (selected) {
      case 1: let selected = 1; let local = 1; break;
      case 2: local = 2; break;
    }
  `);
  const selectedBinding = topLevelBinding(ir, "selected");
  const localBindings = ir.bindings.filter(({ name }) => name === "local");
  expect(ir.references.find(({ name }) => name === "selected")?.bindingId).toBe(
    selectedBinding.bindingId,
  );
  expect(localBindings).toHaveLength(1);
  expect(localBindings[0]?.scopeId).not.toBe(selectedBinding?.scopeId);
  expect(
    ir.references.filter(
      ({ name, role }) => name === "selected" && role === "read",
    ),
  ).toHaveLength(1);
  expect(
    ir.references.filter(
      ({ name, role }) => name === "local" && role === "write",
    ),
  ).toHaveLength(1);
});

it("leaves with-object resolution intact and marks only body name resolution unknown", () => {
  const ir = analyzeJavaScriptSemantics(`
    const host = getHost();
    const outer = 3;
    function inspect() {
      with (host) {
        const local = 1;
        consume(local, outer);
      }
    }
  `);
  const host = topLevelBinding(ir, "host");
  const hostRead = ir.references.find(
    ({ name, role }) => name === "host" && role === "read",
  );
  const outerRead = ir.references.find(
    ({ name, role }) => name === "outer" && role === "read",
  );
  const localRead = ir.references.find(
    ({ name, role }) => name === "local" && role === "read",
  );
  expect(hostRead?.bindingId).toBe(host.bindingId);
  expect(hostRead?.resolution).toBe("resolved");
  expect(outerRead?.resolution).toBe("unknown");
  expect(localRead?.resolution).toBe("resolved");
  expect(outerRead?.bindingId).toBeNull();
});

it("keeps var declarations in each static block from leaking to another block", () => {
  const ir = analyzeJavaScriptSemantics(`
    class Example {
      static { var first = 1; }
      static { var second = 2; consume(first); }
    }
  `);
  const first = ir.bindings.filter(({ name }) => name === "first");
  const second = ir.bindings.filter(({ name }) => name === "second");
  expect(ir.references.find(({ name }) => name === "first")?.resolution).toBe(
    "unbound",
  );
  expect(first).toHaveLength(1);
  expect(second).toHaveLength(1);
  expect(first[0]?.scopeId).not.toBe(second[0]?.scopeId);
});
