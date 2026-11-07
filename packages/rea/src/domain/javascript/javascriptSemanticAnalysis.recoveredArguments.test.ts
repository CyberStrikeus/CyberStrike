import { describe, expect, it } from "vitest";

import { analyzeJavaScriptSemantics } from "./javascriptSemanticAnalysis.js";

describe("JavaScript semantic analysis: recovered arguments", () => {
  it.each([
    { source: "0(,)", indexes: [] },
    { source: 'call(, "kept", , 42)', indexes: [1, 3] },
    { source: 'call?.(, "kept")', indexes: [1] },
    { source: 'new Thing(, "kept")', indexes: [1] },
  ])(
    "retains argument positions in recovered syntax: $source",
    ({ source, indexes }) => {
      const ir = analyzeJavaScriptSemantics(source);

      expect(ir.coverage.status).toBe("partial");
      expect(ir.callSites).toHaveLength(1);
      expect(ir.callSites[0]?.arguments.map(({ index }) => index)).toEqual(
        indexes,
      );
      expect(ir.limitations.join(" ")).toMatch(/parser recovered/iu);
    },
  );

  it("keeps recovered argument flows bound to their original parameter", () => {
    const ir = analyzeJavaScriptSemantics(
      "function select(first, second) { return second; } const value = 42; select(, value);",
    );
    const second = ir.bindings.find(({ name }) => name === "second");

    expect(ir.coverage.status).toBe("partial");
    expect(second).toBeDefined();
    expect(ir.argumentFlows).toEqual([
      expect.objectContaining({
        argumentIndex: 1,
        parameterBindingId: second?.bindingId,
      }),
    ]);
  });
});
