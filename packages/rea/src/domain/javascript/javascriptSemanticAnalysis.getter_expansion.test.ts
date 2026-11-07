import { expect, it } from "vitest";

import { analyzeJavaScriptSemantics } from "./javascriptSemanticAnalysis.js";
import { onlyBinding } from "./javascriptSemanticAnalysis.fixture.js";

const permutationSource = (count: number, isStatic: boolean) => {
  const getterPrefix = isStatic ? "static " : "";
  const access = isStatic ? "Request.field0" : "new Request().field0";
  const getters = Array.from(
    { length: count },
    (_, index) =>
      `${getterPrefix}get field${index}() { return this[key].field${index}; }`,
  ).join("\n");
  return `
    import imported from "dep";
    const shared = { value: 1 };
    class Request {
      ${getters}
      ${getterPrefix}get state() { return shared; }
    }
    consume(${access});
    const result = shared.value;
    const unrelated = 42;
  `;
};

const expectRetainedFacts = (
  ir: ReturnType<typeof analyzeJavaScriptSemantics>,
) => {
  expect(onlyBinding(ir, "unrelated").value).toEqual({
    status: "literal",
    value: 42,
  });
  expect(onlyBinding(ir, "imported").provenance.status).toBe("module");
  expect(ir.moduleLinks).toContainEqual(
    expect.objectContaining({ kind: "import", specifier: "dep" }),
  );
};

it.each([false, true])(
  "bounds unknown-key %s getter permutations and preserves unrelated facts",
  (isStatic) => {
    const ir = analyzeJavaScriptSemantics(permutationSource(10, isStatic));
    expect(ir.coverage).toMatchObject({
      status: "partial",
      omittedCount: null,
      resourceLimits: ["getter-expansion"],
    });
    expect(onlyBinding(ir, "result").value.status).toBe("unknown");
    expect(onlyBinding(ir, "result").provenance).toMatchObject({
      status: "local",
      origins: [],
    });
    expect(ir.limitations.join(" ")).toMatch(
      /Getter expansion was conservatively bounded/,
    );
    expectRetainedFacts(ir);
  },
);

it("keeps direct field writes through an escaped growing getter result", () => {
  const ir = analyzeJavaScriptSemantics(`
    import imported from "dep";
    const shared = { x: 1 };
    class Request {
      slot = shared;
      get grow() { return this.grow.more; }
    }
    new Request()[key].x = 2;
    const result = shared.x;
    const unrelated = 42;
  `);
  expect(onlyBinding(ir, "result").value.status).toBe("unknown");
  expect(ir.coverage.resourceLimits).toEqual(["getter-expansion"]);
  expectRetainedFacts(ir);
});

it("escapes constructed fields when a getter query widens its suffix", () => {
  const ir = analyzeJavaScriptSemantics(`
    import imported from "dep";
    const shared = { value: 1 };
    class Inner { alias = shared; }
    class Outer {
      get result() { return new Inner(); }
      get grow() { return this.grow.more; }
    }
    new Outer()[key].alias.value = 2;
    const result = shared.value;
    const unrelated = 42;
  `);
  expect(onlyBinding(ir, "result").value.status).toBe("unknown");
  expect(ir.coverage.resourceLimits).toEqual(["getter-expansion"]);
  expectRetainedFacts(ir);
});

it.each(["class", "object"] as const)(
  "bounds branching local aliases inside one %s getter",
  (receiver) => {
    const aliases = Array.from(
      { length: 10 },
      (_, index) =>
        `const a${index + 1} = flag ? a${index}.left : a${index}.right;`,
    ).join("\n");
    const getter = `get state() { const a0 = this; ${aliases} return a10; }`;
    const definition =
      receiver === "class"
        ? `class Request { slot = shared; ${getter} } const request = new Request();`
        : `const request = { slot: shared, ${getter} };`;
    const ir = analyzeJavaScriptSemantics(`
    import imported from "dep";
    const shared = { value: 1 };
    ${definition}
    consume(request.state);
    const result = shared.value;
    const unrelated = 42;
  `);
    expect(ir.coverage).toMatchObject({
      status: "partial",
      resourceLimits: ["getter-expansion"],
    });
    expect(onlyBinding(ir, "result").value.status).toBe("unknown");
    expectRetainedFacts(ir);
  },
);
