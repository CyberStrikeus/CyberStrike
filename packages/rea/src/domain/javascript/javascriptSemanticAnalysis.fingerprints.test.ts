import { expect, it } from "vitest";

import { analyzeJavaScriptSemantics } from "./javascriptSemanticAnalysis.js";

const components = (source: string) => {
  const ir = analyzeJavaScriptSemantics(source);
  expect(ir.functionFingerprints).toHaveLength(1);
  const fingerprint = ir.functionFingerprints[0];
  if (fingerprint === undefined)
    throw new Error("Expected a function fingerprint");
  expect(fingerprint.status).toBe("complete");
  return fingerprint.components;
};

it.each([
  ["recognized directives", '"use strict"', '"use asm"'],
  ["ordinary directives", '"alpha"', '"beta"'],
  ["empty directive", '""', '"alpha"'],
  ["escaped strict spelling", '"use strict"', String.raw`"use\x20strict"`],
])("retains %s in the function literal commitment", (_name, left, right) => {
  const source = (directive: string) =>
    `function sample(value) { ${directive}; return value; }`;
  expect(components(source(left)).literalSetSha256).not.toBe(
    components(source(right)).literalSetSha256,
  );
});

it.each([
  [
    'function sample(value) { "use strict"; return value; }',
    "function renamed(input) {\n 'use strict' ;\n return input;\n}",
  ],
  [
    String.raw`function sample(value) { "use\x20strict"; return value; }`,
    String.raw`function renamed(input) { 'use\x20strict'; return input; }`,
  ],
])(
  "normalizes quote style, formatting and names for %s",
  (original, renamed) => {
    expect(components(renamed)).toEqual(components(original));
  },
);

it("keeps a nested function's directive out of its owner fingerprint", () => {
  const analyze = (directive: string) => {
    const ir = analyzeJavaScriptSemantics(
      `function outer() { function inner(value) { ${directive}; return value; } return 1; }`,
    );
    return new Map(
      ir.functionFingerprints.map((fingerprint) => [
        ir.callables.find(
          ({ callableId }) => callableId === fingerprint.callableId,
        )?.name,
        fingerprint.components,
      ]),
    );
  };
  const first = analyze('"use strict"');
  const second = analyze('"ordinary"');
  expect(first.size).toBe(2);
  expect(second.get("outer")).toEqual(first.get("outer"));
  expect(first.get("inner")?.literalSetSha256).toEqual(expect.any(String));
  expect(second.get("inner")?.literalSetSha256).toEqual(expect.any(String));
  expect(second.get("inner")?.literalSetSha256).not.toBe(
    first.get("inner")?.literalSetSha256,
  );
});
