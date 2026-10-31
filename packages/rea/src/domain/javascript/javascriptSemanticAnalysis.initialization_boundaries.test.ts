import { expect, it } from "vitest";
import { analyzeParsedJavaScriptSemantics } from "./javascriptSemanticAnalysis.js";
import {
  onlyCallable,
  onlyBinding,
} from "./javascriptSemanticAnalysis.fixture.js";
import { parseJavaScriptSource } from "./javascriptSourceParser.js";

const analyze = (source: string, path = "fixture.cjs") => {
  const file = parseJavaScriptSource(source, path);
  if (file === null) throw new Error("Expected parsed fixture");
  return analyzeParsedJavaScriptSemantics(file);
};
const returned = (body: string) =>
  onlyCallable(analyze(`exports.read = function read() { ${body} };`), "read")
    .returnSites[0]?.value;

it.each([
  "return value; var value = 1;",
  "var snapshot = value; var value = 1; return snapshot;",
])("selects declaration-only bindings at their actual read: %s", (body) => {
  expect(returned(body)?.status).toBe("unknown");
});

it.each([
  "do { break; var value = 1; } while (false); return value;",
  "do { if (flag) break; var value = 1; } while (false); return value;",
  "do { continue; var value = 1; } while (false); return value;",
  "label: { break label; var value = 1; } return value;",
])(
  "does not treat an initializer skipped by abrupt completion as definite: %s",
  (body) => {
    expect(returned(body)?.status).toBe("unknown");
  },
);

it.each([
  "var value = 1; return value;",
  "do { var value = 1; break; } while (false); return value;",
  "do { for (;;) { break; } var value = 1; } while (false); return value;",
  "label: { break label; } var value = 1; return value;",
  "function unused() { return; } var value = 1; return value;",
])(
  "preserves initializers that an earlier local exit does not skip: %s",
  (body) => {
    expect(returned(body)).toEqual({ status: "literal", value: 1 });
  },
);

it.each([
  "var value = 1; { function value() {} } exports.read = function read() { return value; };",
  "exports.read = function read() { var value = 1; if (flag) { function value() {} } return value; };",
])(
  "indexes the legacy block-function write on its outer owner: %s",
  (source) => {
    const returnSite = onlyCallable(analyze(source), "read").returnSites[0];
    expect(returnSite).toBeDefined();
    expect(returnSite?.value.status).not.toBe("literal");
  },
);

it.each([
  [
    "fixture.cjs",
    '"use strict"; var value = 1; { function value() {} } exports.read = function read() { return value; };',
  ],
  [
    "fixture.cjs",
    "let value = 1; { function value() {} } exports.read = function read() { return value; };",
  ],
  [
    "fixture.mjs",
    "var value = 1; { function value() {} } export function read() { return value; }",
  ],
])(
  "does not apply legacy writes across a strict or lexical boundary: %s",
  (path, source) => {
    expect(
      onlyCallable(analyze(source, path), "read").returnSites[0]?.value,
    ).toEqual({ status: "literal", value: 1 });
  },
);

it("assigns a catch-shadowed var initializer to the active lexical binding", () => {
  const ir = analyze(`
    function target() { return "target"; }
    try { throw 0; } catch (handler) { var handler = target; handler(); }
  `);
  const target = onlyCallable(ir, "target");
  expect(ir.callSites).toContainEqual(
    expect.objectContaining({
      resolution: "exact",
      calleeCallableIds: [target.callableId],
    }),
  );
  const hoisted = ir.bindings.find(
    ({ name, kind }) => name === "handler" && kind === "variable",
  );
  expect(hoisted?.value.status).toBe("unknown");
});

it("keeps ordinary arguments local while arrows retain the outer binding", () => {
  const ir = analyze(`
    var arguments = { 0: "OUTER" };
    function ordinary() { const selected = arguments[0]; return selected; }
    const arrow = () => arguments[0];
  `);
  expect(onlyBinding(ir, "selected").value.status).toBe("unknown");
  expect(onlyCallable(ir, "ordinary").returnSites[0]?.value.status).toBe(
    "unknown",
  );
  expect(onlyCallable(ir, "arrow").returnSites[0]?.value).toEqual({
    status: "literal",
    value: "OUTER",
  });
  const outer = onlyBinding(ir, "arguments");
  expect(
    ir.closureCaptures.some(
      ({ bindingId, callableId }) =>
        bindingId === outer.bindingId &&
        callableId === onlyCallable(ir, "ordinary").callableId,
    ),
  ).toBe(false);
});

