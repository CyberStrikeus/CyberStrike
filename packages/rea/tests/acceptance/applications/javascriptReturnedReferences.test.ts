import { expect } from "vitest";

import {
  verifyJavaScriptReturnShapes,
  verifyJavaScriptReturnShapesThroughCli,
  type JavaScriptReturnFields,
} from "../../fixtures/javascriptReturnShapes.js";
import { cliTest } from "../../support/cli/cliFixture.js";

const writes = {
  direct: "const get = () => shared; get().x = 2;",
  captured: "const get = () => shared; const t = get(); t.x = 2;",
  declaration:
    "function get() { return shared; } const o = {}; o.a = get(); o.a.x = 2;",
  immediate: "const o = {}; o.a = (() => shared)(); o.a.x = 2;",
  method:
    "const box = {get() { return shared; }}; const o = {}; o.a = box.get(); o.a.x = 2;",
  methodDirect: "const box = {get() { return shared; }}; box.get().x = 2;",
  quotedMethod:
    "const box = {['get/ref']() { return shared; }}; box['get/ref']().x = 2;",
  alias: "const get = () => shared; const another = get; another().x = 2;",
  alternative: "const get = true ? () => shared : () => ({x: 0}); get().x = 2;",
  nestedReturn: "const get = () => ({child: shared}); get().child.x = 2;",
  arrayReturn: "const get = () => [shared]; get()[0].x = 2;",
  returnedProperty:
    "const holder = {inner: shared}; const get = () => holder.inner; get().x = 2;",
  transitive:
    "const first = () => shared; const second = () => first(); second().x = 2;",
  updated: "const get = () => shared; get().x++;",
  asyncAwait: "const get = async () => shared; const t = await get(); t.x = 2;",
  generator:
    "function* get() { yield shared; } for (const t of get()) t.x = 2;",
  returnedYield:
    "function* get() { return yield shared; } for (const t of get()) t.x = 2;",
  delegatedYield:
    "function* get() { yield* [shared]; } for (const t of get()) t.x = 2;",
  recursiveWrapper:
    "let count = 0; const get = () => count++ === 0 ? {child: get()} : shared; get().child.x = 2;",
  destructuredMethod:
    "const box = {get() { return shared; }}; const {get} = box; get().x = 2;",
  arrayCallable: "const methods = [() => shared]; methods[0]().x = 2;",
  spreadArrayCallable:
    "const methods = [...[], () => shared]; methods[0]().x = 2;",
  classMethod:
    "class Box { get() { return shared; } } const box = new Box(); box.get().x = 2;",
  objectGetter:
    "const box = { get value() { return shared; } }; box.value.x = 2;",
  instanceGetter:
    "class Box { get value() { return shared; } } const box = new Box(); box.value.x = 2;",
  staticGetter:
    "class Box { static get value() { return shared; } } Box.value.x = 2;",
  copiedGetter:
    "const box = { get value() { return shared; } }; const alias = box.value; alias.x = 2;",
  staticMethod:
    "class Box { static get() { return shared; } } Box.get().x = 2;",
  constructor:
    "function Box() { return shared; } const t = new Box(); t.x = 2;",
  callback: "const get = () => shared; [0].forEach(() => { get().x = 2; });",
  wideMethods: `const box = { ${Array.from(
    { length: 64 },
    (_, index) => `m${index}() { return shared; }`,
  ).join(", ")} }; box.m0().x = 2; box.m63().other = 3;`,
};
const wideReceiverSource = (width: number): string => {
  const object = Array.from(
    { length: width },
    (_, index) => `p${index}:0`,
  ).join(",");
  const array = "0,".repeat(width);
  return [
    ["wideObject", `{${object},last:shared}`],
    ["wideArray", `[${array}shared]`],
  ]
    .map(
      ([name, value]) =>
        `export function ${name}(){const shared={x:1};const box={wide(){return ${value}},noop(){}};box.noop();return {x:shared.x,keep:7};}`,
    )
    .join("\n");
};
const source = [
  ...Object.entries(writes).map(
    ([name, body]) =>
      `export ${name === "asyncAwait" ? "async " : ""}function ${name}(){ const shared = {x: 1}; ${body} return shared.x; }`,
  ),
  "export function plainGetterRead(){ const shared = {x: 1}; const box = {get value() { return shared; }}; box.value; return shared.x; }",
  "export function objectGetterLastWins(){ const shared = {x: 1}; const box = {get value(){return shared;}, get value(){return {x: 2};}}; box.value.x = 3; return shared.x; }",
  "export function objectDataReplacesGetter(){ const shared = {x: 1}; const box = {get value(){return shared;}, value: {x: 2}}; box.value.x = 3; return shared.x; }",
  "export function objectSpreadReplacesGetter(){ const shared = {x: 1}; const box = {get value(){return shared;}, ...{value: {x: 2}}}; box.value.x = 3; return shared.x; }",
  "export function dynamicObjectGetter(){ const shared = {x: 1}; const key = 'value'; const box = {get value(){return {x: 2};}, get [key](){return shared;}}; box.value.x = 3; return shared.x; }",
  "export function dynamicClassGetter(){ const shared = {x: 1}; const key = getKey(); class Box { get value(){return shared;} } const box = new Box(); box[key].x = 2; return shared.x; }",
  "export function dynamicStaticGetter(){ const shared = {x: 1}; const key = getKey(); class Box { static get value(){return shared;} } Box[key].x = 2; return shared.x; }",
  "export function inheritedGetter(){ const shared = {x: 1}; class Base { get value(){return shared;} } class Derived extends Base {} new Derived().value.x = 2; return shared.x; }",
  "export function conditionalSuperGetter(){ const shared = {x: 1}; class Fresh { get value(){return {x: 2};} } class Shared { get value(){return shared;} } class Derived extends (flag ? Fresh : Shared) {} new Derived().value.x = 2; return shared.x; }",
  "export function computedClassGetterOverride(){ const shared = {x: 1}; const key = getKey(); class Box { get value(){return {x: 2};} get [key](){return shared;} } new Box().value.x = 3; return shared.x; }",
  "export function aliasedClassGetter(){ const shared = {x: 1}; class Box { get value(){return shared;} } const Alias = Box; new Alias().value.x = 2; return shared.x; }",
  "export function inlineClassGetter(){ const shared = {x: 1}; new (class { get value(){return shared;} })().value.x = 2; return shared.x; }",
  "export function instanceGetterAssignment(){ const shared = {x: 1}; class Box { get value(){return shared;} } const box = new Box(); try { box.value = {}; } catch {} return shared.x; }",
  "export function instanceGetterDeletion(){ const shared = {x: 1}; class Box { get value(){return shared;} } const box = new Box(); delete box.value; return shared.x; }",
  "export function staticGetterAssignment(){ const shared = {x: 1}; class Box { static get value(){return shared;} } try { Box.value = {}; } catch {} return shared.x; }",
  "export function staticGetterDeletion(){ const shared = {x: 1}; class Box { static get value(){return shared;} } delete Box.value; return shared.x; }",
  "export function freshGetterRead(){ const box = {get value(){return {x: 1};}}; const first = box.value; first.x = 2; return box.value.x; }",
  "export function savedFreshGetter(){ const box = {get value(){return {x: 1};}}; const saved = box.value; saved.x = 2; return saved.x; }",
  "export function directSibling(){ const shared = {x: 1}; const parent = {shared, keep: 7}; const get = () => parent.shared; get().x = 2; return {x: shared.x, keep: parent.keep}; }",
  "export function primitive(){ const n = 1; const get = () => n; const t = get(); return n; }",
  "export function copy(){ const shared = {x: 1}; const get = () => ({...shared}); get().x = 2; return shared.x; }",
  "export function methodCopy(){ const shared = {x: 1}; const box = {get(){ return {...shared}; }}; box.get().x = 2; return shared.x; }",
  "export function arrayCopy(){ const shared = {x: 1}; const get = () => [shared.x]; get()[0] = 2; return shared.x; }",
  "export function unused(){ const shared = {x: 1}; const get = () => shared; get(); return shared.x; }",
  "export function nestedCallable(){ const shared = {x: 1}; const get = () => { const inner = () => shared; return {x: 0}; }; get().x = 2; return shared.x; }",
  "export function unrelated(){ const shared = {x: 1}; const other = {x: 9}; const get = () => shared; get().x = 2; return other.x; }",
  "export function receiverDistinctScopes(){ const shared = {x: 1}; const box = {outer(){ return shared; }, inner(){ const shared = {x: 9}; return shared; }, noop(){}}; box.noop(); return {outer: shared.x, inner: box.inner().x}; }",
  "export function receiverDistinctPaths(){ const parent = {left: {x: 1}, right: {x: 9}, keep: 7}; const box = {left(){ return parent.left; }, right(){ return parent.right; }, noop(){}}; box.noop(); return {left: parent.left.x, right: parent.right.x, keep: parent.keep}; }",
  wideReceiverSource(64),
].join("\n");

