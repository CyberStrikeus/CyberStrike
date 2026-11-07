import { expect, it } from "vitest";

import { SemanticPropertyPathCoverage } from "./javascriptSemanticPropertyPaths.js";

it("covers deeper capture history only below the same captured receiver", () => {
  const coverage = new SemanticPropertyPathCoverage();
  expect(coverage.retain(["child"], ["first"])).toBe(true);
  expect(coverage.retain(["child", "value"], ["first", "later"])).toBe(false);
  expect(coverage.covers(["child", "value"], ["second", "later"])).toBe(false);
  expect(coverage.retain(["child"], ["second"])).toBe(true);
});

it("retains distinct deep captures until their common receiver escapes", () => {
  const coverage = new SemanticPropertyPathCoverage();
  expect(coverage.retain(["child", "value"], ["outer", "before"])).toBe(true);
  expect(coverage.retain(["child", "value"], ["outer", "after"])).toBe(true);
  expect(coverage.covers(["child", "value"], ["outer", "unknown"])).toBe(false);
  expect(coverage.retain(["child"], ["outer"])).toBe(true);
  expect(coverage.covers(["child", "value"], ["outer", "unknown"])).toBe(true);
  expect(coverage.covers(["sibling"], ["outer"])).toBe(false);
});

it("keeps wildcard coverage within its capture context", () => {
  const coverage = new SemanticPropertyPathCoverage();
  expect(coverage.retain([null, "value"], ["receiver", "slot"])).toBe(true);
  expect(coverage.covers(["child", "value"], ["receiver", "slot"])).toBe(true);
  expect(coverage.covers(["child", "value"], ["other", "slot"])).toBe(false);
  expect(coverage.covers(["child", "value"], ["receiver", "other"])).toBe(
    false,
  );
});

it("preserves copied-slot exclusions and array prefixes with captures", () => {
  const coverage = new SemanticPropertyPathCoverage();
  expect(
    coverage.retain([{ excludedKeys: ["2"], startIndex: 1 }], ["copy"]),
  ).toBe(true);
  expect(coverage.covers([1, "nested"], ["copy", "later"])).toBe(true);
  expect(coverage.covers([0], ["copy"])).toBe(false);
  expect(coverage.covers([2], ["copy"])).toBe(false);
  expect(coverage.covers([1], ["other"])).toBe(false);
  expect(coverage.retain([null], ["copy"])).toBe(true);
  expect(coverage.covers([2], ["copy"])).toBe(true);
  expect(coverage.covers([2], ["other"])).toBe(false);
});

it("preserves numeric key identity and absent capture identity", () => {
  const coverage = new SemanticPropertyPathCoverage();
  expect(coverage.retain([1])).toBe(true);
  expect(coverage.covers(["1", "value"], [undefined, "nested"])).toBe(true);
  expect(coverage.covers([1], ["captured"])).toBe(false);
});

it("lets an escaped root cover every deeper capture", () => {
  const coverage = new SemanticPropertyPathCoverage();
  expect(coverage.retain([])).toBe(true);
  expect(coverage.retain(["child"], ["captured"])).toBe(false);
});
