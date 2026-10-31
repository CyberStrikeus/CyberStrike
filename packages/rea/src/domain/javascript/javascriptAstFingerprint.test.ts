import { parse } from "@babel/parser";
import { expect, it } from "vitest";

import { fingerprintJavaScriptAst } from "./javascriptAstFingerprint.js";
import { analyzeJavaScriptStaticSource } from "./javascriptStaticAnalysis.js";

it.each([
  ["bigint values", "const value = 1n;", "const value = 2n;"],
  [
    "bigint object keys",
    "const value = { 1n: 0 };",
    "const value = { 2n: 0 };",
  ],
  [
    "empty fixed object keys",
    'const value = { "": 0 };',
    'const value = { "x": 0 };',
  ],
  ["directives", '"use strict";', '"use asm";'],
  ["assignment operators", "value = 1;", "value += 1;"],
  ["public class method names", "class A { foo() {} }", "class A { bar() {} }"],
  ["public class field names", "class A { foo = 1; }", "class A { bar = 1; }"],
  ["update expression prefix", "value++", "++value"],
  ["declaration kind", "var value = 1;", "const value = 1;"],
  [
    "function async flag",
    "function read() { return 1; }",
    "async function read() { return 1; }",
  ],
  ["function generator flag", "function* read() {}", "function read() {}"],
  ["class method kind", "class A { read() {} }", "class A { get read() {} }"],
  [
    "class method static flag",
    "class A { read() {} }",
    "class A { static read() {} }",
  ],
  [
    "class field static flag",
    "class A { value = 1; }",
    "class A { static value = 1; }",
  ],
  [
    "private method static flag",
    "class A { #read() {} }",
    "class A { static #read() {} }",
  ],
  [
    "private field static flag",
    "class A { #value = 1; }",
    "class A { static #value = 1; }",
  ],
  [
    "object method kind",
    "const value = { read() {} };",
    "const value = { get read() {} };",
  ],
])("distinguishes %s", (_name, left, right) => {
  expect(fingerprintJavaScriptAst(parse(left))).not.toBe(
    fingerprintJavaScriptAst(parse(right)),
  );
});

it("includes the fixed key of a Babel class auto-accessor", () => {
  const before = parse("class A { accessor foo = 1; }", {
    plugins: ["decoratorAutoAccessors"],
  });
  const after = parse("class A { accessor bar = 1; }", {
    plugins: ["decoratorAutoAccessors"],
  });
  expect(fingerprintJavaScriptAst(before)).not.toBe(
    fingerprintJavaScriptAst(after),
  );
});

it("retains public auto-accessor static and computed flags", () => {
  const parseAutoAccessor = (source: string) =>
    parse(source, { plugins: ["decoratorAutoAccessors"] });
  expect(
    fingerprintJavaScriptAst(
      parseAutoAccessor("class A { accessor value = 1; }"),
    ),
  ).not.toBe(
    fingerprintJavaScriptAst(
      parseAutoAccessor("class A { static accessor value = 1; }"),
    ),
  );
  expect(
    fingerprintJavaScriptAst(
      parseAutoAccessor("class A { accessor [key] = 1; }"),
    ),
  ).not.toBe(
    fingerprintJavaScriptAst(
      parseAutoAccessor("class A { accessor key = 1; }"),
    ),
  );
});

it.each(["() {}", "= 1;"])(
  "preserves computed class key semantics for %s",
  (member) => {
    const fingerprint = (source: string) =>
      fingerprintJavaScriptAst(parse(source));
    expect(
      fingerprint(`const key = selectKey(); class A { [key]${member} }`),
    ).toBe(
      fingerprint(
        `const selector = selectKey(); class B { [selector]${member} }`,
      ),
    );
    expect(fingerprint(`class A { ["foo"]${member} }`)).not.toBe(
      fingerprint(`class A { foo${member} }`),
    );
  },
);

it("keeps computed auto-accessor binding renames compatible", () => {
  const before = parse(
    "const key = selectKey(); class A { accessor [key] = 1; }",
    { plugins: ["decoratorAutoAccessors"] },
  );
  const after = parse(
    "const selector = selectKey(); class B { accessor [selector] = 1; }",
    { plugins: ["decoratorAutoAccessors"] },
  );
  expect(fingerprintJavaScriptAst(before)).toBe(
    fingerprintJavaScriptAst(after),
  );
});