const assertWideReturns = (fields: JavaScriptReturnFields): void => {
  for (const name of ["wideObject", "wideArray"]) {
    expect(fields(name)).toContainEqual(
      expect.objectContaining({ path: "/x", state: "unknown" }),
    );
    expect(fields(name)).toContainEqual(
      expect.objectContaining({ path: "/keep", state: "literal", value: 7 }),
    );
  }
};

const assertReturns = (fields: JavaScriptReturnFields): void => {
  for (const name of Object.keys(writes)) {
    const field = fields(name).find(({ path }) => path === "");
    expect(field?.state, name).toMatch(/^(unknown|literal)$/);
    if (field?.state === "literal") expect(field.value, name).toBe(2);
  }
  for (const name of [
    "objectGetter",
    "instanceGetter",
    "staticGetter",
    "copiedGetter",
  ])
    expect(fields(name), name).toContainEqual(
      expect.objectContaining({ path: "", state: "unknown" }),
    );
  for (const name of [
    "plainGetterRead",
    "objectGetterLastWins",
    "objectDataReplacesGetter",
  ])
    expect(fields(name)).toContainEqual(
      expect.objectContaining({ path: "", state: "literal", value: 1 }),
    );
  for (const name of [
    "instanceGetterAssignment",
    "instanceGetterDeletion",
    "staticGetterAssignment",
    "staticGetterDeletion",
  ])
    expect(fields(name), name).toContainEqual(
      expect.objectContaining({ path: "", state: "literal", value: 1 }),
    );
  for (const name of [
    "inheritedGetter",
    "aliasedClassGetter",
    "inlineClassGetter",
  ])
    expect(fields(name)).toContainEqual(
      expect.objectContaining({ path: "", state: "unknown" }),
    );
  for (const name of ["freshGetterRead", "savedFreshGetter"])
    expect(fields(name)).toContainEqual(
      expect.objectContaining({ path: "", state: "unknown" }),
    );
  const changed = fields("directSibling").find(({ path }) => path === "/x");
  expect(changed?.state).toMatch(/^(unknown|literal)$/);
  if (changed?.state === "literal") expect(changed.value).toBe(2);
  expect(fields("directSibling")).toContainEqual(
    expect.objectContaining({ path: "/keep", state: "literal", value: 7 }),
  );
  for (const name of [
    "primitive",
    "copy",
    "methodCopy",
    "arrayCopy",
    "nestedCallable",
  ])
    expect(fields(name), name).toContainEqual(
      expect.objectContaining({ path: "", state: "literal", value: 1 }),
    );
  const unused = fields("unused").find(({ path }) => path === "");
  expect(unused?.state).toMatch(/^(unknown|literal)$/);
  if (unused?.state === "literal") expect(unused.value).toBe(1);
  expect(fields("unrelated")).toContainEqual(
    expect.objectContaining({ path: "", state: "literal", value: 9 }),
  );
  for (const path of ["/outer", "/inner"])
    expect(fields("receiverDistinctScopes")).toContainEqual(
      expect.objectContaining({ path, state: "unknown" }),
    );
  for (const path of ["/left", "/right"])
    expect(fields("receiverDistinctPaths")).toContainEqual(
      expect.objectContaining({ path, state: "unknown" }),
    );
  expect(fields("receiverDistinctPaths")).toContainEqual(
    expect.objectContaining({ path: "/keep", state: "literal", value: 7 }),
  );
};

cliTest(
  "preserves mutation uncertainty for objects returned by local calls",
  ({ cli }) =>
    verifyJavaScriptReturnShapes(cli, source, (fields) => {
      assertReturns(fields);
      assertWideReturns(fields);
    }),
  120_000,
);

cliTest(
  "analyzes wide receiver returns without losing escaped reference facts",
  ({ cli }) => {
    // Exceed the argument limit with the worker's 2048 KiB stack as well as
    // Node's default stack, so a spread into push still fails this regression.
    return verifyJavaScriptReturnShapesThroughCli(
      cli,
      wideReceiverSource(300_000),
      assertWideReturns,
    );
  },
  120_000,
);
