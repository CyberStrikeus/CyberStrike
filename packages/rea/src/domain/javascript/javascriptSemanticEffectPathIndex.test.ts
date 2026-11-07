import { expect, it } from "vitest";

import type { SemanticAliasSelection } from "./javascriptSemanticAliasSelections.js";
import {
  semanticEffectPathCandidates,
  semanticEffectPathMatches,
  semanticSomeEffectPathCandidate,
} from "./javascriptSemanticEffectPathIndex.js";
import type { JavaScriptSemanticPropertyPath } from "./javascriptSemanticPropertyPaths.js";
import type { JavaScriptSemanticMemberEffect } from "./javascriptSemanticState.js";

const effectKeys: JavaScriptSemanticPropertyPath = [
  "a",
  "b",
  "c",
  0,
  "0",
  1,
  null,
  { excludedKeys: ["a"] },
  { excludedKeys: [], startIndex: 1 },
];
const selections: readonly SemanticAliasSelection[] = [
  "a",
  "b",
  "d",
  0,
  "1",
  null,
  { excludedKeys: ["b"] },
  { alternatives: ["a", "c"] },
  { alternatives: [0, "0", "b"] },
  { alternatives: ["a", null] },
];

it("selects exactly the linearly matching effects, in record order", () => {
  let seed = 7774;
  const next = (bound: number): number => {
    seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
    return Math.floor((seed / 2_147_483_648) * bound);
  };
  const effects: JavaScriptSemanticMemberEffect[] = [];
  let compared = 0;
  for (let round = 0; round < 400; round++) {
    // Records are append-only; the index must extend across queries.
    for (let added = next(4); added > 0; added--)
      effects.push({
        path: Array.from({ length: next(5) }, () => effectKeys[next(9)]!),
        node: undefined,
      });
    const path = Array.from({ length: next(5) }, () => selections[next(10)]!);
    const expected = effects.filter((effect) =>
      semanticEffectPathMatches(effect.path, path),
    );
    const candidates = semanticEffectPathCandidates(effects, path);
    expect(
      candidates.filter((effect) =>
        semanticEffectPathMatches(effect.path, path),
      ),
    ).toEqual(expected);
    expect(
      candidates.every(
        (effect, index) =>
          index === 0 ||
          effects.indexOf(candidates[index - 1]!) < effects.indexOf(effect),
      ),
    ).toBe(true);
    const evenDepth = (effect: JavaScriptSemanticMemberEffect) =>
      semanticEffectPathMatches(effect.path, path) &&
      effect.path.length % 2 === 0;
    expect(semanticSomeEffectPathCandidate(effects, path, evenDepth)).toBe(
      effects.some(evenDepth),
    );
    compared += expected.length;
  }
  expect(effects.length).toBeGreaterThan(400);
  expect(compared).toBeGreaterThan(0);
});

it("skips effects whose exact keys no selected choice names", () => {
  const effects: JavaScriptSemanticMemberEffect[] = [
    { path: ["a", "x"], node: undefined },
    { path: ["b"], node: undefined },
    { path: [null, "x"], node: undefined },
    { path: ["a", "x", "y"], node: undefined },
    { path: [], node: undefined },
  ];
  expect(
    semanticEffectPathCandidates(effects, ["a", "x"]).map(({ path }) => path),
  ).toEqual([["a", "x"], [null, "x"], []]);
  expect(
    semanticEffectPathCandidates(effects, [{ alternatives: ["b", "c"] }]).map(
      ({ path }) => path,
    ),
  ).toEqual([["b"], []]);
});

it("stops visiting candidates at the first satisfied predicate", () => {
  const effects: JavaScriptSemanticMemberEffect[] = Array.from(
    { length: 100 },
    () => ({ path: ["a"], node: undefined }),
  );
  let visited = 0;
  expect(
    semanticSomeEffectPathCandidate(effects, ["a"], () => {
      visited += 1;
      return true;
    }),
  ).toBe(true);
  expect(visited).toBe(1);
  expect(semanticSomeEffectPathCandidate(effects, ["b"], () => true)).toBe(
    false,
  );
});
