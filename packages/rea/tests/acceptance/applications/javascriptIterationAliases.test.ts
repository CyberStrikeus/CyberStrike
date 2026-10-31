import { expect } from "vitest";

import {
  verifyJavaScriptReturnShapes,
  type JavaScriptReturnFields,
} from "../../fixtures/javascriptReturnShapes.js";
import { cliTest } from "../../support/cli/cliFixture.js";

const source = [
  "export function inline() { const shared = { x: 1, keep: 7 }; for (const t of [shared]) t.x = 2; return { x: shared.x, keep: shared.keep }; }",
  "export function named() { const shared = { x: 1 }; const arr = [shared]; for (const t of arr) t.x = 2; return shared.x; }",
  "export function declaredVar() { const shared = { x: 1 }; for (var t of [shared]) t.x = 2; return shared.x; }",
  "export function assigned() { const shared = { x: 1 }; let t; for (t of [shared]) t.x = 2; return shared.x; }",
  "export function assignedDestructured() { const shared = { x: 1 }; let t; for ({child: t} of [{child: shared}]) t.x = 2; return shared.x; }",
  "export function declaredVarDestructured() { const shared = { x: 1 }; for (var {child: t} of [{child: shared}]) t.x = 2; return shared.x; }",
  "export function memberTarget() { const shared = { x: 1 }; const holder = {}; for (holder.item of [shared]) holder.item.x = 2; return shared.x; }",
  "export function memberPattern() { const shared = { x: 1 }; const holder = {}; for ({child: holder.item} of [{child: shared}]) holder.item.x = 2; return shared.x; }",
  "export function destructured() { const shared = { x: 1 }; for (const {child: t} of [{child: shared}]) t.x = 2; return shared.x; }",
  "export function arrayDestructured() { const shared = { x: 1 }; for (const [t] of [[shared]]) t.x = 2; return shared.x; }",
  "export function spread() { const shared = { x: 1 }; const arr = [shared]; for (const t of [...arr]) t.x = 2; return shared.x; }",
  "export function objectRestChild() { const shared = { x: 1 }; for (const {...t} of [{child: shared}]) t.child.x = 2; return shared.x; }",
  "export function arrayRestChild() { const shared = { x: 1 }; for (const [...t] of [[shared]]) t[0].x = 2; return shared.x; }",
  "export function defaultChild() { const shared = { x: 1 }; for (const {child: t = shared} of [{}]) t.x = 2; return shared.x; }",
  "export function updated() { const shared = { x: 1 }; for (const t of [shared]) t.x++; return shared.x; }",
  "export function deleted() { const shared = { x: 1 }; for (const t of [shared]) delete t.x; return shared.x; }",
  "export function escaped() { const shared = { x: 1 }; for (const t of [shared]) consume(t); return shared.x; }",
  "export async function awaited() { const shared = { x: 1 }; for await (const t of [shared]) t.x = 2; return shared.x; }",
  "export function indexed() { const shared = { x: 1 }; const arr = [shared]; for (let i = 0; i < arr.length; i++) { const t = arr[i]; t.x = 2; } return shared.x; }",
  "export function copyWrite() { const shared = { x: 1 }; for (const {...t} of [shared]) t.x = 2; return shared.x; }",
  "export function noWrite() { const shared = { x: 1 }; for (const t of [shared]) { const read = t.x; } return shared.x; }",
  "export function empty() { const shared = { x: 1 }; for (const t of []) t.x = 2; return shared.x; }",
  "export function keys() { const shared = { x: 1 }; for (const key in [shared]) { const read = key; } return shared.x; }",
  "export function shadowed() { const t = { x: 1 }; const shared = { x: 3 }; for (const t of [shared]) t.x = 2; return t.x; }",
].join("\n");

const assertReturns = (fields: JavaScriptReturnFields): void => {
  expect(fields("inline")).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ path: "/x", state: "unknown" }),
      expect.objectContaining({ path: "/keep", state: "literal", value: 7 }),
    ]),
  );
  for (const name of [
    "named",
    "declaredVar",
    "assigned",
    "assignedDestructured",
    "declaredVarDestructured",
    "memberTarget",
    "memberPattern",
    "destructured",
    "arrayDestructured",
    "spread",
    "objectRestChild",
    "arrayRestChild",
    "defaultChild",
    "updated",
    "deleted",
    "escaped",
    "awaited",
    "indexed",
  ])
    expect(fields(name), name).toContainEqual(
      expect.objectContaining({ path: "", state: "unknown" }),
    );
  for (const name of ["copyWrite", "noWrite", "empty", "keys", "shadowed"])
    expect(fields(name), name).toContainEqual(
      expect.objectContaining({ path: "", state: "literal", value: 1 }),
    );
};

cliTest(
  "preserves yielded-object mutation uncertainty through CLI and stdio MCP",
  ({ cli }) => verifyJavaScriptReturnShapes(cli, source, assertReturns),
  120_000,
);
