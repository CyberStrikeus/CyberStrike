import { expect, it } from "vitest";
import { analyzeJavaScriptSemantics } from "./javascriptSemanticAnalysis.js";
import { onlyCallable } from "./javascriptSemanticAnalysis.fixture.js";

it("uses parser roles for TS, import, and meta names while retaining computed reads", () => {
  const ir = analyzeJavaScriptSemantics(`
    const field=1, method=2, enumKey=3, url=4, type=5, computed="slot";
    interface Shape { field: number; method(): void; [computed]: number; }
    enum Choice { enumKey = field }
    const meta = import.meta.url;
    import data from "./data.json" with { type: "json" };
    const object = { [computed]: field }; object[computed];
  `);
  expect(ir.coverage.status).not.toBe("failed");
  expect(
    ir.references
      .filter(({ name }) =>
        ["field", "method", "enumKey", "url", "type"].includes(name),
      )
      .map(({ name }) => name),
  ).toEqual(["field", "field"]);
  expect(ir.references.filter(({ name }) => name === "computed")).toHaveLength(
    2,
  );
});

it("distinguishes erased type queries from evaluated typeof expressions", () => {
  const ir = analyzeJavaScriptSemantics(`
    const marker = 1;
    type Shape = typeof marker;
    function describe() { type Local = typeof marker; }
    const kind = typeof marker;
  `);
  expect(
    ir.references
      .filter(({ name }) => name === "marker")
      .map(({ role, resolution, location }) => [
        role,
        resolution,
        location.start.line,
      ]),
  ).toEqual([["read", "resolved", 5]]);
  expect(ir.closureCaptures).toEqual([]);
});

it("keeps destructuring writes, defaults and closure captures under one role owner", () => {
  const ir = analyzeJavaScriptSemantics(`
    let value=0; const source={value:1}; const fallback=2;
    function change() { ({ value = fallback } = source); return value; }
  `);
  expect(
    ir.references.filter(
      ({ name, role }) => name === "value" && role === "write",
    ),
  ).toHaveLength(1);
  expect(ir.closureCaptures).toHaveLength(4);
});

it.each([
  "function* wrapped(){ yield 1; return 2; }",
  "async function wrapped(){ return 2; }",
  "async function* wrapped(){ yield 1; return 2; }",
])(
  "does not project wrapped body results into direct calls: %s",
  (declaration) => {
    const ir = analyzeJavaScriptSemantics(
      `${declaration} const result=wrapped(); function ordinary(){return 3;} const direct=ordinary();`,
    );
    const wrapped = onlyCallable(ir, "wrapped");
    const ordinary = onlyCallable(ir, "ordinary");
    expect(
      ir.callReturnFlows.filter(
        ({ callableId }) => callableId === wrapped.callableId,
      ),
    ).toEqual([]);
    expect(
      ir.callReturnFlows.filter(
        ({ callableId }) => callableId === ordinary.callableId,
      ),
    ).toHaveLength(1);
    expect(
      ir.frontiers.some(({ reason }) =>
        reason.includes("body results require separate consumption"),
      ),
    ).toBe(true);
  },
);

it("separates emitter binding lifetimes and retains stable emitter identity", () => {
  const ir = analyzeJavaScriptSemantics(`
    let bus = createEmitter(); bus.on("ready", handler); bus = createEmitter(); bus.emit("ready");
    const stable = createEmitter(); stable.on("ready", handler); stable.emit("ready");
  `);
  expect(ir.eventOperations).toHaveLength(4);
  expect(ir.eventOperations[0]?.emitterKey).not.toBe(
    ir.eventOperations[1]?.emitterKey,
  );
  expect(ir.eventOperations[2]?.emitterKey).toBe(
    ir.eventOperations[3]?.emitterKey,
  );
  expect(ir.eventOperations[2]?.resolution).toBe("complete");
});

it("does not claim one receiver instance for unrelated this expressions", () => {
  const ir = analyzeJavaScriptSemantics(`
    class First { start(){this.on("ready", handler);} }
    class Second { finish(){this.emit("ready");} }
  `);
  expect(ir.eventOperations).toHaveLength(2);
  expect(ir.eventOperations[0]?.emitterKey).not.toBe(
    ir.eventOperations[1]?.emitterKey,
  );
  expect(ir.eventOperations.map(({ resolution }) => resolution)).toEqual([
    "partial",
    "partial",
  ]);
});