it("keeps private class member renames compatible", () => {
  const fingerprint = (source: string) =>
    fingerprintJavaScriptAst(parse(source));
  expect(fingerprint("class A { #read() {} }")).toBe(
    fingerprint("class A { #renamed() {} }"),
  );
  expect(fingerprint("class A { #value = 1; }")).toBe(
    fingerprint("class A { #renamed = 1; }"),
  );
  const fingerprintAutoAccessor = (source: string) =>
    fingerprintJavaScriptAst(
      parse(source, { plugins: ["decoratorAutoAccessors"] }),
    );
  expect(fingerprintAutoAccessor("class A { accessor #value = 1; }")).toBe(
    fingerprintAutoAccessor("class A { accessor #renamed = 1; }"),
  );
});

it("includes complete literal values in the fingerprint", () => {
  const prefix = "x".repeat(1_024);
  const left = parse(`const value = ${JSON.stringify(`${prefix}left`)};`);
  const right = parse(`const value = ${JSON.stringify(`${prefix}right`)};`);

  expect(fingerprintJavaScriptAst(left)).not.toBe(
    fingerprintJavaScriptAst(right),
  );
});
it.each(["obj[key]", "obj?.[key]"])(
  "ignores a local computed key binding in %s",
  (expression) => {
    const left = parse(`function read(obj, key) { return ${expression}; }`);
    const renamed = expression
      .replace("obj", "value")
      .replace("key", "selector");
    const right = parse(
      `function read(value, selector) { return ${renamed}; }`,
    );
    expect(fingerprintJavaScriptAst(left)).toBe(
      fingerprintJavaScriptAst(right),
    );
  },
);

it("distinguishes computed reads from fixed named members", () => {
  expect(fingerprintJavaScriptAst(parse("obj[key]"))).not.toBe(
    fingerprintJavaScriptAst(parse("obj.key")),
  );
  expect(fingerprintJavaScriptAst(parse("obj.key"))).not.toBe(
    fingerprintJavaScriptAst(parse("obj.other")),
  );
  expect(fingerprintJavaScriptAst(parse('obj["key"]'))).not.toBe(
    fingerprintJavaScriptAst(parse('obj["other"]')),
  );
});

it("distinguishes computed object keys from fixed object keys", () => {
  expect(fingerprintJavaScriptAst(parse("({ key: value })"))).not.toBe(
    fingerprintJavaScriptAst(parse("({ [key]: value })")),
  );
});

it.each([
  ["obj[`left`]", "obj[`right`]"],
  ["obj[``]", "obj[`right`]"],
  ["obj[true]", "obj[false]"],
  ["obj[null]", "obj[false]"],
  ['obj["" ]', 'obj["right"]'],
  ["obj[`prefix-${key}`]", "obj[`changed-${key}`]"],
])("retains computed literal contents in %s", (left, right) => {
  expect(fingerprintJavaScriptAst(parse(left))).not.toBe(
    fingerprintJavaScriptAst(parse(right)),
  );
});

it("keeps renamed computed-key bundle modules structurally matchable", () => {
  const source = (name: string) => `globalThis.webpackChunkApp.push([[1], {
    17(module, exports) { const ${name} = selectKey(); exports.read = value[${name}]; }
  }]);`;
  const before = analyzeJavaScriptStaticSource(source("key"))
    .bundler_registrations[0]?.modules[0];
  const after = analyzeJavaScriptStaticSource(source("selector"))
    .bundler_registrations[0]?.modules[0];
  expect(before).toBeDefined();
  expect(after).toBeDefined();
  expect(before?.structural_fingerprint_algorithm).toBe("babel-ast-v3");
  expect(before?.source_sha256).not.toBe(after?.source_sha256);
  expect(before?.structural_fingerprint_sha256).toMatch(/^[a-f0-9]{64}$/u);
  expect(before?.structural_fingerprint_sha256).toBe(
    after?.structural_fingerprint_sha256,
  );
});
