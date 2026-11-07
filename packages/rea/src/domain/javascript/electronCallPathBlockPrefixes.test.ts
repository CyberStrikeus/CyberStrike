import * as t from "@babel/types";
import { expect, it } from "vitest";
import { ElectronCallPathBlockPrefixes } from "./electronCallPathBlockPrefixes.js";
import { parseJavaScriptSource } from "./javascriptSourceParser.js";
import { completeSemanticSteps } from "./javascriptSemanticTraversal.js";

it("indexes a real flat block once, retaining contextual guards in source order", () => {
  const parsed = parseJavaScriptSource(`{
    ${"0;".repeat(2048)}
    if (uncertain) ordinary();
    if (flag) throw 0;
    electron.send("tail");
  }`);
  const block = parsed?.program.body[0];
  if (!t.isBlockStatement(block)) throw new Error("Expected parsed block");
  const first = block.body[0];
  const tail = block.body.at(-1);
  if (first === undefined || tail === undefined)
    throw new Error("Expected block statements");
  let examined = 0;
  const prefixes = new ElectronCallPathBlockPrefixes(() => {
    examined += 1;
    return true;
  });
  const steps = prefixes.before(block, tail);
  expect(steps.next()).toEqual({ done: false, value: undefined });
  expect(examined).toBe(2048);
  const prefix = completeSemanticSteps(steps);
  const completeVisits = examined;
  expect(completeVisits).toBeGreaterThan(block.body.length);
  expect(prefix).toMatchObject({
    before: 2050,
    entries: [
      {
        position: 2048,
        fact: {
          kind: "branch",
          test: { type: "Identifier", name: "uncertain" },
          consequentExits: false,
          alternateExits: false,
        },
      },
      {
        position: 2049,
        fact: {
          kind: "branch",
          test: { type: "Identifier", name: "flag" },
          consequentExits: true,
          alternateExits: false,
        },
      },
    ],
  });
  for (const statement of block.body) {
    const earlier = completeSemanticSteps(prefixes.before(block, statement));
    expect(earlier?.entries).toBe(prefix?.entries);
  }
  expect(examined).toBe(completeVisits);
  expect(completeSemanticSteps(prefixes.before(block, first))?.before).toBe(0);
});

it("does not publish an incomplete block index when its work budget ends", () => {
  const parsed = parseJavaScriptSource(
    `{ 0; 1; if (stop) throw 0; send("tail"); }`,
  );
  const block = parsed?.program.body[0];
  if (!t.isBlockStatement(block)) throw new Error("Expected parsed block");
  const tail = block.body.at(-1);
  if (tail === undefined) throw new Error("Expected terminal statement");
  let remaining = 2;
  const prefixes = new ElectronCallPathBlockPrefixes(() => --remaining >= 0);
  expect(completeSemanticSteps(prefixes.before(block, tail))).toBeUndefined();
  remaining = 100;
  expect(completeSemanticSteps(prefixes.before(block, tail))).toMatchObject({
    before: 3,
    entries: [{ position: 2, fact: { kind: "branch" } }],
  });
  expect(remaining).toBeGreaterThan(0);
});

it("charges nested exit checks to the same budget and does not cache a partial index", () => {
  const parsed = parseJavaScriptSource(
    `{ if (x) { { { throw 0; } } } send(); }`,
  );
  const block = parsed?.program.body[0];
  if (!t.isBlockStatement(block)) throw new Error("Expected parsed block");
  const tail = block.body.at(-1);
  if (tail === undefined) throw new Error("Expected terminal statement");
  let remaining = 4;
  const prefixes = new ElectronCallPathBlockPrefixes(() => --remaining >= 0);
  expect(completeSemanticSteps(prefixes.before(block, tail))).toBeUndefined();
  remaining = 100;
  expect(completeSemanticSteps(prefixes.before(block, tail))).toMatchObject({
    entries: [{ fact: { kind: "branch", consequentExits: true } }],
  });
});
