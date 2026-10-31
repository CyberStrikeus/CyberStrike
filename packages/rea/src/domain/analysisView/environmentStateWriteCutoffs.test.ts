import { expect, it } from "vitest";
import {
  isParam,
  rootOf,
  type StateRecordFacts,
} from "./environmentStateRules.js";
import { offsetDateTimeInstantFromEpochMilliseconds } from "../offsetDateTime.js";
import { StateWriteCutoffs } from "./environmentStateWriteCutoffs.js";

const write = (path: string, ordinal: number): StateRecordFacts => ({
  path,
  ordinal,
  method: "POST",
  query: undefined,
  status: 200,
  timing: {
    start: {
      instant: offsetDateTimeInstantFromEpochMilliseconds(ordinal),
      ms: ordinal,
    },
    endMs: ordinal,
  },
});

it("matches prefix and parameter semantics against an independent linear oracle", () => {
  const bases = new Map([
    ["api", 8],
    ["other", 8],
  ]);
  const paths = [
    "/api/a",
    "/api/b/c",
    "/api/{owner}/d",
    "/other/x",
    "/api/a/{item}/e",
    "",
  ];
  const writes = paths.map(write);
  const patterns: string[][] = [[]];
  let level: string[][] = [[]];
  for (let depth = 0; depth < 4; depth += 1) {
    level = level.flatMap((prefix) =>
      ["api", "a", "b", "d", "{key}"].map((segment) => [...prefix, segment]),
    );
    patterns.push(...level);
  }
  for (const selection of [
    writes,
    writes.slice(0, -1),
    [...writes].reverse(),
  ]) {
    const index = new StateWriteCutoffs(
      selection,
      bases,
      (a, b) => a.timing.start!.ms < b.timing.start!.ms,
      () => {},
    );
    for (const root of patterns) {
      const expected = [...selection]
        .sort((a, b) => a.timing.start!.ms - b.timing.start!.ms)
        .find((record) => {
          const candidate = rootOf(record.path, bases);
          const shared = Math.min(root.length, candidate.length);
          return Array.from({ length: shared }, (_, i) => i).every(
            (i) =>
              root[i] === candidate[i] ||
              isParam(root[i]!) ||
              isParam(candidate[i]!),
          );
        });
      expect(index.first(root), JSON.stringify(root)).toBe(expected);
    }
  }
});

it("handles deep roots iteratively within admitted storage", () => {
  const root = ["api", ...Array<string>(12_000).fill("a")];
  const record = write(`/${root.join("/")}`, 1);
  let admitted = 0;
  const index = new StateWriteCutoffs(
    [record],
    new Map([["api", root.length]]),
    () => false,
    (bytes) => {
      admitted += bytes;
      if (admitted > 16 * 1024 * 1024)
        throw new Error("Test storage budget exceeded");
    },
  );
  expect(index.first(root)).toBe(record);
  expect(index.first(["other"])).toBeUndefined();
});