it.each([
  ["object", "{ handler }", "{ handler: state }"],
  ["array", "[handler]", "[state]"],
])(
  "retains mutations through catch-shadowed %s var aliases",
  (_shape, pattern, value) => {
    for (const shadowed of [true, false]) {
      const ir = analyze(`
        exports.read = function read() {
          const state = { value: 1 };
          try { throw 0; } catch (${shadowed ? "handler" : "error"}) {
            var ${pattern} = ${value};
            handler.value = 2;
          }
          return state.value;
        };
      `);
      expect(ir.coverage.status).toBe("complete");
      expect(onlyCallable(ir, "read").returnSites[0]?.value).toEqual({
        status: "unknown",
        reason: "Own property value is unknown-coverage.",
      });
      if (shadowed)
        expect(
          ir.bindings.find(
            ({ name, kind }) => name === "handler" && kind === "variable",
          )?.value.status,
        ).toBe("unknown");
    }
  },
);

it("does not resolve Promise sources through a future initializer", () => {
  const early = analyze(
    `
    try { task.then(work); } catch (error) {}
    const task = Promise.resolve(1);
  `,
    "fixture.mjs",
  );
  expect(
    early.promiseOperations.find(({ method }) => method === "then"),
  ).toMatchObject({ sourceResolution: "unresolved", sourcePromiseIds: [] });
  const initialized = analyze(
    "const task = Promise.resolve(1); task.then(work);",
    "fixture.mjs",
  );
  expect(
    initialized.promiseOperations.find(({ method }) => method === "then"),
  ).toMatchObject({
    sourceResolution: "complete",
    sourcePromiseIds: [expect.any(String)],
  });
});

it.each([
  "globalThis.Promise = { resolve() { return 17; } };",
  "Promise.resolve = () => 17;",
])(
  "requires the selected intrinsic Promise identity after ambient writes: %s",
  (write) => {
    const ir = analyze(
      `${write} const task = Promise.resolve(1);`,
      "fixture.mjs",
    );
    expect(
      ir.promiseOperations.filter(({ method }) => method === "resolve"),
    ).toEqual([]);
    expect(
      analyze("const task = Promise.resolve(1);", "fixture.mjs")
        .promiseOperations,
    ).toContainEqual(
      expect.objectContaining({
        method: "resolve",
        sourceResolution: "complete",
      }),
    );
  },
);

it("retains caught reference identity without tainting inert throws or later replacements", () => {
  const cases = [
    ["caught.value = 2;", "unknown"],
    ["mutate(caught);", "unknown"],
    ["", "literal"],
    ["caught = {}; caught.value = 2;", "literal"],
  ] as const;
  for (const [body, status] of cases)
    expect(
      returned(
        `const state = { value: 1 }; try { throw state; } catch (caught) { ${body} } return state.value;`,
      )?.status,
    ).toBe(status);
});

it("owns a class declaration's self reference separately from its outer variable", () => {
  const ir = analyze(
    `
    class Service { static create() { return new Service(); } }
    const Original = Service;
    Service = function Replacement() {};
  `,
    "fixture.mjs",
  );
  const bindings = ir.bindings.filter(({ name }) => name === "Service");
  expect(bindings).toHaveLength(2);
  const create = onlyCallable(ir, "create");
  expect(
    ir.closureCaptures.some(
      ({ callableId, bindingId }) =>
        callableId === create.callableId &&
        bindingId === bindings.find(({ mutable }) => mutable)?.bindingId,
    ),
  ).toBe(false);
  expect(
    ir.callSites.find(
      ({ callerCallableId }) => callerCallableId === create.callableId,
    )?.resolution,
  ).toBe("exact");
});

it("does not initialize a class self name during computed-key evaluation", () => {
  const ir = analyze(`class Service { [Service()]() {} }`, "fixture.mjs");
  expect(ir.callSites[0]).toBeDefined();
  expect(ir.callSites[0]?.resolution).not.toBe("exact");
});
