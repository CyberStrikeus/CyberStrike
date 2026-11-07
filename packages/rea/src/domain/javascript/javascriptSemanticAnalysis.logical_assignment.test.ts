import { describe, expect, it } from "vitest";
import { analyzeJavaScriptSemantics } from "./javascriptSemanticAnalysis.js";

const observe = (source: string) => {
  const ir = analyzeJavaScriptSemantics(source);
  return {
    binding: ir.bindings.find((item) => item.name === "x")?.value,
    returned: ir.callables.find((item) => item.name === "read")?.returnSites[0]
      ?.value,
  };
};

describe("JavaScript semantic analysis: logical assignment", () => {
  it.each(["||=", "??=", "&&="])(
    "keeps a parameter uncertain after %s",
    (operator) => {
      const { binding, returned } = observe(
        `function read(x) { x ${operator} 2; return x; }`,
      );
      expect(binding?.status).toBe("unknown");
      expect(returned?.status).toBe("unknown");
    },
  );

  it.each(["||=", "??=", "&&="])(
    "keeps a destructured parameter uncertain after %s",
    (operator) => {
      const { binding, returned } = observe(
        `function read({ x }) { x ${operator} 2; return x; }`,
      );
      expect(binding?.status).toBe("unknown");
      expect(returned?.status).toBe("unknown");
    },
  );

  it.each(["||=", "??=", "&&="])(
    "keeps a catch binding uncertain after %s",
    (operator) => {
      const { binding, returned } = observe(
        `function read() { try { run(); } catch (x) { x ${operator} 2; return x; } }`,
      );
      expect(binding?.status).toBe("unknown");
      expect(returned?.status).toBe("unknown");
    },
  );

  it.each([
    ["let", "||="],
    ["let", "??="],
    ["var", "||="],
    ["var", "??="],
  ])(
    "keeps an uninitialized %s local exact after %s",
    (declaration, operator) => {
      const { binding, returned } = observe(
        `function read() { ${declaration} x; x ${operator} 2; return x; }`,
      );
      expect(binding).toEqual({ status: "literal", value: 2 });
      expect(returned).toEqual({ status: "literal", value: 2 });
    },
  );

  it("keeps an unconditional parameter assignment exact", () => {
    const { binding, returned } = observe(
      "function read(x) { x = 2; return x; }",
    );
    expect(binding).toEqual({ status: "literal", value: 2 });
    expect(returned).toEqual({ status: "literal", value: 2 });
  });

  it("keeps an unchanged parameter unknown", () => {
    expect(observe("function read(x) { return x; }").returned?.status).toBe(
      "unknown",
    );
  });

  it("reproduces the issue #2646 inputs without an exact literal", () => {
    for (const operator of ["||=", "??="]) {
      const { binding, returned } = observe(
        `function read(x) { x ${operator} 2; return x; }`,
      );
      expect(binding).not.toEqual({ status: "literal", value: 2 });
      expect(returned).not.toEqual({ status: "literal", value: 2 });
    }
    const readOr = (x: number) => {
      x ||= 2;
      return x;
    };
    const readNullish = (x: number) => {
      x ??= 2;
      return x;
    };
    expect(readOr(5)).toBe(5);
    expect(readNullish(5)).toBe(5);
  });
});
